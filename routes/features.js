import express from 'express';
import { featureQueries, productFeatureQueries, featureGroupQueries } from '../db/database.js';

const router = express.Router();

/**
 * GET /api/features/public
 *
 * Public endpoint - Lädt Features gruppiert für die Landing Page
 *
 * Response:
 * {
 *   "success": true,
 *   "groups": [
 *     {
 *       "id": 1,
 *       "name": "Kamera Features",
 *       "displayOrder": 0,
 *       "features": [{ "id": 1, "name": "HD Kamera", "displayOrder": 0 }]
 *     }
 *   ],
 *   "ungroupedFeatures": [{ "id": 2, "name": "Feature ohne Gruppe" }]
 * }
 */
router.get('/public', async (req, res) => {
  try {
    const features = await featureQueries.getAll();
    const groups = await featureGroupQueries.getAll();

    // Group features by group_id
    const grouped = groups.map(group => ({
      id: group.id,
      name: group.name,
      displayOrder: group.display_order,
      features: features
        .filter(f => f.group_id === group.id)
        .map(f => ({
          id: f.id,
          name: f.name,
          displayOrder: f.display_order
        }))
    }));

    // Ungrouped features
    const ungrouped = features
      .filter(f => !f.group_id)
      .map(f => ({
        id: f.id,
        name: f.name,
        displayOrder: f.display_order
      }));

    res.json({
      success: true,
      groups: grouped,
      ungroupedFeatures: ungrouped
    });

  } catch (error) {
    console.error('[Features API] Error loading public features:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load features',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/features
 *
 * Lädt alle Features mit ihrer Produkt-Zuordnung
 *
 * Response:
 * {
 *   "success": true,
 *   "features": [
 *     {
 *       "id": 1,
 *       "name": "Professionelle Kamera",
 *       "products": {
 *         "basic-fotobox": true,
 *         "premium-fotobox": true,
 *         "luxury-fotobox": false
 *       }
 *     }
 *   ]
 * }
 */
router.get('/', async (req, res) => {
  try {
    // Hole alle Features (mit group info)
    const features = await featureQueries.getAll();

    // Hole alle Gruppen
    const groups = await featureGroupQueries.getAll();

    // Hole alle Produkt-Feature-Zuordnungen
    const productFeatures = await productFeatureQueries.getAll();

    // Erstelle Feature-Liste mit Produkt-Mapping
    const featureList = features.map(feature => {
      // Finde alle Produkte für dieses Feature
      const products = {};
      const customTexts = {};
      productFeatures.forEach(pf => {
        if (pf.feature_id === feature.id) {
          // PostgreSQL: enabled ist BOOLEAN (true/false)
          products[pf.product_id] = pf.enabled === true;
          // Speichere custom_text falls vorhanden
          if (pf.custom_text) {
            customTexts[pf.product_id] = pf.custom_text;
          }
        }
      });

      return {
        id: feature.id,
        name: feature.name,
        displayOrder: feature.display_order,
        groupId: feature.group_id,
        groupName: feature.group_name,
        products,
        customTexts
      };
    });

    res.json({
      success: true,
      features: featureList,
      groups
    });

  } catch (error) {
    console.error('[Features API] Error loading features:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load features',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/features
 *
 * Speichert alle Features und ihre Produkt-Zuordnungen
 *
 * Request Body:
 * {
 *   "features": [
 *     {
 *       "id": 1,                           // Optional, wenn neues Feature
 *       "name": "Professionelle Kamera",
 *       "products": {
 *         "basic-fotobox": true,
 *         "premium-fotobox": false
 *       }
 *     }
 *   ]
 * }
 */
router.post('/', async (req, res) => {
  try {
    const { features } = req.body;

    if (!features || !Array.isArray(features)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: features array required'
      });
    }

    // PERFORMANCE: Nutze Transaction für atomare Operation
    // Wichtig: Bei PostgreSQL wird `transaction` mit einem Callback aufgerufen
    const saveFeatures = async () => {
      for (const [index, feature] of features.entries()) {
        let featureId = feature.id;

        // Wenn ID vorhanden, Update. Sonst Insert.
        if (featureId) {
          // Update existing feature
          // Nur Namen aktualisieren wenn er sich geändert hat
          const existing = await featureQueries.getById(featureId);
          if (existing && existing.name !== feature.name) {
            // Prüfe ob neuer Name bereits von einem anderen Feature verwendet wird
            const duplicate = await featureQueries.getByName(feature.name);
            if (duplicate && duplicate.id !== featureId) {
              throw new Error(`Feature-Name "${feature.name}" existiert bereits`);
            }
            await featureQueries.updateName(feature.name, featureId);
          }
          await featureQueries.updateOrder(index, featureId);

          // Update group_id wenn vorhanden
          if (feature.groupId !== undefined) {
            await featureQueries.updateGroupId(feature.groupId, featureId);
          }
        } else {
          // Insert new feature - prüfe ob Name bereits existiert
          const existing = await featureQueries.getByName(feature.name);
          if (existing) {
            // Verwende existierendes Feature statt neues zu erstellen
            featureId = existing.id;
            await featureQueries.updateOrder(index, featureId);

            // Update group_id wenn vorhanden
            if (feature.groupId !== undefined) {
              await featureQueries.updateGroupId(feature.groupId, featureId);
            }
          } else {
            const result = await featureQueries.add(feature.name, index);
            // PostgreSQL gibt das Objekt mit {id: ...} zurück via RETURNING
            featureId = result?.id;

            // Update group_id wenn vorhanden
            if (feature.groupId !== undefined && featureId) {
              await featureQueries.updateGroupId(feature.groupId, featureId);
            }
          }
        }

        // Update Produkt-Zuordnungen
        if (feature.products) {
          for (const [productId, enabled] of Object.entries(feature.products)) {
            if (enabled) {
              // Feature ist aktiviert für dieses Produkt
              // PostgreSQL: enabled ist BOOLEAN
              const enabledValue = true;
              // Hole custom_text falls vorhanden
              const customText = feature.customTexts?.[productId] || null;
              await productFeatureQueries.set(productId, featureId, enabledValue, customText);
            } else {
              // Feature ist deaktiviert - entfernen
              await productFeatureQueries.remove(productId, featureId);
            }
          }
        }
      }
    };

    // Führe Save-Funktion aus (ohne Transaction-Wrapper für jetzt)
    // TODO: Transaction-Support für PostgreSQL hinzufügen
    await saveFeatures();

    console.log('[Features API] Successfully saved', features.length, 'features');

    res.json({
      success: true,
      message: `${features.length} Features gespeichert`
    });

  } catch (error) {
    console.error('[Features API] Error saving features:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save features',
      message: error.message
    });
  }
});

/**
 * DELETE /api/admin/features/:id
 *
 * Löscht ein Feature (und alle zugehörigen Produkt-Zuordnungen durch CASCADE)
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Prüfe ob Feature existiert
    const feature = await featureQueries.getById(id);
    if (!feature) {
      return res.status(404).json({
        success: false,
        error: 'Feature not found'
      });
    }

    // Lösche Feature (CASCADE löscht automatisch product_features)
    await featureQueries.delete(id);

    console.log('[Features API] Deleted feature:', feature.name);

    res.json({
      success: true,
      message: 'Feature gelöscht'
    });

  } catch (error) {
    console.error('[Features API] Error deleting feature:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete feature',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/features/product/:productId
 *
 * Lädt alle Features für ein spezifisches Produkt
 */
router.get('/product/:productId', async (req, res) => {
  try {
    const { productId } = req.params;

    const features = await productFeatureQueries.getByProduct(productId);

    res.json({
      success: true,
      productId,
      features: features.map(f => ({
        id: f.id,
        name: f.name,
        enabled: f.enabled === true
      }))
    });

  } catch (error) {
    console.error('[Features API] Error loading product features:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load product features',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/features/groups
 *
 * Lädt alle Feature-Gruppen
 */
router.get('/groups', async (req, res) => {
  try {
    const groups = await featureGroupQueries.getAll();

    res.json({
      success: true,
      groups
    });

  } catch (error) {
    console.error('[Features API] Error loading feature groups:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load feature groups',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/features/groups
 *
 * Speichert Feature-Gruppen
 *
 * Request Body:
 * {
 *   "groups": [
 *     { "id": 1, "name": "Kamera Features" },
 *     { "id": null, "name": "Neue Gruppe" }
 *   ]
 * }
 */
router.post('/groups', async (req, res) => {
  try {
    const { groups } = req.body;

    if (!groups || !Array.isArray(groups)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: groups array required'
      });
    }

    for (const [index, group] of groups.entries()) {
      if (group.id) {
        // Update existing group
        await featureGroupQueries.updateName(group.name, group.id);
        await featureGroupQueries.updateOrder(index, group.id);
      } else {
        // Create new group
        await featureGroupQueries.create(group.name, index);
      }
    }

    console.log('[Features API] Successfully saved', groups.length, 'feature groups');

    res.json({
      success: true,
      message: `${groups.length} Gruppen gespeichert`
    });

  } catch (error) {
    console.error('[Features API] Error saving feature groups:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save feature groups',
      message: error.message
    });
  }
});

/**
 * DELETE /api/admin/features/groups/:id
 *
 * Löscht eine Feature-Gruppe
 * (Features werden durch ON DELETE SET NULL zu ungrouped)
 */
router.delete('/groups/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Prüfe ob Gruppe existiert
    const group = await featureGroupQueries.getById(id);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Feature group not found'
      });
    }

    // Lösche Gruppe (Features werden durch ON DELETE SET NULL zu ungrouped)
    await featureGroupQueries.delete(id);

    console.log('[Features API] Deleted feature group:', group.name);

    res.json({
      success: true,
      message: 'Gruppe gelöscht'
    });

  } catch (error) {
    console.error('[Features API] Error deleting feature group:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete feature group',
      message: error.message
    });
  }
});

export default router;
