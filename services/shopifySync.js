/**
 * Shopify Product Sync Service
 *
 * Synchronisiert Produktdaten (Titel, Preis) von Shopify zur lokalen Datenbank
 * WICHTIG: Die Inventar-Anzahlen (total_units) werden NICHT überschrieben!
 * Diese werden nur lokal im Admin Panel verwaltet.
 */

import shopifyClient from '../config/shopify.js';
import { variantInventoryQueries } from '../db/database.js';

class ShopifySync {
  constructor() {
    this.syncInterval = null;
    // Sync alle 6 Stunden (in Millisekunden)
    this.intervalMs = parseInt(process.env.SHOPIFY_SYNC_INTERVAL_HOURS || '6') * 60 * 60 * 1000;
  }

  /**
   * Startet die automatische Synchronisation
   */
  start() {
    console.log(`[ShopifySync] Starting automatic product sync (every ${this.intervalMs / (60 * 60 * 1000)} hours)`);

    // Sofort beim Start einmal synchronisieren
    this.syncProductData().catch(err => {
      console.error('[ShopifySync] Initial sync failed:', err);
    });

    // Dann regelmäßig wiederholen
    this.syncInterval = setInterval(() => {
      this.syncProductData().catch(err => {
        console.error('[ShopifySync] Scheduled sync failed:', err);
      });
    }, this.intervalMs);
  }

  /**
   * Stoppt die automatische Synchronisation
   */
  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('[ShopifySync] Automatic sync stopped');
    }
  }

  /**
   * Synchronisiert Produktdaten von Shopify
   * Aktualisiert NUR: product_title, variant_title, price
   * Lässt total_units UNVERÄNDERT
   */
  async syncProductData() {
    const startTime = Date.now();
    console.log('[ShopifySync] Starting product data sync from Shopify...');

    try {
      // Hole alle Produkte von Shopify
      const query = `
        query getAllProducts {
          products(first: 250) {
            nodes {
              id
              title
              variants(first: 100) {
                nodes {
                  id
                  title
                  price
                }
              }
            }
          }
        }
      `;

      const response = await shopifyClient.graphql(query);
      const products = response.products.nodes;

      console.log(`[ShopifySync] Fetched ${products.length} products from Shopify`);

      // Filtere nur Photobox-Produkte
      const photoboxProducts = products.filter(p => p.title.includes('Photobox'));

      if (photoboxProducts.length === 0) {
        console.warn('[ShopifySync] No Photobox products found in Shopify');
        return { success: false, message: 'No Photobox products found' };
      }

      let updatedCount = 0;
      let skippedCount = 0;
      let newCount = 0;

      // Verarbeite jedes Produkt
      for (const product of photoboxProducts) {
        for (const variant of product.variants.nodes) {
          const variantGid = variant.id;
          const numericId = variant.id.split('/').pop();

          // Prüfe ob Variante bereits in DB existiert
          const existing = await variantInventoryQueries.getByVariantGid(variantGid);

          if (existing) {
            // Variante existiert: Aktualisiere NUR Produktdaten, NICHT total_units
            const hasChanges =
              existing.product_title !== product.title ||
              existing.variant_title !== (variant.title || 'Standard') ||
              String(existing.price) !== String(variant.price);

            if (hasChanges) {
              // UPDATE nur die Metadaten, total_units bleibt unverändert
              await variantInventoryQueries.updateMetadata(
                product.title,
                variant.title || 'Standard',
                variant.price,
                variantGid
              );

              console.log(`[ShopifySync] ✓ Updated: ${product.title} - ${variant.title}`);
              updatedCount++;
            } else {
              skippedCount++;
            }
          } else {
            // Neue Variante: Füge mit Standardwert 1 hinzu
            await variantInventoryQueries.upsert(
              variantGid,
              numericId,
              product.title,
              variant.title || 'Standard',
              1, // Standardwert für neue Varianten
              variant.price
            );

            console.log(`[ShopifySync] ➕ New variant added: ${product.title} - ${variant.title}`);
            newCount++;
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log('[ShopifySync] =====================================');
      console.log(`[ShopifySync] Sync completed in ${duration}s`);
      console.log(`[ShopifySync] Updated: ${updatedCount}`);
      console.log(`[ShopifySync] New: ${newCount}`);
      console.log(`[ShopifySync] Unchanged: ${skippedCount}`);
      console.log('[ShopifySync] =====================================');

      return {
        success: true,
        updated: updatedCount,
        new: newCount,
        unchanged: skippedCount,
        duration: parseFloat(duration)
      };

    } catch (error) {
      console.error('[ShopifySync] Sync failed:', error);
      throw error;
    }
  }

  /**
   * Manueller Sync (kann vom Admin Panel aufgerufen werden)
   */
  async manualSync() {
    console.log('[ShopifySync] Manual sync requested');
    return await this.syncProductData();
  }
}

// Singleton-Instanz
const shopifySync = new ShopifySync();

export default shopifySync;
