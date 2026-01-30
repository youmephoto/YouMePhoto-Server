import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database file location
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'fotobox.db');

console.log('[Database] Initializing database at:', DB_PATH);

// Create database connection
const db = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize schema
function initializeDatabase() {
  console.log('[Database] Initializing schema...');

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  // Execute schema
  db.exec(schema);

  console.log('[Database] ✓ Schema initialized successfully');
}

// Run migrations
async function runMigrations() {
  try {
    const { runMigrations } = await import('./migrate.js');
    runMigrations(db);
  } catch (error) {
    console.error('[Database] Migration error:', error);
    throw error;
  }
}

// Initialize on startup
try {
  initializeDatabase();
  await runMigrations();
} catch (error) {
  console.error('[Database] Failed to initialize:', error);
  throw error;
}

/**
 * Variant Inventory Queries
 */
export const variantInventoryQueries = {
  /**
   * Get inventory for a specific variant
   */
  getByVariantGid: db.prepare(`
    SELECT * FROM variant_inventory WHERE variant_gid = ?
  `),

  /**
   * Get inventory by numeric ID
   */
  getByNumericId: db.prepare(`
    SELECT * FROM variant_inventory WHERE variant_numeric_id = ?
  `),

  /**
   * Get all variants
   */
  getAll: db.prepare(`
    SELECT * FROM variant_inventory ORDER BY product_title, variant_title
  `),

  /**
   * Insert or update variant inventory
   */
  upsert: db.prepare(`
    INSERT INTO variant_inventory (
      variant_gid,
      variant_numeric_id,
      product_title,
      variant_title,
      total_units,
      price,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(variant_gid) DO UPDATE SET
      total_units = excluded.total_units,
      product_title = excluded.product_title,
      variant_title = excluded.variant_title,
      price = excluded.price,
      updated_at = CURRENT_TIMESTAMP
  `),

  /**
   * Update only the quantity
   */
  updateQuantity: db.prepare(`
    UPDATE variant_inventory
    SET total_units = ?, updated_at = CURRENT_TIMESTAMP
    WHERE variant_gid = ?
  `),

  /**
   * Update only metadata (product_title, variant_title, price)
   * Does NOT change total_units - those are managed locally only
   */
  updateMetadata: db.prepare(`
    UPDATE variant_inventory
    SET product_title = ?,
        variant_title = ?,
        price = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE variant_gid = ?
  `),

  /**
   * Delete variant
   */
  delete: db.prepare(`
    DELETE FROM variant_inventory WHERE variant_gid = ?
  `),
};

/**
 * Inventory History Queries
 */
export const inventoryHistoryQueries = {
  /**
   * Add history entry
   */
  add: db.prepare(`
    INSERT INTO inventory_history (
      variant_gid,
      old_quantity,
      new_quantity,
      changed_by,
      reason
    )
    VALUES (?, ?, ?, ?, ?)
  `),

  /**
   * Get history for a variant
   */
  getByVariant: db.prepare(`
    SELECT * FROM inventory_history
    WHERE variant_gid = ?
    ORDER BY changed_at DESC
    LIMIT 50
  `),

  /**
   * Get recent changes
   */
  getRecent: db.prepare(`
    SELECT h.*, v.product_title, v.variant_title
    FROM inventory_history h
    LEFT JOIN variant_inventory v ON h.variant_gid = v.variant_gid
    ORDER BY h.changed_at DESC
    LIMIT 100
  `),
};

/**
 * Admin User Queries
 */
export const adminUserQueries = {
  /**
   * Find user by username
   */
  findByUsername: db.prepare(`
    SELECT * FROM admin_users WHERE username = ?
  `),

  /**
   * Update last login
   */
  updateLastLogin: db.prepare(`
    UPDATE admin_users
    SET last_login = CURRENT_TIMESTAMP
    WHERE id = ?
  `),
};

/**
 * Blocked Dates Queries
 */
export const blockedDatesQueries = {
  /**
   * Get all blocked dates
   */
  getAll: db.prepare(`
    SELECT * FROM blocked_dates ORDER BY start_date ASC
  `),

  /**
   * Get blocked date by ID
   */
  getById: db.prepare(`
    SELECT * FROM blocked_dates WHERE id = ?
  `),

  /**
   * Add blocked date range
   */
  add: db.prepare(`
    INSERT INTO blocked_dates (start_date, end_date, reason, created_by)
    VALUES (?, ?, ?, ?)
  `),

  /**
   * Delete blocked date
   */
  delete: db.prepare(`
    DELETE FROM blocked_dates WHERE id = ?
  `),

  /**
   * Check if a date is blocked
   * Returns blocked date ranges that overlap with the given date
   */
  isDateBlocked: db.prepare(`
    SELECT * FROM blocked_dates
    WHERE ? BETWEEN start_date AND end_date
  `),

  /**
   * Check if a date range is blocked
   * Returns blocked date ranges that overlap with the given range
   */
  isRangeBlocked: db.prepare(`
    SELECT * FROM blocked_dates
    WHERE (start_date <= ? AND end_date >= ?)
       OR (start_date <= ? AND end_date >= ?)
       OR (start_date >= ? AND end_date <= ?)
  `),
};

/**
 * Bookings Queries
 */
export const bookingsQueries = {
  /**
   * Get all bookings for a variant
   */
  getByVariant: db.prepare(`
    SELECT * FROM bookings
    WHERE variant_gid = ? AND status != 'cancelled'
    ORDER BY event_date ASC
  `),

  /**
   * Get all bookings for a product (all variants)
   */
  getByProduct: db.prepare(`
    SELECT * FROM bookings
    WHERE product_title LIKE ? AND status != 'cancelled'
    ORDER BY event_date ASC
  `),

  /**
   * Get booking by ID
   */
  getById: db.prepare(`
    SELECT * FROM bookings WHERE booking_id = ?
  `),

  /**
   * Get all bookings (with optional status filter)
   */
  getAll: db.prepare(`
    SELECT * FROM bookings ORDER BY created_at DESC LIMIT 1000
  `),

  /**
   * Get only confirmed bookings (for admin panel)
   */
  getConfirmed: db.prepare(`
    SELECT * FROM bookings
    WHERE status = 'confirmed'
    ORDER BY event_date ASC, created_at DESC
  `),

  /**
   * Add new booking
   */
  add: db.prepare(`
    INSERT INTO bookings (
      booking_id,
      variant_gid,
      product_title,
      variant_title,
      customer_email,
      customer_name,
      event_date,
      start_date,
      end_date,
      total_days,
      status,
      order_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  /**
   * Update booking status
   */
  updateStatus: db.prepare(`
    UPDATE bookings
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE booking_id = ?
  `),

  /**
   * Delete booking
   */
  delete: db.prepare(`
    DELETE FROM bookings WHERE booking_id = ?
  `),

  /**
   * Get bookings for date range
   */
  getByDateRange: db.prepare(`
    SELECT * FROM bookings
    WHERE event_date >= ? AND event_date <= ? AND status != 'cancelled'
    ORDER BY event_date ASC
  `),
};

/**
 * Feature Management Queries
 */
export const featureQueries = {
  /**
   * Get all features with their product assignments
   */
  getAllWithProducts: db.prepare(`
    SELECT
      f.id,
      f.name,
      f.display_order,
      GROUP_CONCAT(
        CASE WHEN pf.enabled = 1 THEN pf.product_id END
      ) as enabled_products
    FROM features f
    LEFT JOIN product_features pf ON f.id = pf.feature_id
    GROUP BY f.id
    ORDER BY f.display_order ASC, f.name ASC
  `),

  /**
   * Get all features
   */
  getAll: db.prepare(`
    SELECT * FROM features ORDER BY display_order ASC, name ASC
  `),

  /**
   * Get feature by ID
   */
  getById: db.prepare(`
    SELECT * FROM features WHERE id = ?
  `),

  /**
   * Get feature by name
   */
  getByName: db.prepare(`
    SELECT * FROM features WHERE name = ?
  `),

  /**
   * Add new feature
   */
  add: db.prepare(`
    INSERT INTO features (name, display_order)
    VALUES (?, ?)
  `),

  /**
   * Update feature name
   */
  updateName: db.prepare(`
    UPDATE features
    SET name = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),

  /**
   * Update feature display order
   */
  updateOrder: db.prepare(`
    UPDATE features
    SET display_order = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),

  /**
   * Delete feature (cascades to product_features)
   */
  delete: db.prepare(`
    DELETE FROM features WHERE id = ?
  `),
};

/**
 * Product Features Queries
 */
export const productFeatureQueries = {
  /**
   * Get all features for a product
   */
  getByProduct: db.prepare(`
    SELECT f.id, f.name, f.display_order, pf.enabled
    FROM features f
    LEFT JOIN product_features pf ON f.id = pf.feature_id AND pf.product_id = ?
    ORDER BY f.display_order ASC, f.name ASC
  `),

  /**
   * Get all products for a feature
   */
  getByFeature: db.prepare(`
    SELECT product_id, enabled
    FROM product_features
    WHERE feature_id = ?
  `),

  /**
   * Set feature for product (insert or update)
   */
  set: db.prepare(`
    INSERT INTO product_features (product_id, feature_id, enabled)
    VALUES (?, ?, ?)
    ON CONFLICT(product_id, feature_id) DO UPDATE SET
      enabled = excluded.enabled,
      updated_at = CURRENT_TIMESTAMP
  `),

  /**
   * Remove feature from product
   */
  remove: db.prepare(`
    DELETE FROM product_features
    WHERE product_id = ? AND feature_id = ?
  `),

  /**
   * Get all product-feature mappings
   */
  getAll: db.prepare(`
    SELECT pf.*, f.name as feature_name
    FROM product_features pf
    JOIN features f ON pf.feature_id = f.id
    ORDER BY pf.product_id, f.display_order
  `),

  /**
   * Clear all features for a product
   */
  clearProduct: db.prepare(`
    DELETE FROM product_features WHERE product_id = ?
  `),
};

/**
 * Customer Queries
 */
export const customerQueries = {
  getAll: db.prepare(`
    SELECT * FROM customers ORDER BY created_at DESC
  `),

  getById: db.prepare(`
    SELECT * FROM customers WHERE id = ?
  `),

  getByCustomerId: db.prepare(`
    SELECT * FROM customers WHERE customer_id = ?
  `),

  getByEmail: db.prepare(`
    SELECT * FROM customers WHERE email = ?
  `),

  create: db.prepare(`
    INSERT INTO customers (
      customer_id, first_name, last_name, email, phone,
      street, postal_code, city, country, shopify_customer_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  update: db.prepare(`
    UPDATE customers
    SET first_name = ?, last_name = ?, email = ?, phone = ?,
        street = ?, postal_code = ?, city = ?, country = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),

  delete: db.prepare(`
    DELETE FROM customers WHERE id = ?
  `),

  incrementOrders: db.prepare(`
    UPDATE customers
    SET total_orders = total_orders + 1,
        total_revenue = total_revenue + ?,
        last_order_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),

  decrementOrders: db.prepare(`
    UPDATE customers
    SET total_orders = CASE WHEN total_orders > 0 THEN total_orders - 1 ELSE 0 END,
        total_revenue = CASE WHEN total_revenue > ? THEN total_revenue - ? ELSE 0 END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),
};

/**
 * Customer Tags Queries
 */
export const customerTagQueries = {
  getByCustomer: db.prepare(`
    SELECT * FROM customer_tags WHERE customer_id = ?
  `),

  add: db.prepare(`
    INSERT OR IGNORE INTO customer_tags (customer_id, tag) VALUES (?, ?)
  `),

  remove: db.prepare(`
    DELETE FROM customer_tags WHERE customer_id = ? AND tag = ?
  `),
};

/**
 * Customer Notes Queries
 */
export const customerNoteQueries = {
  getByCustomer: db.prepare(`
    SELECT * FROM customer_notes WHERE customer_id = ? ORDER BY created_at DESC
  `),

  add: db.prepare(`
    INSERT INTO customer_notes (customer_id, author, note) VALUES (?, ?, ?)
  `),

  delete: db.prepare(`
    DELETE FROM customer_notes WHERE id = ?
  `),
};

/**
 * Order Queries
 */
export const orderQueries = {
  getAll: db.prepare(`
    SELECT o.*, c.first_name, c.last_name, c.email
    FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    ORDER BY o.created_at DESC
  `),

  getById: db.prepare(`
    SELECT o.*, c.first_name, c.last_name, c.email
    FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    WHERE o.id = ?
  `),

  getByOrderId: db.prepare(`
    SELECT * FROM orders WHERE order_id = ?
  `),

  getByShopifyOrderId: db.prepare(`
    SELECT * FROM orders WHERE shopify_order_id = ?
  `),

  getByCustomer: db.prepare(`
    SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC
  `),

  create: db.prepare(`
    INSERT INTO orders (
      order_id, customer_id, shopify_order_id, shopify_order_number,
      status, financial_status, fulfillment_status,
      total_amount, currency, shopify_created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  updateStatus: db.prepare(`
    UPDATE orders
    SET status = ?, financial_status = ?, fulfillment_status = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),

  delete: db.prepare(`
    DELETE FROM orders WHERE id = ?
  `),
};

/**
 * Order Items Queries
 */
export const orderItemQueries = {
  getByOrder: db.prepare(`
    SELECT * FROM order_items WHERE order_id = ?
  `),

  create: db.prepare(`
    INSERT INTO order_items (
      order_id, variant_gid, product_title, variant_title,
      start_date, end_date, total_days,
      unit_price, quantity, total_price, booking_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
};

/**
 * Order Status History Queries
 */
export const orderStatusHistoryQueries = {
  getByOrder: db.prepare(`
    SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at ASC
  `),

  add: db.prepare(`
    INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note)
    VALUES (?, ?, ?, ?, ?)
  `),
};

/**
 * Inventory Schedule Queries
 */
export const inventoryScheduleQueries = {
  /**
   * Get all schedules for a variant
   */
  getByVariant: db.prepare(`
    SELECT * FROM inventory_schedule
    WHERE variant_gid = ?
    ORDER BY effective_date ASC
  `),

  /**
   * Get active schedule for a variant at a specific date
   * Returns the most recent schedule that's active on or before the given date
   */
  getActiveForDate: db.prepare(`
    SELECT * FROM inventory_schedule
    WHERE variant_gid = ? AND effective_date <= ?
    ORDER BY effective_date DESC
    LIMIT 1
  `),

  /**
   * Get all schedules
   */
  getAll: db.prepare(`
    SELECT s.*, v.product_title, v.variant_title
    FROM inventory_schedule s
    LEFT JOIN variant_inventory v ON s.variant_gid = v.variant_gid
    ORDER BY s.effective_date DESC
  `),

  /**
   * Add new schedule
   */
  add: db.prepare(`
    INSERT INTO inventory_schedule (
      variant_gid,
      effective_date,
      total_units,
      note,
      created_by
    )
    VALUES (?, ?, ?, ?, ?)
  `),

  /**
   * Update schedule
   */
  update: db.prepare(`
    UPDATE inventory_schedule
    SET total_units = ?,
        note = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),

  /**
   * Delete schedule
   */
  delete: db.prepare(`
    DELETE FROM inventory_schedule WHERE id = ?
  `),

  /**
   * Get schedule by ID
   */
  getById: db.prepare(`
    SELECT * FROM inventory_schedule WHERE id = ?
  `),
};

/**
 * Discount Code Queries
 */
export const discountCodeQueries = {
  /**
   * Get all discount codes
   */
  getAll: db.prepare(`
    SELECT * FROM discount_codes
    WHERE status != 'deleted'
    ORDER BY created_at DESC
  `),

  /**
   * Get discount code by ID
   */
  getById: db.prepare(`
    SELECT * FROM discount_codes WHERE id = ?
  `),

  /**
   * Get discount code by code string
   */
  getByCode: db.prepare(`
    SELECT * FROM discount_codes
    WHERE code = ? AND status = 'active'
  `),

  /**
   * Get discount code by Shopify ID
   */
  getByShopifyId: db.prepare(`
    SELECT * FROM discount_codes WHERE shopify_discount_id = ?
  `),

  /**
   * Get all codes with Shopify ID (for sync)
   */
  getAllWithShopifyId: db.prepare(`
    SELECT * FROM discount_codes
    WHERE shopify_discount_id IS NOT NULL
  `),

  /**
   * Create discount code
   */
  create: db.prepare(`
    INSERT INTO discount_codes (
      code, title, description, shopify_discount_id,
      discount_type, value, usage_limit, usage_limit_per_customer,
      minimum_purchase_amount, starts_at, ends_at,
      applies_to_all_products, status, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  /**
   * Update discount code
   */
  update: db.prepare(`
    UPDATE discount_codes
    SET title = ?, description = ?, value = ?,
        usage_limit = ?, usage_limit_per_customer = ?,
        minimum_purchase_amount = ?,
        starts_at = ?, ends_at = ?,
        status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),

  /**
   * Update Shopify ID after creation
   */
  updateShopifyId: db.prepare(`
    UPDATE discount_codes
    SET shopify_discount_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),

  /**
   * Update sync timestamp
   */
  updateSyncTime: db.prepare(`
    UPDATE discount_codes
    SET last_synced_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),

  /**
   * Soft delete (mark as deleted)
   */
  softDelete: db.prepare(`
    UPDATE discount_codes
    SET status = 'deleted', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),

  /**
   * Update status
   */
  updateStatus: db.prepare(`
    UPDATE discount_codes
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),

  /**
   * Get expired codes (for cron job)
   */
  getExpired: db.prepare(`
    SELECT * FROM discount_codes
    WHERE status = 'active'
      AND ends_at IS NOT NULL
      AND datetime(ends_at) < datetime('now')
  `),

  /**
   * Get statistics
   */
  getStats: db.prepare(`
    SELECT
      COUNT(*) as total_codes,
      COUNT(CASE WHEN status = 'active' THEN 1 END) as active_codes,
      COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired_codes,
      COUNT(CASE WHEN status = 'inactive' THEN 1 END) as inactive_codes
    FROM discount_codes
    WHERE status != 'deleted'
  `),
};

/**
 * Discount Code Products Queries
 */
export const discountCodeProductQueries = {
  /**
   * Get all variants for a discount code
   */
  getByDiscount: db.prepare(`
    SELECT variant_gid FROM discount_code_products
    WHERE discount_code_id = ?
  `),

  /**
   * Add variant to discount code
   */
  add: db.prepare(`
    INSERT INTO discount_code_products (discount_code_id, variant_gid)
    VALUES (?, ?)
    ON CONFLICT(discount_code_id, variant_gid) DO NOTHING
  `),

  /**
   * Remove all variants for a discount code
   */
  removeAll: db.prepare(`
    DELETE FROM discount_code_products WHERE discount_code_id = ?
  `),

  /**
   * Remove specific variant from discount code
   */
  remove: db.prepare(`
    DELETE FROM discount_code_products
    WHERE discount_code_id = ? AND variant_gid = ?
  `),
};

/**
 * Discount Code Usage Queries
 */
export const discountCodeUsageQueries = {
  /**
   * Get all usage for a discount code
   */
  getByDiscount: db.prepare(`
    SELECT * FROM discount_code_usage
    WHERE discount_code_id = ?
    ORDER BY redeemed_at DESC
  `),

  /**
   * Get paginated usage history
   */
  getByDiscountPaginated: db.prepare(`
    SELECT * FROM discount_code_usage
    WHERE discount_code_id = ?
    ORDER BY redeemed_at DESC
    LIMIT ? OFFSET ?
  `),

  /**
   * Record usage
   */
  add: db.prepare(`
    INSERT INTO discount_code_usage (
      discount_code_id, order_id, shopify_order_id,
      customer_id, customer_email, discount_amount, order_total
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `),

  /**
   * Count total uses for a discount
   */
  countByDiscount: db.prepare(`
    SELECT COUNT(*) as total FROM discount_code_usage
    WHERE discount_code_id = ?
  `),

  /**
   * Count uses by customer
   */
  countByCustomer: db.prepare(`
    SELECT COUNT(*) as total FROM discount_code_usage
    WHERE discount_code_id = ? AND customer_email = ?
  `),

  /**
   * Get analytics for a discount code
   */
  getAnalytics: db.prepare(`
    SELECT
      COUNT(*) as total_uses,
      COUNT(DISTINCT customer_email) as unique_customers,
      SUM(discount_amount) as total_discount_given,
      SUM(order_total) as total_revenue,
      AVG(order_total) as avg_order_value,
      MIN(redeemed_at) as first_use,
      MAX(redeemed_at) as last_use
    FROM discount_code_usage
    WHERE discount_code_id = ?
      AND redeemed_at >= ? AND redeemed_at <= ?
  `),

  /**
   * Get customer behavior (top customers)
   */
  getTopCustomers: db.prepare(`
    SELECT
      customer_email,
      COUNT(*) as usage_count,
      SUM(discount_amount) as total_discount,
      SUM(order_total) as total_spent
    FROM discount_code_usage
    WHERE discount_code_id = ?
    GROUP BY customer_email
    ORDER BY usage_count DESC, total_spent DESC
    LIMIT ?
  `),

  /**
   * Get usage over time (for charts)
   */
  getUsageOverTime: db.prepare(`
    SELECT
      DATE(redeemed_at) as date,
      COUNT(*) as count,
      SUM(discount_amount) as total_discount
    FROM discount_code_usage
    WHERE discount_code_id = ?
      AND redeemed_at >= ? AND redeemed_at <= ?
    GROUP BY DATE(redeemed_at)
    ORDER BY date ASC
  `),
};

/**
 * Discount Code Sync Log Queries
 */
export const discountCodeSyncLogQueries = {
  /**
   * Add sync log entry
   */
  add: db.prepare(`
    INSERT INTO discount_code_sync_log (
      discount_code_id, shopify_discount_id, action, details
    ) VALUES (?, ?, ?, ?)
  `),

  /**
   * Get recent sync logs
   */
  getRecent: db.prepare(`
    SELECT * FROM discount_code_sync_log
    ORDER BY synced_at DESC
    LIMIT ?
  `),

  /**
   * Get sync logs for a specific discount
   */
  getByDiscount: db.prepare(`
    SELECT * FROM discount_code_sync_log
    WHERE discount_code_id = ?
    ORDER BY synced_at DESC
    LIMIT ?
  `),
};

/**
 * Transaction helper
 */
export function transaction(fn) {
  return db.transaction(fn);
}

export default db;
