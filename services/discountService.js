/**
 * Discount Code Service
 *
 * Verwaltet Rabattcodes mit bidirektionaler Shopify-Synchronisation
 */

import shopifyClient from '../config/shopify.js';
import {
  discountCodeQueries,
  discountCodeProductQueries,
  discountCodeUsageQueries,
  discountCodeSyncLogQueries,
} from '../db/database.js';


class DiscountService {
  /**
   * CRUD OPERATIONS
   */

  /**
   * Erstellt einen neuen Rabattcode (lokal + Shopify)
   *
   * @param {object} discountData - Discount configuration
   * @param {string} createdBy - Username of creator
   * @returns {Promise<object>} Created discount with Shopify ID
   */
  async createDiscount(discountData, createdBy) {
    console.log('[DiscountService] Creating discount:', discountData.code);

    const {
      code,
      title,
      description,
      discount_type,
      value,
      usage_limit,
      usage_limit_per_customer,
      minimum_purchase_amount,
      starts_at,
      ends_at,
      applies_to_all_products,
      variant_gids,
    } = discountData;

    // Validierung
    if (!code || !title || !discount_type || value === undefined) {
      throw new Error('Missing required fields: code, title, discount_type, value');
    }

    // 1. Erstelle lokal (ohne shopify_discount_id)
    const result = await discountCodeQueries.create(
      code.toUpperCase(),
      title,
      description || null,
      null, // shopify_discount_id - wird später gesetzt
      discount_type,
      value,
      usage_limit || null,
      usage_limit_per_customer || 1,
      minimum_purchase_amount || null,
      starts_at,
      ends_at || null,
      applies_to_all_products ? 1 : 0,
      'active',
      createdBy
    );

    const discountId = result?.id;

    // 2. Füge Produkt-Restrictions hinzu (falls nicht alle Produkte)
    if (!applies_to_all_products && variant_gids && variant_gids.length > 0) {
      for (const variantGid of variant_gids) {
        await discountCodeProductQueries.add(discountId, variantGid);
      }
    }

    try {
      // 3. Erstelle in Shopify
      const shopifyDiscount = await this.createInShopify(discountData);
      console.log(`[DiscountService] Shopify response:`, JSON.stringify(shopifyDiscount, null, 2));

      // 4. Update mit Shopify ID
      console.log(`[DiscountService] Updating local DB with Shopify ID: ${shopifyDiscount.id}, discount ID: ${discountId}`);
      await discountCodeQueries.updateShopifyId(shopifyDiscount.id, discountId);

      console.log(`[DiscountService] ✓ Created discount ${code} with Shopify ID ${shopifyDiscount.id}`);

      // 5. Log sync
      await discountCodeSyncLogQueries.add(
        discountId,
        shopifyDiscount.id,
        'created',
        JSON.stringify({ code, title, discount_type, value })
      );

      return {
        id: discountId,
        shopify_discount_id: shopifyDiscount.id,
        ...discountData,
      };
    } catch (error) {
      // Rollback: Lösche lokalen Eintrag bei Shopify-Fehler
      console.error('[DiscountService] Shopify creation failed, rolling back:', error.message);
      await discountCodeQueries.softDelete(discountId);

      // Auch Produkt-Restrictions löschen
      if (!applies_to_all_products && variant_gids) {
        await discountCodeProductQueries.removeAll(discountId);
      }

      throw new Error(`Failed to create discount in Shopify: ${error.message}`);
    }
  }

  /**
   * Aktualisiert einen Rabattcode (lokal + Shopify)
   *
   * @param {number} id - Local discount ID
   * @param {object} discountData - Updated discount data
   * @returns {Promise<object>} Updated discount
   */
  async updateDiscount(id, discountData) {
    console.log('[DiscountService] Updating discount:', id);

    const existing = await discountCodeQueries.getById(id);
    if (!existing) {
      throw new Error(`Discount code ${id} not found`);
    }

    const {
      title,
      description,
      value,
      usage_limit,
      usage_limit_per_customer,
      minimum_purchase_amount,
      starts_at,
      ends_at,
      status,
    } = discountData;

    // 1. Update lokal
    await discountCodeQueries.update(
      title || existing.title,
      description !== undefined ? description : existing.description,
      value !== undefined ? value : existing.value,
      usage_limit !== undefined ? usage_limit : existing.usage_limit,
      usage_limit_per_customer !== undefined ? usage_limit_per_customer : existing.usage_limit_per_customer,
      minimum_purchase_amount !== undefined ? minimum_purchase_amount : existing.minimum_purchase_amount,
      starts_at || existing.starts_at,
      ends_at !== undefined ? ends_at : existing.ends_at,
      status || existing.status,
      id
    );

    // 2. Update in Shopify (falls Shopify ID existiert)
    if (existing.shopify_discount_id) {
      try {
        await this.updateInShopify(existing.shopify_discount_id, {
          ...existing,
          ...discountData,
        });

        console.log(`[DiscountService] ✓ Updated discount ${existing.code} in Shopify`);

        // Log sync
        await discountCodeSyncLogQueries.add(
          id,
          existing.shopify_discount_id,
          'updated',
          JSON.stringify(discountData)
        );
      } catch (error) {
        // Rollback: Lade von Shopify und überschreibe lokal
        console.error('[DiscountService] Shopify update failed, reverting:', error.message);

        try {
          const shopifyDiscount = await shopifyClient.getDiscountCode(existing.shopify_discount_id);
          const shopifyData = this.parseShopifyDiscount(shopifyDiscount);

          // Revert local changes
          await discountCodeQueries.update(
            shopifyData.title,
            shopifyData.description,
            shopifyData.value,
            shopifyData.usage_limit,
            shopifyData.usage_limit_per_customer,
            shopifyData.minimum_purchase_amount,
            shopifyData.starts_at,
            shopifyData.ends_at,
            shopifyData.status,
            id
          );

          console.log('[DiscountService] ✓ Reverted to Shopify version');
        } catch (revertError) {
          console.error('[DiscountService] Failed to revert from Shopify:', revertError.message);
        }

        throw new Error(`Failed to update discount in Shopify: ${error.message}`);
      }
    }

    return await discountCodeQueries.getById(id);
  }

  /**
   * Löscht einen Rabattcode (lokal + Shopify)
   *
   * @param {number} id - Local discount ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteDiscount(id) {
    console.log('[DiscountService] Deleting discount:', id);

    const existing = await discountCodeQueries.getById(id);
    if (!existing) {
      throw new Error(`Discount code ${id} not found`);
    }

    console.log(`[DiscountService] Found discount: ${existing.code}, Shopify ID: ${existing.shopify_discount_id}`);

    // 1. Lösche in Shopify (falls vorhanden)
    if (existing.shopify_discount_id) {
      try {
        console.log(`[DiscountService] Attempting to delete from Shopify: ${existing.shopify_discount_id}`);
        await this.deleteInShopify(existing.shopify_discount_id);
        console.log(`[DiscountService] ✓ Deleted discount ${existing.code} from Shopify`);

        // Log sync
        await discountCodeSyncLogQueries.add(
          id,
          existing.shopify_discount_id,
          'deleted',
          JSON.stringify({ code: existing.code })
        );
      } catch (error) {
        console.error('[DiscountService] Shopify deletion failed:', error.message);
        console.error('[DiscountService] Full error:', error);
        throw new Error(`Failed to delete discount from Shopify: ${error.message}`);
      }
    } else {
      console.log(`[DiscountService] No Shopify ID found, skipping Shopify deletion`);
    }

    // 2. Hard delete aus Datenbank (inkl. verknüpfte Daten)
    await discountCodeProductQueries.removeAll(id);
    await discountCodeQueries.hardDelete(id);

    console.log(`[DiscountService] ✓ Deleted discount ${existing.code} from database`);
    return true;
  }

  /**
   * Aktiviert oder deaktiviert einen Rabattcode
   *
   * @param {number} id - Local discount ID
   * @param {boolean} active - True to activate, false to deactivate
   * @returns {Promise<object>} Updated discount
   */
  async toggleDiscountStatus(id, active) {
    console.log(`[DiscountService] ${active ? 'Activating' : 'Deactivating'} discount:`, id);

    const existing = await discountCodeQueries.getById(id);
    if (!existing) {
      throw new Error(`Discount code ${id} not found`);
    }

    const newStatus = active ? 'active' : 'inactive';

    // 1. Update in Shopify (falls Shopify ID vorhanden)
    if (existing.shopify_discount_id) {
      try {
        console.log(`[DiscountService] Updating status in Shopify: ${existing.shopify_discount_id}`);

        // Für Shopify: Aktivierung/Deaktivierung durch startsAt/endsAt
        // Wenn deaktiviert: endsAt auf jetzt setzen
        // Wenn aktiviert: endsAt auf ursprüngliches Datum setzen (oder null)
        const updateData = {
          title: existing.title,
          startsAt: existing.starts_at,
          endsAt: active ? existing.ends_at : new Date().toISOString(),
          usageLimit: existing.usage_limit,
          appliesOncePerCustomer: existing.usage_limit_per_customer === 1,
          customerSelection: {
            all: true,
          },
          customerGets: {
            value: existing.discount_type === 'percentage'
              ? { percentage: existing.value / 100 }
              : {
                  discountAmount: {
                    amount: existing.value.toString(),
                    appliesOnEachItem: false,
                  },
                },
            items: {
              all: existing.applies_to_all_products === 1,
            },
          },
        };

        await shopifyClient.updateDiscount(existing.shopify_discount_id, updateData);
        console.log(`[DiscountService] ✓ Updated status in Shopify`);

        // Log sync
        await discountCodeSyncLogQueries.add(
          id,
          existing.shopify_discount_id,
          'updated',
          JSON.stringify({ code: existing.code, action: active ? 'activated' : 'deactivated' })
        );
      } catch (error) {
        console.error('[DiscountService] Shopify status update failed:', error.message);
        throw new Error(`Failed to update discount status in Shopify: ${error.message}`);
      }
    } else {
      console.log(`[DiscountService] No Shopify ID found, skipping Shopify update`);
    }

    // 2. Update lokal
    await discountCodeQueries.updateStatus(newStatus, id);

    console.log(`[DiscountService] ✓ ${active ? 'Activated' : 'Deactivated'} discount ${existing.code}`);
    return await discountCodeQueries.getById(id);
  }

  /**
   * Holt einen Rabattcode
   *
   * @param {number} id - Local discount ID
   * @returns {object} Discount code data
   */
  async getDiscount(id) {
    const discount = await discountCodeQueries.getById(id);
    if (!discount) {
      throw new Error(`Discount code ${id} not found`);
    }

    // Lade zugehörige Produkte (falls produktspezifisch)
    if (!discount.applies_to_all_products) {
      const products = await discountCodeProductQueries.getByDiscount(id);
      discount.variant_gids = products.map((p) => p.variant_gid);
    }

    return discount;
  }

  /**
   * Holt alle Rabattcodes mit optionalen Filtern
   *
   * @param {object} filters - Filter options
   * @returns {Array} Array of discount codes
   */
  async getAllDiscounts(filters = {}) {
    let discounts = await discountCodeQueries.getAll();

    // Filter by status
    if (filters.status && filters.status !== 'all') {
      discounts = discounts.filter((d) => d.status === filters.status);
    }

    // Filter by type
    if (filters.type && filters.type !== 'all') {
      discounts = discounts.filter((d) => d.discount_type === filters.type);
    }

    // Filter active only
    if (filters.active_only) {
      discounts = discounts.filter((d) => d.status === 'active');
    }

    return discounts;
  }

  /**
   * SHOPIFY SYNC METHODS
   */

  /**
   * Erstellt Discount in Shopify
   *
   * @param {object} discountData - Discount configuration
   * @returns {Promise<object>} Shopify discount node
   */
  async createInShopify(discountData) {
    const {
      code,
      title,
      discount_type,
      value,
      usage_limit,
      usage_limit_per_customer,
      minimum_purchase_amount,
      starts_at,
      ends_at,
      applies_to_all_products,
      variant_gids,
    } = discountData;

    // Free Shipping Discount
    if (discount_type === 'free_shipping') {
      const freeShippingInput = {
        title,
        code,
        startsAt: starts_at,
        endsAt: ends_at || null,
        usageLimit: usage_limit || null,
        appliesOncePerCustomer: usage_limit_per_customer === 1,
        customerSelection: {
          all: true, // Apply to all customers
        },
      };

      return await shopifyClient.createFreeShippingDiscount(freeShippingInput);
    }

    // Basic Discount (Percentage or Fixed Amount)
    const basicDiscountInput = {
      title,
      code,
      startsAt: starts_at,
      endsAt: ends_at || null,
      usageLimit: usage_limit || null,
      appliesOncePerCustomer: usage_limit_per_customer === 1,
      customerSelection: {
        all: true, // Apply to all customers
      },
      customerGets: {
        value: discount_type === 'percentage'
          ? { percentage: value / 100 } // 10 → 0.1
          : {
              discountAmount: {
                amount: value.toString(),
                appliesOnEachItem: false,
              },
            },
        items: applies_to_all_products
          ? { all: true }
          : {
              productVariants: {
                add: variant_gids || [],
              },
            },
      },
    };

    // Minimum purchase amount
    if (minimum_purchase_amount) {
      basicDiscountInput.minimumRequirement = {
        greaterThanOrEqualToSubtotal: {
          amount: minimum_purchase_amount.toString(),
        },
      };
    }

    return await shopifyClient.createBasicDiscount(basicDiscountInput);
  }

  /**
   * Aktualisiert Discount in Shopify
   *
   * @param {string} shopifyDiscountId - Shopify Discount GID
   * @param {object} discountData - Updated discount data
   * @returns {Promise<object>} Updated shopify discount
   */
  async updateInShopify(shopifyDiscountId, discountData) {
    const {
      title,
      discount_type,
      value,
      usage_limit,
      usage_limit_per_customer,
      minimum_purchase_amount,
      starts_at,
      ends_at,
      applies_to_all_products,
      variant_gids,
    } = discountData;

    // Note: Free shipping cannot be updated to basic or vice versa
    // Only update if it's a basic discount
    if (discount_type === 'free_shipping') {
      console.warn('[DiscountService] Cannot update free shipping discount via API');
      return;
    }

    const basicDiscountInput = {
      title,
      startsAt: starts_at,
      endsAt: ends_at || null,
      usageLimit: usage_limit || null,
      appliesOncePerCustomer: usage_limit_per_customer === 1,
      customerSelection: {
        all: true, // Apply to all customers
      },
      customerGets: {
        value: discount_type === 'percentage'
          ? { percentage: value / 100 }
          : {
              discountAmount: {
                amount: value.toString(),
                appliesOnEachItem: false,
              },
            },
        items: applies_to_all_products
          ? { all: true }
          : {
              productVariants: {
                add: variant_gids || [],
              },
            },
      },
    };

    if (minimum_purchase_amount) {
      basicDiscountInput.minimumRequirement = {
        greaterThanOrEqualToSubtotal: {
          amount: minimum_purchase_amount.toString(),
        },
      };
    }

    return await shopifyClient.updateDiscount(shopifyDiscountId, basicDiscountInput);
  }

  /**
   * Löscht Discount in Shopify
   *
   * @param {string} shopifyDiscountId - Shopify Discount GID
   * @returns {Promise<boolean>} Success status
   */
  async deleteInShopify(shopifyDiscountId) {
    console.log(`[DiscountService] Calling Shopify deleteDiscount API for ID: ${shopifyDiscountId}`);
    const result = await shopifyClient.deleteDiscount(shopifyDiscountId);
    console.log(`[DiscountService] Shopify deleteDiscount result:`, result);
    return result;
  }

  /**
   * Parsed Shopify Discount zu lokalem Format
   *
   * @param {object} shopifyDiscount - Shopify discount node
   * @returns {object} Parsed discount data
   */
  parseShopifyDiscount(shopifyDiscount) {
    const codeDiscount = shopifyDiscount.codeDiscount;
    const code = codeDiscount.codes?.nodes?.[0]?.code || 'UNKNOWN';

    // Determine discount type
    let discount_type = 'percentage';
    let value = 0;

    if (codeDiscount.__typename === 'DiscountCodeFreeShipping') {
      discount_type = 'free_shipping';
      value = 0;
    } else if (codeDiscount.customerGets?.value?.percentage) {
      discount_type = 'percentage';
      value = codeDiscount.customerGets.value.percentage * 100; // 0.1 → 10
    } else if (codeDiscount.customerGets?.value?.amount) {
      discount_type = 'fixed_amount';
      value = parseFloat(codeDiscount.customerGets.value.amount.amount);
    }

    // Extract variant GIDs (if product-specific)
    const applies_to_all_products = codeDiscount.customerGets?.items?.allItems || false;
    let variant_gids = [];
    if (!applies_to_all_products && codeDiscount.customerGets?.items?.productVariants) {
      variant_gids = codeDiscount.customerGets.items.productVariants.nodes.map((v) => v.id);
    }

    // Minimum purchase amount
    let minimum_purchase_amount = null;
    if (codeDiscount.minimumRequirement?.greaterThanOrEqualToSubtotal) {
      minimum_purchase_amount = parseFloat(
        codeDiscount.minimumRequirement.greaterThanOrEqualToSubtotal.amount
      );
    }

    return {
      code,
      title: codeDiscount.title,
      shopify_discount_id: shopifyDiscount.id,
      discount_type,
      value,
      usage_limit: codeDiscount.usageLimit,
      usage_limit_per_customer: codeDiscount.appliesOncePerCustomer ? 1 : null,
      minimum_purchase_amount,
      starts_at: codeDiscount.startsAt,
      ends_at: codeDiscount.endsAt,
      status: codeDiscount.status === 'ACTIVE' ? 'active' : 'inactive',
      applies_to_all_products: applies_to_all_products ? 1 : 0,
      variant_gids,
      async_usage_count: codeDiscount.asyncUsageCount || 0,
    };
  }

  /**
   * USAGE TRACKING
   */

  /**
   * Tracked Discount-Verwendung (aus Shopify Order Webhook)
   *
   * @param {string} code - Discount code
   * @param {object} orderData - Order data from webhook
   * @returns {Promise<void>}
   */
  async trackUsage(code, orderData) {
    console.log('[DiscountService] Tracking usage for code:', code);

    // Finde Discount by code
    const discount = await discountCodeQueries.getByCode(code.toUpperCase());
    if (!discount) {
      console.warn(`[DiscountService] Discount code ${code} not found in local DB`);
      return;
    }

    const { shopifyOrderId, customerEmail, discountAmount, orderTotal, customerId, orderId } = orderData;

    // Füge usage record hinzu
    await discountCodeUsageQueries.add(
      discount.id,
      orderId || null,
      shopifyOrderId,
      customerId || null,
      customerEmail,
      discountAmount,
      orderTotal || 0
    );

    console.log(`[DiscountService] ✓ Tracked usage of ${code} for ${customerEmail}`);
  }

  /**
   * Holt Usage Stats für einen Discount
   *
   * @param {number} discountId - Local discount ID
   * @returns {Promise<object>} Usage statistics
   */
  async getUsageStats(discountId) {
    const totalUses = await discountCodeUsageQueries.countByDiscount(discountId);

    const discount = await discountCodeQueries.getById(discountId);
    const usageLimit = discount?.usage_limit || null;

    return {
      total_uses: totalUses?.total || 0,
      usage_limit: usageLimit,
      remaining: usageLimit ? Math.max(0, usageLimit - (totalUses?.total || 0)) : null,
    };
  }

  /**
   * Holt Usage History
   *
   * @param {number} discountId - Local discount ID
   * @param {object} options - Pagination options
   * @returns {Promise<Array>} Usage history
   */
  async getUsageHistory(discountId, options = {}) {
    const { limit = 50, offset = 0 } = options;
    return await discountCodeUsageQueries.getByDiscountPaginated(discountId, limit, offset);
  }

  /**
   * ANALYTICS
   */

  /**
   * Holt Analytics für einen Discount
   *
   * @param {number} discountId - Local discount ID
   * @param {object} dateRange - Date range filter
   * @returns {Promise<object>} Analytics data
   */
  async getAnalytics(discountId, dateRange = {}) {
    const { startDate, endDate } = dateRange;
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
    const end = endDate || new Date().toISOString();

    const analytics = await discountCodeUsageQueries.getAnalytics(discountId, start, end);

    return {
      total_uses: analytics.total_uses || 0,
      unique_customers: analytics.unique_customers || 0,
      total_discount_given: analytics.total_discount_given || 0,
      total_revenue: analytics.total_revenue || 0,
      avg_order_value: analytics.avg_order_value || 0,
      first_use: analytics.first_use,
      last_use: analytics.last_use,
    };
  }

  /**
   * Holt Customer Behavior (Top Customers)
   *
   * @param {number} discountId - Local discount ID
   * @param {number} limit - Number of top customers
   * @returns {Promise<Array>} Top customers
   */
  async getCustomerBehavior(discountId, limit = 10) {
    return await discountCodeUsageQueries.getTopCustomers(discountId, limit);
  }

  /**
   * Holt zeitliche Analyse (Usage over Time)
   *
   * @param {number} discountId - Local discount ID
   * @param {object} dateRange - Date range filter
   * @returns {Promise<Array>} Usage over time data
   */
  async getTemporalAnalysis(discountId, dateRange = {}) {
    const { startDate, endDate } = dateRange;
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const end = endDate || new Date().toISOString();

    return await discountCodeUsageQueries.getUsageOverTime(discountId, start, end);
  }

  /**
   * Holt Discount Code Statistics (für Dashboard)
   *
   * @returns {Promise<object>} Statistics
   */
  async getStats() {
    const stats = await discountCodeQueries.getStats();

    // Total discount given
    const allUsage = await discountCodeUsageQueries.getByDiscount();
    const totalDiscountGiven = allUsage.reduce((sum, u) => sum + (u.discount_amount || 0), 0);

    return {
      total_codes: stats.total_codes || 0,
      active_codes: stats.active_codes || 0,
      expired_codes: stats.expired_codes || 0,
      inactive_codes: stats.inactive_codes || 0,
      total_discount_given: totalDiscountGiven,
    };
  }

  /**
   * EXPIRY CHECK (für Cron Job)
   */

  /**
   * Markiert abgelaufene Codes
   *
   * @returns {Promise<number>} Number of expired codes
   */
  async expireOutdatedCodes() {
    console.log('[DiscountService] Checking for expired codes...');

    const expiredCodes = await discountCodeQueries.getExpired();

    for (const code of expiredCodes) {
      console.log(`[DiscountService] Expiring code: ${code.code}`);

      // Update status to expired
      await discountCodeQueries.updateStatus('expired', code.id);

      // Optionally: Deactivate in Shopify (not delete)
      if (code.shopify_discount_id) {
        try {
          // Note: Shopify automatically handles expiration, so we just mark locally
          console.log(`[DiscountService] Code ${code.code} expired (Shopify handles this automatically)`);
        } catch (error) {
          console.error(`[DiscountService] Failed to update expired code in Shopify:`, error.message);
        }
      }
    }

    console.log(`[DiscountService] ✓ Expired ${expiredCodes.length} codes`);
    return expiredCodes.length;
  }
}

export default new DiscountService();
