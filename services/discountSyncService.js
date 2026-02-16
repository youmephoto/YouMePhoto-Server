/**
 * Discount Sync Service
 *
 * Bidirektionale Synchronisation zwischen Admin Panel und Shopify
 * Shopify ist immer Master bei Konflikten
 */

import shopifyClient from '../config/shopify.js';
import {
  discountCodeQueries,
  discountCodeProductQueries,
  discountCodeSyncLogQueries,
} from '../db/database.js';
import discountService from './discountService.js';

class DiscountSyncService {
  /**
   * Hauptsync-Funktion: Shopify → Local DB
   * Läuft alle 30 Minuten via Cron Job
   *
   * @returns {Promise<object>} Sync statistics
   */
  async syncFromShopify() {
    console.log('[DiscountSyncService] 🔄 Starting sync from Shopify...');

    const startTime = Date.now();
    const stats = {
      imported: 0,
      updated: 0,
      deleted: 0,
      errors: 0,
    };

    try {
      // 1. Fetch alle Discount Codes von Shopify
      const shopifyDiscounts = await shopifyClient.getAllDiscountCodes(250);
      console.log(`[DiscountSyncService] Fetched ${shopifyDiscounts.length} codes from Shopify`);

      // 2. Lade alle lokalen Codes mit Shopify ID
      const localDiscounts = await discountCodeQueries.getAllWithShopifyId();
      const localDiscountsMap = new Map(
        localDiscounts.map((d) => [d.shopify_discount_id, d])
      );

      // 3. Set of Shopify IDs (um gelöschte zu erkennen)
      const shopifyIds = new Set(shopifyDiscounts.map((d) => d.id));

      // 4. Verarbeite jeden Shopify Code
      for (const shopifyDiscount of shopifyDiscounts) {
        try {
          const shopifyId = shopifyDiscount.id;
          const localDiscount = localDiscountsMap.get(shopifyId);

          if (!localDiscount) {
            // NEU in Shopify → Importieren
            await this.importFromShopify(shopifyDiscount);
            stats.imported++;
          } else {
            // In beiden vorhanden → Prüfe auf Änderungen
            const hasChanges = await this.detectChanges(shopifyDiscount, localDiscount);

            if (hasChanges) {
              await this.updateFromShopify(shopifyDiscount, localDiscount);
              stats.updated++;
            }

            // Remove from map (um gelöschte später zu finden)
            localDiscountsMap.delete(shopifyId);
          }
        } catch (error) {
          console.error(`[DiscountSyncService] Error processing ${shopifyDiscount.id}:`, error.message);
          stats.errors++;
        }
      }

      // 5. Markiere gelöschte Codes (lokal vorhanden, aber nicht in Shopify)
      const deletedCount = await this.markDeletedCodes(Array.from(localDiscountsMap.values()));
      stats.deleted = deletedCount;

      const duration = Date.now() - startTime;
      console.log(
        `[DiscountSyncService] ✓ Sync completed in ${duration}ms - ` +
        `Imported: ${stats.imported}, Updated: ${stats.updated}, Deleted: ${stats.deleted}, Errors: ${stats.errors}`
      );

      return {
        success: true,
        synced: stats.imported + stats.updated + stats.deleted,
        ...stats,
        duration,
      };
    } catch (error) {
      console.error('[DiscountSyncService] Sync failed:', error);
      return {
        success: false,
        error: error.message,
        ...stats,
      };
    }
  }

  /**
   * Importiert neuen Code von Shopify
   *
   * @param {object} shopifyDiscount - Shopify discount node
   * @returns {Promise<void>}
   */
  async importFromShopify(shopifyDiscount) {
    const parsed = discountService.parseShopifyDiscount(shopifyDiscount);

    console.log(`[DiscountSyncService] Importing code: ${parsed.code}`);

    // Erstelle in lokaler DB
    const result = await discountCodeQueries.create(
      parsed.code,
      parsed.title,
      null, // description
      parsed.shopify_discount_id,
      parsed.discount_type,
      parsed.value,
      parsed.usage_limit,
      parsed.usage_limit_per_customer,
      parsed.minimum_purchase_amount,
      parsed.starts_at,
      parsed.ends_at,
      parsed.applies_to_all_products,
      parsed.status,
      'shopify_sync' // created_by
    );

    const discountId = result?.id || result?.lastInsertRowid;

    // Füge Produkt-Restrictions hinzu (falls vorhanden)
    if (!parsed.applies_to_all_products && parsed.variant_gids && parsed.variant_gids.length > 0) {
      for (const variantGid of parsed.variant_gids) {
        try {
          await discountCodeProductQueries.add(discountId, variantGid);
        } catch (error) {
          // Ignore duplicate errors
          if (!error.message.includes('UNIQUE constraint') && !error.message.includes('duplicate key')) {
            console.error(`[DiscountSyncService] Error adding product restriction:`, error.message);
          }
        }
      }
    }

    // Log sync
    await discountCodeSyncLogQueries.add(
      discountId,
      parsed.shopify_discount_id,
      'imported',
      JSON.stringify({ code: parsed.code, title: parsed.title })
    );

    console.log(`[DiscountSyncService] ✓ Imported code ${parsed.code}`);
  }

  /**
   * Aktualisiert lokalen Code von Shopify (Shopify ist Master)
   *
   * @param {object} shopifyDiscount - Shopify discount node
   * @param {object} localDiscount - Local discount record
   * @returns {Promise<void>}
   */
  async updateFromShopify(shopifyDiscount, localDiscount) {
    const parsed = discountService.parseShopifyDiscount(shopifyDiscount);

    console.log(`[DiscountSyncService] Updating code: ${parsed.code}`);

    // Update lokale DB (Shopify ist Master)
    await discountCodeQueries.update(
      parsed.title,
      localDiscount.description, // Keep local description
      parsed.value,
      parsed.usage_limit,
      parsed.usage_limit_per_customer,
      parsed.minimum_purchase_amount,
      parsed.starts_at,
      parsed.ends_at,
      parsed.status,
      localDiscount.id
    );

    // Update Sync timestamp
    await discountCodeQueries.updateSyncTime(localDiscount.id);

    // Update Produkt-Restrictions (falls geändert)
    if (!parsed.applies_to_all_products) {
      // Remove all existing
      await discountCodeProductQueries.removeAll(localDiscount.id);

      // Add new ones
      if (parsed.variant_gids && parsed.variant_gids.length > 0) {
        for (const variantGid of parsed.variant_gids) {
          try {
            await discountCodeProductQueries.add(localDiscount.id, variantGid);
          } catch (error) {
            if (!error.message.includes('UNIQUE constraint') && !error.message.includes('duplicate key')) {
              console.error(`[DiscountSyncService] Error adding product restriction:`, error.message);
            }
          }
        }
      }
    }

    // Log sync
    await discountCodeSyncLogQueries.add(
      localDiscount.id,
      parsed.shopify_discount_id,
      'updated',
      JSON.stringify({
        code: parsed.code,
        changes: {
          value: { from: localDiscount.value, to: parsed.value },
          status: { from: localDiscount.status, to: parsed.status },
        },
      })
    );

    console.log(`[DiscountSyncService] ✓ Updated code ${parsed.code}`);
  }

  /**
   * Erkennt Änderungen zwischen Shopify und lokaler DB
   *
   * @param {object} shopifyDiscount - Shopify discount node
   * @param {object} localDiscount - Local discount record
   * @returns {Promise<boolean>} True if changes detected
   */
  async detectChanges(shopifyDiscount, localDiscount) {
    const parsed = discountService.parseShopifyDiscount(shopifyDiscount);

    // Vergleiche relevante Felder
    const hasChanges =
      parsed.title !== localDiscount.title ||
      parsed.value !== localDiscount.value ||
      parsed.usage_limit !== localDiscount.usage_limit ||
      parsed.status !== localDiscount.status ||
      parsed.starts_at !== localDiscount.starts_at ||
      parsed.ends_at !== localDiscount.ends_at;

    return hasChanges;
  }

  /**
   * Markiert Codes als gelöscht (lokal vorhanden, aber nicht in Shopify)
   *
   * @param {Array} localDiscounts - Array of local discounts not in Shopify
   * @returns {Promise<number>} Number of deleted codes
   */
  async markDeletedCodes(localDiscounts) {
    let deletedCount = 0;

    for (const discount of localDiscounts) {
      // Skip bereits gelöschte
      if (discount.status === 'deleted') {
        continue;
      }

      console.log(`[DiscountSyncService] Marking code as deleted: ${discount.code}`);

      // Soft delete (Status auf 'deleted' setzen)
      await discountCodeQueries.updateStatus('deleted', discount.id);

      // Log sync
      await discountCodeSyncLogQueries.add(
        discount.id,
        discount.shopify_discount_id,
        'deleted',
        JSON.stringify({ code: discount.code, reason: 'Not found in Shopify' })
      );

      deletedCount++;
    }

    if (deletedCount > 0) {
      console.log(`[DiscountSyncService] ✓ Marked ${deletedCount} codes as deleted`);
    }

    return deletedCount;
  }

  /**
   * Synchronisiert einen einzelnen Discount Code
   *
   * @param {string} shopifyDiscountId - Shopify Discount GID
   * @returns {Promise<boolean>} Success status
   */
  async syncSingleDiscount(shopifyDiscountId) {
    console.log(`[DiscountSyncService] Syncing single discount: ${shopifyDiscountId}`);

    try {
      // Fetch von Shopify
      const shopifyDiscount = await shopifyClient.getDiscountCode(shopifyDiscountId);

      if (!shopifyDiscount) {
        console.warn(`[DiscountSyncService] Discount ${shopifyDiscountId} not found in Shopify`);
        return false;
      }

      // Finde lokal
      const localDiscount = await discountCodeQueries.getByShopifyId(shopifyDiscountId);

      if (!localDiscount) {
        // Importieren
        await this.importFromShopify(shopifyDiscount);
      } else {
        // Aktualisieren
        const hasChanges = await this.detectChanges(shopifyDiscount, localDiscount);
        if (hasChanges) {
          await this.updateFromShopify(shopifyDiscount, localDiscount);
        }
      }

      console.log(`[DiscountSyncService] ✓ Synced discount ${shopifyDiscountId}`);
      return true;
    } catch (error) {
      console.error(`[DiscountSyncService] Error syncing discount:`, error);
      return false;
    }
  }

  /**
   * Validiert Sync-Status (für Debugging)
   *
   * @returns {Promise<object>} Sync validation report
   */
  async validateSync() {
    console.log('[DiscountSyncService] 🔍 Validating sync status...');

    const localDiscounts = await discountCodeQueries.getAll();
    const localWithShopifyId = localDiscounts.filter((d) => d.shopify_discount_id);

    const report = {
      total_local: localDiscounts.length,
      with_shopify_id: localWithShopifyId.length,
      without_shopify_id: localDiscounts.length - localWithShopifyId.length,
      active: localDiscounts.filter((d) => d.status === 'active').length,
      deleted: localDiscounts.filter((d) => d.status === 'deleted').length,
      expired: localDiscounts.filter((d) => d.status === 'expired').length,
    };

    console.log('[DiscountSyncService] Validation report:', report);
    return report;
  }

  /**
   * Bereinigt Sync-Log (alte Einträge löschen)
   *
   * @param {number} daysToKeep - Number of days to keep
   * @returns {Promise<number>} Number of deleted log entries
   */
  async cleanupSyncLog(daysToKeep = 90) {
    console.log(`[DiscountSyncService] Cleaning up sync log (keeping ${daysToKeep} days)...`);

    // Note: Würde einen DELETE Query benötigen in database.js
    // Für jetzt nur Info-Log
    console.log('[DiscountSyncService] Sync log cleanup not yet implemented');
    return 0;
  }
}

export default new DiscountSyncService();
