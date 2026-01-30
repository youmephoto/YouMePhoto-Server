import express from 'express';
import shopifyClient from '../config/shopify.js';
import { productFeatureQueries, featureGroupQueries } from '../db/database.js';

const router = express.Router();

/**
 * Extrahiert numerische ID aus Shopify GraphQL GID
 * z.B. "gid://shopify/ProductVariant/44558417592420" => "44558417592420"
 */
function extractNumericId(gid) {
  if (!gid) return null;
  const parts = gid.split('/');
  return parts[parts.length - 1];
}

/**
 * GET /api/products
 *
 * Lädt alle Fotobox-Produkte mit Varianten aus Shopify
 *
 * Response:
 * {
 *   "success": true,
 *   "products": [
 *     {
 *       "id": "basic",
 *       "name": "Basic Fotobox",
 *       "price": "299",
 *       "popular": false,
 *       "features": [...],
 *       "variants": {
 *         "basic-weiss": "gid://shopify/ProductVariant/...",
 *         "basic-schwarz": "gid://shopify/ProductVariant/...",
 *         ...
 *       }
 *     }
 *   ],
 *   "variantMapping": {
 *     "basic-weiss": "gid://shopify/ProductVariant/...",
 *     "premium-mint": "gid://shopify/ProductVariant/...",
 *     ...
 *   }
 * }
 */
router.get('/', async (req, res) => {
  try {
    const query = `
      query getProducts {
        products(first: 50) {
          nodes {
            id
            title
            description
            descriptionHtml
            productType
            tags
            variants(first: 50) {
              nodes {
                id
                title
                price
                inventoryQuantity
                selectedOptions {
                  name
                  value
                }
              }
            }
            metafields(first: 10, namespace: "custom") {
              nodes {
                key
                value
              }
            }
          }
        }
      }
    `;

    const data = await shopifyClient.graphql(query);

    console.log('\n=== RAW SHOPIFY DATA ===');
    console.log('Total products found:', data.products.nodes.length);
    data.products.nodes.forEach(p => {
      console.log(`Product: ${p.title}`);
      console.log(`  - Type: ${p.productType}`);
      console.log(`  - Tags:`, p.tags);
      console.log(`  - Variants: ${p.variants.nodes.length}`);
      p.variants.nodes.slice(0, 2).forEach(v => {
        console.log(`    - ${v.title} (${v.price})`);
        console.log(`      Options:`, v.selectedOptions);
      });
    });
    console.log('========================\n');

    // Sammle alle einzigartigen Farben über alle Produkte
    const allColors = new Set();
    const colorHexMap = {
      'weiss': '#FFFFFF',
      'schwarz': '#1F2937',
      'gold': '#FFD700',
      'silber': '#C0C0C0',
      'mint': '#8CC9BF',
      'rosa': '#FDA4AF',
      'rose': '#FDA4AF',
      'rosé': '#FDA4AF',
      'blau': '#3B82F6',
      'rot': '#EF4444',
      'grün': '#10B981',
      'gelb': '#F59E0B',
    };

    // Funktion um Farbe aus Variant zu extrahieren
    function extractColor(variant) {
      // Prüfe zuerst selectedOptions (Shopify Standard)
      const colorOption = variant.selectedOptions?.find(
        opt => opt.name.toLowerCase() === 'farbe' ||
               opt.name.toLowerCase() === 'color' ||
               opt.name.toLowerCase() === 'colour'
      );

      if (colorOption) {
        return colorOption.value;
      }

      // Fallback: Aus Variant Title extrahieren
      const variantTitle = variant.title.toLowerCase();

      // Bekannte Farben suchen
      const colorKeywords = ['weiß', 'weiss', 'white', 'schwarz', 'black',
                            'gold', 'silber', 'silver',
                            'mint', 'grün', 'green', 'rosé', 'rose', 'rosa',
                            'pink', 'blau', 'blue', 'rot', 'red', 'gelb', 'yellow'];

      for (const keyword of colorKeywords) {
        if (variantTitle.includes(keyword)) {
          return keyword;
        }
      }

      return variant.title; // Kompletter Titel als Fallback
    }

    // Normalisiere Farb-Namen
    function normalizeColor(color) {
      const normalized = color.toLowerCase().trim();

      // Mapping für verschiedene Schreibweisen
      if (normalized.includes('weiß') || normalized.includes('weiss') || normalized === 'white') {
        return 'weiss';
      }
      if (normalized.includes('schwarz') || normalized === 'black') {
        return 'schwarz';
      }
      if (normalized.includes('mint') || normalized.includes('türkis')) {
        return 'mint';
      }
      if (normalized.includes('rosé') || normalized.includes('rose') ||
          normalized.includes('rosa') || normalized === 'pink') {
        return 'rose';
      }
      if (normalized.includes('blau') || normalized === 'blue') {
        return 'blau';
      }
      if (normalized.includes('rot') || normalized === 'red') {
        return 'rot';
      }
      if (normalized.includes('grün') || normalized === 'green') {
        return 'gruen';
      }
      if (normalized.includes('gelb') || normalized === 'yellow') {
        return 'gelb';
      }
      if (normalized.includes('gold')) {
        return 'gold';
      }
      if (normalized.includes('silber') || normalized === 'silver') {
        return 'silber';
      }

      return normalized.replace(/[^a-z0-9]/g, '');
    }

    // Transformiere Produkte
    const products = [];
    const variantMapping = {};
    const colorDetails = {};

    for (const product of data.products.nodes) {
      // Filter: Nur Produkte vom Typ "Fotobox" oder mit "fotobox" im Titel
      const isFotobox =
        product.productType?.toLowerCase().includes('fotobox') ||
        product.title.toLowerCase().includes('fotobox');

      if (!isFotobox) {
        console.log(`⏭️  Skipping non-fotobox product: ${product.title} (type: ${product.productType})`);
        continue;
      }

      // Erstelle Product ID aus Title (URL-safe)
      const productId = product.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      // Hole Preis vom ersten Variant (oder günstigsten)
      const prices = product.variants.nodes
        .map(v => {
          // Shopify gibt Preise als String zurück, z.B. "299.00"
          const price = parseFloat(v.price);
          console.log(`Variant ${v.title}: price string="${v.price}", parsed=${price}`);
          return price;
        })
        .filter(p => !isNaN(p) && p > 0);

      const minPrice = prices.length > 0 ? Math.min(...prices).toFixed(0) : '0';
      console.log(`Product ${product.title}: prices=${prices}, minPrice=${minPrice}`);

      // Features aus Datenbank laden (mit Gruppen)
      let features = [];
      let featureGroups = [];
      let ungroupedFeatures = [];

      try {
        const dbFeatures = await productFeatureQueries.getByProduct(productId);

        // Nur aktivierte Features
        // PostgreSQL: enabled ist BOOLEAN (true/false)
        const enabledFeatures = dbFeatures.filter(f => f.enabled === true);

        // Für Abwärtskompatibilität: Flache Feature-Liste
        features = enabledFeatures.map(f => f.name);

        // Lade Gruppen für gruppierte Darstellung
        const groups = await featureGroupQueries.getAll();

        // Gruppiere Features nach group_id
        featureGroups = groups.map(group => ({
          id: group.id,
          name: group.name,
          displayOrder: group.display_order,
          features: enabledFeatures
            .filter(f => f.group_id === group.id)
            .map(f => ({
              id: f.id,
              name: f.name,
              displayOrder: f.display_order,
              customText: f.custom_text || null
            }))
        })).filter(group => group.features.length > 0); // Nur Gruppen mit Features

        // Ungrouped Features
        ungroupedFeatures = enabledFeatures
          .filter(f => !f.group_id)
          .map(f => ({
            id: f.id,
            name: f.name,
            displayOrder: f.display_order,
            customText: f.custom_text || null
          }));

        console.log(`Product ${productId}: Loaded ${features.length} features (${featureGroups.length} groups, ${ungroupedFeatures.length} ungrouped)`);
      } catch (error) {
        console.error(`Error loading features for ${productId}:`, error);

        // Fallback: Versuche Features aus Shopify zu laden
        const featuresMetafield = product.metafields.nodes.find(m => m.key === 'features');

        if (featuresMetafield) {
          try {
            features = JSON.parse(featuresMetafield.value);
          } catch (e) {
            features = featuresMetafield.value.split('\n').filter(f => f.trim());
          }
        } else if (product.description) {
          // Extrahiere Features aus Description (z.B. Bullet Points)
          const lines = product.description.split('\n');
          features = lines
            .filter(line => line.trim().startsWith('-') || line.trim().startsWith('•'))
            .map(line => line.replace(/^[-•]\s*/, '').trim())
            .filter(f => f.length > 0);
        }

        // Wenn keine Features gefunden, verwende Platzhalter
        if (features.length === 0) {
          features = [
            'Professionelle Fotobox',
            'Hochwertige Kamera',
            'Digitale Galerie',
            'Sofortdruck-Funktion'
          ];
        }
      }

      // Popular-Status: Premium ist immer popular, alle anderen nicht
      // (Überschreibt Shopify Tags/Metafields)
      const popular = productId.includes('premium');

      // Erstelle Variant Mapping
      const productVariants = {};
      for (const variant of product.variants.nodes) {
        const color = extractColor(variant);
        const colorId = normalizeColor(color);

        // Sammle Farbe für globale Liste
        allColors.add(colorId);

        // Speichere Farb-Details
        if (!colorDetails[colorId]) {
          colorDetails[colorId] = {
            id: colorId,
            name: color,
            hex: colorHexMap[colorId] || '#808080' // Grau als Fallback
          };
        }

        const key = `${productId}-${colorId}`;
        productVariants[key] = {
          gid: variant.id,
          numericId: extractNumericId(variant.id)
        };
        variantMapping[key] = {
          gid: variant.id,
          numericId: extractNumericId(variant.id)
        };
      }

      products.push({
        id: productId,
        name: product.title,
        price: minPrice,
        popular,
        features, // Flache Liste für Abwärtskompatibilität
        featureGroups, // Gruppierte Features für neue UI
        ungroupedFeatures, // Features ohne Gruppe
        variants: productVariants,
        shopifyProductId: product.id,
        totalVariants: product.variants.nodes.length,
        description: product.descriptionHtml || product.description
      });
    }

    // Konvertiere Set zu Array für Farben
    const colors = Array.from(allColors).map(colorId => colorDetails[colorId]);

    // Debug logging
    console.log('\n=== PRODUCTS API RESPONSE DEBUG ===');
    console.log('Products:', products.map(p => ({ id: p.id, name: p.name })));
    console.log('Colors:', colors);
    console.log('Variant Mapping Keys:', Object.keys(variantMapping));
    console.log('Sample Variant Mapping:', Object.fromEntries(
      Object.entries(variantMapping).slice(0, 5)
    ));
    console.log('===================================\n');

    res.json({
      success: true,
      products,
      colors,
      variantMapping,
      metadata: {
        totalProducts: products.length,
        totalColors: colors.length,
        totalVariants: Object.keys(variantMapping).length,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error loading products:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load products',
      message: error.message
    });
  }
});

/**
 * GET /api/products/addon/:variantGid
 *
 * Findet das passende Zusatztag-Produkt für eine gegebene Variante
 * Verwendet Tag-Matching: Haupt-Produkt und Zusatztag-Produkt haben den gleichen Tag
 */
router.get('/addon/:variantGid', async (req, res) => {
  try {
    const { variantGid } = req.params;

    console.log('[Products API] Finding addon product for variant:', variantGid);

    // Hole Haupt-Produkt für die Variante
    const variantQuery = `
      query getVariant($id: ID!) {
        productVariant(id: $id) {
          id
          product {
            id
            title
            tags
          }
        }
      }
    `;

    const variantData = await shopifyClient.graphql(variantQuery, { id: variantGid });

    if (!variantData.productVariant) {
      return res.status(404).json({
        success: false,
        error: 'Variant not found'
      });
    }

    const mainProduct = variantData.productVariant.product;
    console.log('[Products API] Main product:', mainProduct.title, 'Tags:', mainProduct.tags);

    if (!mainProduct.tags || mainProduct.tags.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Main product has no tags'
      });
    }

    // Suche nach Produkten mit "zusatztag" im Titel UND gleichem Tag
    const searchQuery = `
      query searchProducts($query: String!) {
        products(first: 20, query: $query) {
          nodes {
            id
            title
            tags
            handle
            variants(first: 1) {
              nodes {
                id
                price
              }
            }
          }
        }
      }
    `;

    // Finde den richtigen Produkt-Tag (basic, premium, luxury)
    // Ignoriere Tags wie "popular", "featured", etc.
    const productTiers = ['basic', 'premium', 'luxury'];
    const mainTag = mainProduct.tags.find(tag =>
      productTiers.some(tier => tag.toLowerCase().includes(tier))
    ) || mainProduct.tags[0]; // Fallback auf ersten Tag wenn kein Tier-Tag gefunden

    console.log('[Products API] Using tag for addon search:', mainTag);

    const searchData = await shopifyClient.graphql(searchQuery, {
      query: `tag:${mainTag}`
    });

    console.log('[Products API] Found products with tag:', searchData.products.nodes.length);

    // Finde das Zusatztag-Produkt (enthält "zusatztag" im Titel)
    const addonProduct = searchData.products.nodes.find(p =>
      p.title.toLowerCase().includes('zusatztag')
    );

    if (!addonProduct) {
      console.warn('[Products API] No addon product found for tag:', mainTag);
      return res.status(404).json({
        success: false,
        error: 'No addon product found',
        mainTag
      });
    }

    console.log('[Products API] Found addon product:', addonProduct.title);

    res.json({
      success: true,
      addonProduct: {
        id: addonProduct.id,
        title: addonProduct.title,
        handle: addonProduct.handle,
        tags: addonProduct.tags,
        variantId: addonProduct.variants.nodes[0].id,
        numericVariantId: extractNumericId(addonProduct.variants.nodes[0].id),
        price: parseFloat(addonProduct.variants.nodes[0].price)
      },
      mainProduct: {
        id: mainProduct.id,
        title: mainProduct.title,
        tag: mainTag
      }
    });

  } catch (error) {
    console.error('[Products API] Error finding addon product:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to find addon product',
      message: error.message
    });
  }
});

/**
 * GET /api/products/:productId
 *
 * Lädt ein spezifisches Produkt mit allen Details
 */
router.get('/:productId', async (req, res) => {
  try {
    const { productId } = req.params;

    const query = `
      query getProduct($id: ID!) {
        product(id: $id) {
          id
          title
          description
          productType
          tags
          variants(first: 20) {
            nodes {
              id
              title
              price
              inventoryQuantity
              selectedOptions {
                name
                value
              }
            }
          }
          metafields(first: 10) {
            nodes {
              namespace
              key
              value
              type
            }
          }
        }
      }
    `;

    const variables = { id: productId };
    const data = await shopifyClient.graphql(query, variables);

    if (!data.product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    res.json({
      success: true,
      product: data.product
    });

  } catch (error) {
    console.error('Error loading product:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load product',
      message: error.message
    });
  }
});

export default router;
