import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// PostgreSQL connection pool
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 50, // Increased from 20 for better concurrency
  min: 5, // Keep some connections warm
  idleTimeoutMillis: 60000, // Keep connections alive longer
  connectionTimeoutMillis: 5000, // Allow more time for connection
  allowExitOnIdle: false, // Don't close pool when no queries
});

console.log('[Database] Initializing PostgreSQL connection...');

// Test connection
pool.on('connect', () => {
  console.log('[Database] Connected to PostgreSQL');
});

pool.on('error', (err) => {
  console.error('[Database] Unexpected error on idle client', err);
});

// Initialize schema
async function initializeDatabase() {
  console.log('[Database] Initializing schema...');

  const client = await pool.connect();
  try {
    const schemaPath = path.join(__dirname, 'schema-postgres.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    await client.query(schema);
    console.log('[Database] Schema initialized successfully');
  } finally {
    client.release();
  }
}

// Run migrations
async function runMigrations() {
  try {
    const { runMigrations: runMig } = await import('./migrate-postgres.js');
    await runMig(pool);
  } catch (error) {
    console.error('[Database] Migration error:', error);
    throw error;
  }
}

// Initialize on startup
try {
  await initializeDatabase();
  await runMigrations();
} catch (error) {
  console.error('[Database] Failed to initialize:', error);
  throw error;
}

// Helper function to convert SQLite-style ? to PostgreSQL $1, $2, etc.
function query(text, params) {
  return pool.query(text, params);
}

// Get a single row
async function queryOne(text, params) {
  const result = await pool.query(text, params);
  return result.rows[0] || null;
}

// Get all rows
async function queryAll(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

// Execute (for INSERT/UPDATE/DELETE)
async function execute(text, params) {
  const result = await pool.query(text, params);
  return result;
}

/**
 * Variant Inventory Queries
 */
export const variantInventoryQueries = {
  async getByVariantGid(variantGid) {
    return queryOne('SELECT * FROM variant_inventory WHERE variant_gid = $1', [variantGid]);
  },

  async getByNumericId(numericId) {
    return queryOne('SELECT * FROM variant_inventory WHERE variant_numeric_id = $1', [numericId]);
  },

  async getAll() {
    return queryAll('SELECT * FROM variant_inventory ORDER BY product_title, variant_title');
  },

  async upsert(variantGid, variantNumericId, productTitle, variantTitle, totalUnits, price) {
    return execute(`
      INSERT INTO variant_inventory (
        variant_gid, variant_numeric_id, product_title, variant_title, total_units, price, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      ON CONFLICT(variant_gid) DO UPDATE SET
        total_units = EXCLUDED.total_units,
        product_title = EXCLUDED.product_title,
        variant_title = EXCLUDED.variant_title,
        price = EXCLUDED.price,
        updated_at = CURRENT_TIMESTAMP
    `, [variantGid, variantNumericId, productTitle, variantTitle, totalUnits, price]);
  },

  async updateQuantity(totalUnits, variantGid) {
    return execute(`
      UPDATE variant_inventory
      SET total_units = $1, updated_at = CURRENT_TIMESTAMP
      WHERE variant_gid = $2
    `, [totalUnits, variantGid]);
  },

  async updateMetadata(productTitle, variantTitle, price, variantGid) {
    return execute(`
      UPDATE variant_inventory
      SET product_title = $1, variant_title = $2, price = $3, updated_at = CURRENT_TIMESTAMP
      WHERE variant_gid = $4
    `, [productTitle, variantTitle, price, variantGid]);
  },

  async delete(variantGid) {
    return execute('DELETE FROM variant_inventory WHERE variant_gid = $1', [variantGid]);
  },
};

/**
 * Inventory History Queries
 */
export const inventoryHistoryQueries = {
  async add(variantGid, oldQuantity, newQuantity, changedBy, reason) {
    return execute(`
      INSERT INTO inventory_history (variant_gid, old_quantity, new_quantity, changed_by, reason)
      VALUES ($1, $2, $3, $4, $5)
    `, [variantGid, oldQuantity, newQuantity, changedBy, reason]);
  },

  async getByVariant(variantGid) {
    return queryAll(`
      SELECT * FROM inventory_history
      WHERE variant_gid = $1
      ORDER BY changed_at DESC
      LIMIT 50
    `, [variantGid]);
  },

  async getRecent() {
    return queryAll(`
      SELECT h.*, v.product_title, v.variant_title
      FROM inventory_history h
      LEFT JOIN variant_inventory v ON h.variant_gid = v.variant_gid
      ORDER BY h.changed_at DESC
      LIMIT 100
    `);
  },
};

/**
 * Admin User Queries
 */
export const adminUserQueries = {
  async findByUsername(username) {
    return queryOne('SELECT * FROM admin_users WHERE username = $1', [username]);
  },

  async updateLastLogin(id) {
    return execute('UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [id]);
  },
};

/**
 * Blocked Dates Queries
 */
export const blockedDatesQueries = {
  async getAll() {
    return queryAll('SELECT * FROM blocked_dates ORDER BY start_date ASC');
  },

  async getById(id) {
    return queryOne('SELECT * FROM blocked_dates WHERE id = $1', [id]);
  },

  async add(startDate, endDate, reason, createdBy) {
    return execute(`
      INSERT INTO blocked_dates (start_date, end_date, reason, created_by)
      VALUES ($1, $2, $3, $4)
    `, [startDate, endDate, reason, createdBy]);
  },

  async delete(id) {
    return execute('DELETE FROM blocked_dates WHERE id = $1', [id]);
  },

  async isDateBlocked(date) {
    return queryAll(`
      SELECT * FROM blocked_dates
      WHERE $1 BETWEEN start_date AND end_date
    `, [date]);
  },

  async isRangeBlocked(endDate1, startDate1, endDate2, startDate2, startDate3, endDate3) {
    return queryAll(`
      SELECT * FROM blocked_dates
      WHERE (start_date <= $1 AND end_date >= $2)
         OR (start_date <= $3 AND end_date >= $4)
         OR (start_date >= $5 AND end_date <= $6)
    `, [endDate1, startDate1, endDate2, startDate2, startDate3, endDate3]);
  },
};

/**
 * Bookings Queries
 */
export const bookingsQueries = {
  async getByVariant(variantGid) {
    return queryAll(`
      SELECT * FROM bookings
      WHERE variant_gid = $1 AND status != 'cancelled'
      ORDER BY event_date ASC
    `, [variantGid]);
  },

  async getByProduct(productTitle) {
    return queryAll(`
      SELECT * FROM bookings
      WHERE product_title LIKE $1 AND status != 'cancelled'
      ORDER BY event_date ASC
    `, [productTitle]);
  },

  async getById(bookingId) {
    return queryOne(`
      SELECT
        b.*,
        o.shipping_name, o.shipping_address1, o.shipping_address2,
        o.shipping_city, o.shipping_province, o.shipping_country,
        o.shipping_zip, o.shipping_phone,
        o.billing_name, o.billing_address1, o.billing_address2,
        o.billing_city, o.billing_province, o.billing_country,
        o.billing_zip, o.billing_phone
      FROM bookings b
      LEFT JOIN orders o ON b.order_id = o.shopify_order_id
      WHERE b.booking_id = $1
    `, [bookingId]);
  },

  async getAll() {
    return queryAll(`
      SELECT
        b.*,
        o.shipping_name, o.shipping_address1, o.shipping_address2,
        o.shipping_city, o.shipping_province, o.shipping_country,
        o.shipping_zip, o.shipping_phone,
        o.billing_name, o.billing_address1, o.billing_address2,
        o.billing_city, o.billing_province, o.billing_country,
        o.billing_zip, o.billing_phone
      FROM bookings b
      LEFT JOIN orders o ON b.order_id = o.shopify_order_id
      ORDER BY b.created_at DESC
      LIMIT 1000
    `);
  },

  async getConfirmed() {
    return queryAll(`
      SELECT * FROM bookings
      WHERE status = 'confirmed'
      ORDER BY event_date ASC, created_at DESC
    `);
  },

  async add(bookingId, variantGid, productTitle, variantTitle, customerEmail, customerName, eventDate, startDate, endDate, totalDays, status, orderId, eventCode = null, eventCodeExpiresAt = null) {
    return execute(`
      INSERT INTO bookings (
        booking_id, variant_gid, product_title, variant_title, customer_email, customer_name,
        event_date, start_date, end_date, total_days, status, order_id, event_code, event_code_expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, [bookingId, variantGid, productTitle, variantTitle, customerEmail, customerName, eventDate, startDate, endDate, totalDays, status, orderId, eventCode, eventCodeExpiresAt]);
  },

  async updateStatus(status, bookingId) {
    return execute(`
      UPDATE bookings
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE booking_id = $2
    `, [status, bookingId]);
  },

  async getByColor(color) {
    return queryAll(`
      SELECT b.* FROM bookings b
      JOIN variant_inventory v ON b.variant_gid = v.variant_gid
      WHERE v.color = $1 AND b.status != 'cancelled'
      ORDER BY b.event_date ASC
    `, [color]);
  },

  async delete(bookingId) {
    return execute('DELETE FROM bookings WHERE booking_id = $1', [bookingId]);
  },

  /**
   * Get booking by event code (with expiration check for public access)
   * Used by: Diashow, App
   * Returns null if code is expired or doesn't exist
   */
  async getByEventCode(eventCode) {
    return queryOne(`
      SELECT
        b.*,
        o.order_id,
        o.shipping_name, o.shipping_address1, o.shipping_address2,
        o.shipping_city, o.shipping_province, o.shipping_country,
        o.shipping_zip, o.shipping_phone
      FROM bookings b
      LEFT JOIN orders o ON b.order_id = o.shopify_order_id
      WHERE b.event_code = $1
        AND (b.event_code_expires_at IS NULL OR b.event_code_expires_at > NOW())
    `, [eventCode]);
  },

  /**
   * Get booking by event code (admin - no expiration check)
   * Used by: Admin panel, Code generator (collision check)
   * Returns booking even if code is expired
   */
  async getByEventCodeAdmin(eventCode) {
    return queryOne(`
      SELECT * FROM bookings WHERE event_code = $1
    `, [eventCode]);
  },

  async getByDateRange(startDate, endDate) {
    return queryAll(`
      SELECT * FROM bookings
      WHERE event_date >= $1 AND event_date <= $2 AND status != 'cancelled'
      ORDER BY event_date ASC
    `, [startDate, endDate]);
  },

  async getByTrackingNumber(trackingNumber) {
    return queryOne(`
      SELECT * FROM bookings
      WHERE tracking_number = $1
    `, [trackingNumber]);
  },

  async updateShippingStatus(bookingId, status, trackingNumber, labelUrl, shippedAt = null, deliveredAt = null) {
    const updates = [];
    const values = [];
    let paramIndex = 1;

    updates.push(`shipping_status = $${paramIndex++}`);
    values.push(status);

    if (trackingNumber) {
      updates.push(`tracking_number = $${paramIndex++}`);
      values.push(trackingNumber);
    }

    if (labelUrl) {
      updates.push(`shipping_label_url = $${paramIndex++}`);
      values.push(labelUrl);
    }

    if (shippedAt) {
      updates.push(`shipped_at = $${paramIndex++}`);
      values.push(shippedAt);
    }

    if (deliveredAt) {
      updates.push(`delivered_at = $${paramIndex++}`);
      values.push(deliveredAt);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    values.push(bookingId);

    return execute(`
      UPDATE bookings
      SET ${updates.join(', ')}
      WHERE booking_id = $${paramIndex}
    `, values);
  },
};

/**
 * Feature Management Queries
 */
export const featureQueries = {
  async getAllWithProducts() {
    return queryAll(`
      SELECT
        f.id,
        f.name,
        f.display_order,
        STRING_AGG(CASE WHEN pf.enabled = true THEN pf.product_id END, ',') as enabled_products
      FROM features f
      LEFT JOIN product_features pf ON f.id = pf.feature_id
      GROUP BY f.id
      ORDER BY f.display_order ASC, f.name ASC
    `);
  },

  async getAll() {
    return queryAll(`
      SELECT f.*, fg.name as group_name, fg.display_order as group_display_order
      FROM features f
      LEFT JOIN feature_groups fg ON f.group_id = fg.id
      ORDER BY fg.display_order ASC NULLS FIRST, f.display_order ASC, f.name ASC
    `);
  },

  async getById(id) {
    return queryOne('SELECT * FROM features WHERE id = $1', [id]);
  },

  async getByName(name) {
    return queryOne('SELECT * FROM features WHERE name = $1', [name]);
  },

  async add(name, displayOrder) {
    return queryOne('INSERT INTO features (name, display_order) VALUES ($1, $2) RETURNING id', [name, displayOrder]);
  },

  async updateName(name, id) {
    return execute('UPDATE features SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [name, id]);
  },

  async updateOrder(displayOrder, id) {
    return execute('UPDATE features SET display_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [displayOrder, id]);
  },

  async updateGroupId(groupId, id) {
    return execute('UPDATE features SET group_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [groupId, id]);
  },

  async delete(id) {
    return execute('DELETE FROM features WHERE id = $1', [id]);
  },
};

/**
 * Feature Groups Queries
 */
export const featureGroupQueries = {
  async getAll() {
    return queryAll('SELECT * FROM feature_groups ORDER BY display_order ASC, name ASC');
  },

  async getById(id) {
    return queryOne('SELECT * FROM feature_groups WHERE id = $1', [id]);
  },

  async create(name, displayOrder = 0) {
    return queryOne(
      'INSERT INTO feature_groups (name, display_order) VALUES ($1, $2) RETURNING id',
      [name, displayOrder]
    );
  },

  async updateName(name, id) {
    return execute(
      'UPDATE feature_groups SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [name, id]
    );
  },

  async updateOrder(displayOrder, id) {
    return execute(
      'UPDATE feature_groups SET display_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [displayOrder, id]
    );
  },

  async delete(id) {
    return execute('DELETE FROM feature_groups WHERE id = $1', [id]);
  },
};

/**
 * Product Features Queries
 */
export const productFeatureQueries = {
  async getByProduct(productId) {
    return queryAll(`
      SELECT f.id, f.name, f.display_order, f.group_id, pf.enabled, pf.custom_text
      FROM features f
      LEFT JOIN product_features pf ON f.id = pf.feature_id AND pf.product_id = $1
      ORDER BY f.display_order ASC, f.name ASC
    `, [productId]);
  },

  async getByFeature(featureId) {
    return queryAll('SELECT product_id, enabled FROM product_features WHERE feature_id = $1', [featureId]);
  },

  async set(productId, featureId, enabled, customText = null) {
    return execute(`
      INSERT INTO product_features (product_id, feature_id, enabled, custom_text)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT(product_id, feature_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        custom_text = EXCLUDED.custom_text,
        updated_at = CURRENT_TIMESTAMP
    `, [productId, featureId, enabled, customText]);
  },

  async remove(productId, featureId) {
    return execute('DELETE FROM product_features WHERE product_id = $1 AND feature_id = $2', [productId, featureId]);
  },

  async getAll() {
    return queryAll(`
      SELECT pf.*, f.name as feature_name
      FROM product_features pf
      JOIN features f ON pf.feature_id = f.id
      ORDER BY pf.product_id, f.display_order
    `);
  },

  async clearProduct(productId) {
    return execute('DELETE FROM product_features WHERE product_id = $1', [productId]);
  },
};

/**
 * Customer Queries
 */
export const customerQueries = {
  async getAll() {
    return queryAll('SELECT * FROM customers ORDER BY created_at DESC');
  },

  async getById(id) {
    return queryOne('SELECT * FROM customers WHERE id = $1', [id]);
  },

  async getByCustomerId(customerId) {
    return queryOne('SELECT * FROM customers WHERE customer_id = $1', [customerId]);
  },

  async getByEmail(email) {
    return queryOne('SELECT * FROM customers WHERE email = $1', [email]);
  },

  async create(customerId, firstName, lastName, email, phone, street, postalCode, city, country, shopifyCustomerId) {
    return execute(`
      INSERT INTO customers (
        customer_id, first_name, last_name, email, phone,
        street, postal_code, city, country, shopify_customer_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [customerId, firstName, lastName, email, phone, street, postalCode, city, country, shopifyCustomerId]);
  },

  async update(firstName, lastName, email, phone, street, postalCode, city, country, id) {
    return execute(`
      UPDATE customers
      SET first_name = $1, last_name = $2, email = $3, phone = $4,
          street = $5, postal_code = $6, city = $7, country = $8,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
    `, [firstName, lastName, email, phone, street, postalCode, city, country, id]);
  },

  async delete(id) {
    return execute('DELETE FROM customers WHERE id = $1', [id]);
  },

  async incrementOrders(revenue, id) {
    return execute(`
      UPDATE customers
      SET total_orders = total_orders + 1,
          total_revenue = total_revenue + $1,
          last_order_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [revenue, id]);
  },

  async decrementOrders(revenue1, revenue2, id) {
    return execute(`
      UPDATE customers
      SET total_orders = CASE WHEN total_orders > 0 THEN total_orders - 1 ELSE 0 END,
          total_revenue = CASE WHEN total_revenue > $1 THEN total_revenue - $2 ELSE 0 END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `, [revenue1, revenue2, id]);
  },
};

/**
 * Customer Tags Queries
 */
export const customerTagQueries = {
  async getByCustomer(customerId) {
    return queryAll('SELECT * FROM customer_tags WHERE customer_id = $1', [customerId]);
  },

  async add(customerId, tag) {
    return execute(`
      INSERT INTO customer_tags (customer_id, tag) VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `, [customerId, tag]);
  },

  async remove(customerId, tag) {
    return execute('DELETE FROM customer_tags WHERE customer_id = $1 AND tag = $2', [customerId, tag]);
  },
};

/**
 * Customer Notes Queries
 */
export const customerNoteQueries = {
  async getByCustomer(customerId) {
    return queryAll('SELECT * FROM customer_notes WHERE customer_id = $1 ORDER BY created_at DESC', [customerId]);
  },

  async add(customerId, author, note) {
    return execute('INSERT INTO customer_notes (customer_id, author, note) VALUES ($1, $2, $3)', [customerId, author, note]);
  },

  async delete(id) {
    return execute('DELETE FROM customer_notes WHERE id = $1', [id]);
  },
};

/**
 * Order Queries
 */
export const orderQueries = {
  async getAll() {
    return queryAll(`
      SELECT o.*, c.first_name, c.last_name, c.email
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      ORDER BY o.created_at DESC
    `);
  },

  async getById(id) {
    return queryOne(`
      SELECT o.*, c.first_name, c.last_name, c.email
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE o.id = $1
    `, [id]);
  },

  async getByOrderId(orderId) {
    return queryOne('SELECT * FROM orders WHERE order_id = $1', [orderId]);
  },

  async getByShopifyOrderId(shopifyOrderId) {
    return queryOne('SELECT * FROM orders WHERE shopify_order_id = $1', [shopifyOrderId]);
  },

  async getByCustomer(customerId) {
    return queryAll('SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC', [customerId]);
  },

  async create(orderId, customerId, shopifyOrderId, shopifyOrderNumber, status, financialStatus, fulfillmentStatus, totalAmount, currency, shopifyCreatedAt, shippingName, shippingAddress1, shippingAddress2, shippingCity, shippingProvince, shippingCountry, shippingZip, shippingPhone, billingName, billingAddress1, billingAddress2, billingCity, billingProvince, billingCountry, billingZip, billingPhone) {
    return queryOne(`
      INSERT INTO orders (
        order_id, customer_id, shopify_order_id, shopify_order_number,
        status, financial_status, fulfillment_status,
        total_amount, currency, shopify_created_at,
        shipping_name, shipping_address1, shipping_address2, shipping_city, shipping_province, shipping_country, shipping_zip, shipping_phone,
        billing_name, billing_address1, billing_address2, billing_city, billing_province, billing_country, billing_zip, billing_phone
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
      RETURNING id
    `, [orderId, customerId, shopifyOrderId, shopifyOrderNumber, status, financialStatus, fulfillmentStatus, totalAmount, currency, shopifyCreatedAt, shippingName, shippingAddress1, shippingAddress2, shippingCity, shippingProvince, shippingCountry, shippingZip, shippingPhone, billingName, billingAddress1, billingAddress2, billingCity, billingProvince, billingCountry, billingZip, billingPhone]);
  },

  async updateStatus(status, financialStatus, fulfillmentStatus, id) {
    return execute(`
      UPDATE orders
      SET status = $1, financial_status = $2, fulfillment_status = $3,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
    `, [status, financialStatus, fulfillmentStatus, id]);
  },

  async delete(id) {
    return execute('DELETE FROM orders WHERE id = $1', [id]);
  },
};

/**
 * Order Items Queries
 */
export const orderItemQueries = {
  async getByOrder(orderId) {
    return queryAll('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
  },

  async create(orderId, variantGid, productTitle, variantTitle, startDate, endDate, totalDays, unitPrice, quantity, totalPrice, bookingId) {
    return execute(`
      INSERT INTO order_items (
        order_id, variant_gid, product_title, variant_title,
        start_date, end_date, total_days,
        unit_price, quantity, total_price, booking_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [orderId, variantGid, productTitle, variantTitle, startDate, endDate, totalDays, unitPrice, quantity, totalPrice, bookingId]);
  },
};

/**
 * Order Status History Queries
 */
export const orderStatusHistoryQueries = {
  async getByOrder(orderId) {
    return queryAll('SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY created_at ASC', [orderId]);
  },

  async add(orderId, fromStatus, toStatus, changedBy, note) {
    return execute(`
      INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note)
      VALUES ($1, $2, $3, $4, $5)
    `, [orderId, fromStatus, toStatus, changedBy, note]);
  },
};

/**
 * Inventory Schedule Queries
 */
export const inventoryScheduleQueries = {
  async getByVariant(variantGid) {
    return queryAll(`
      SELECT * FROM inventory_schedule
      WHERE variant_gid = $1
      ORDER BY effective_date ASC
    `, [variantGid]);
  },

  async getActiveForDate(variantGid, date) {
    return queryOne(`
      SELECT * FROM inventory_schedule
      WHERE variant_gid = $1 AND effective_date <= $2
      ORDER BY effective_date DESC
      LIMIT 1
    `, [variantGid, date]);
  },

  async getAll() {
    return queryAll(`
      SELECT s.*, v.product_title, v.variant_title
      FROM inventory_schedule s
      LEFT JOIN variant_inventory v ON s.variant_gid = v.variant_gid
      ORDER BY s.effective_date DESC
    `);
  },

  async add(variantGid, effectiveDate, totalUnits, note, createdBy) {
    return execute(`
      INSERT INTO inventory_schedule (variant_gid, effective_date, total_units, note, created_by)
      VALUES ($1, $2, $3, $4, $5)
    `, [variantGid, effectiveDate, totalUnits, note, createdBy]);
  },

  async update(totalUnits, note, id) {
    return execute(`
      UPDATE inventory_schedule
      SET total_units = $1, note = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `, [totalUnits, note, id]);
  },

  async delete(id) {
    return execute('DELETE FROM inventory_schedule WHERE id = $1', [id]);
  },

  async getById(id) {
    return queryOne('SELECT * FROM inventory_schedule WHERE id = $1', [id]);
  },
};

/**
 * Color Pool Queries
 * Verwaltet physisches Fotobox-Inventar pro Farbe (unabhängig von Shopify-Varianten)
 */
export const colorPoolQueries = {
  async getAll() {
    return queryAll('SELECT * FROM color_pools ORDER BY color');
  },

  async getByColor(color) {
    return queryOne('SELECT * FROM color_pools WHERE color = $1', [color]);
  },

  async updateUnits(totalUnits, color) {
    return execute(`
      UPDATE color_pools
      SET total_units = $1, updated_at = CURRENT_TIMESTAMP
      WHERE color = $2
    `, [totalUnits, color]);
  },
};

/**
 * Color Schedule Queries
 * Zeitbasierte Vorplanung pro Farbe (z.B. "Ab Juni 7x Weiß")
 */
export const colorScheduleQueries = {
  async getByColor(color) {
    return queryAll(`
      SELECT * FROM color_schedule
      WHERE color = $1
      ORDER BY effective_date ASC
    `, [color]);
  },

  async getActiveForDate(color, date) {
    return queryOne(`
      SELECT * FROM color_schedule
      WHERE color = $1 AND effective_date <= $2
      ORDER BY effective_date DESC
      LIMIT 1
    `, [color, date]);
  },

  async getAll() {
    return queryAll(`
      SELECT s.*, p.display_name
      FROM color_schedule s
      JOIN color_pools p ON s.color = p.color
      ORDER BY s.effective_date DESC
    `);
  },

  async add(color, effectiveDate, totalUnits, note, createdBy) {
    return execute(`
      INSERT INTO color_schedule (color, effective_date, total_units, note, created_by)
      VALUES ($1, $2, $3, $4, $5)
    `, [color, effectiveDate, totalUnits, note, createdBy]);
  },

  async update(totalUnits, note, id) {
    return execute(`
      UPDATE color_schedule
      SET total_units = $1, note = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `, [totalUnits, note, id]);
  },

  async delete(id) {
    return execute('DELETE FROM color_schedule WHERE id = $1', [id]);
  },

  async getById(id) {
    return queryOne('SELECT * FROM color_schedule WHERE id = $1', [id]);
  },
};

/**
 * Color Inventory History Queries
 * Audit-Trail für manuelle Inventar-Änderungen pro Farbe
 */
export const colorInventoryHistoryQueries = {
  async add(color, oldQuantity, newQuantity, changedBy, reason) {
    return execute(`
      INSERT INTO color_inventory_history (color, old_quantity, new_quantity, changed_by, reason)
      VALUES ($1, $2, $3, $4, $5)
    `, [color, oldQuantity, newQuantity, changedBy, reason]);
  },

  async getByColor(color) {
    return queryAll(`
      SELECT * FROM color_inventory_history
      WHERE color = $1
      ORDER BY changed_at DESC
      LIMIT 50
    `, [color]);
  },
};

/**
 * Discount Code Queries
 */
export const discountCodeQueries = {
  async getAll() {
    return queryAll(`
      SELECT * FROM discount_codes
      WHERE status != 'deleted'
      ORDER BY created_at DESC
    `);
  },

  async getById(id) {
    return queryOne('SELECT * FROM discount_codes WHERE id = $1', [id]);
  },

  async getByCode(code) {
    return queryOne(`
      SELECT * FROM discount_codes
      WHERE code = $1 AND status = 'active'
    `, [code]);
  },

  async getByShopifyId(shopifyId) {
    return queryOne('SELECT * FROM discount_codes WHERE shopify_discount_id = $1', [shopifyId]);
  },

  async getAllWithShopifyId() {
    return queryAll(`
      SELECT * FROM discount_codes
      WHERE shopify_discount_id IS NOT NULL
    `);
  },

  async create(code, title, description, shopifyDiscountId, discountType, value, usageLimit, usageLimitPerCustomer, minimumPurchaseAmount, startsAt, endsAt, appliesToAllProducts, status, createdBy) {
    return queryOne(`
      INSERT INTO discount_codes (
        code, title, description, shopify_discount_id,
        discount_type, value, usage_limit, usage_limit_per_customer,
        minimum_purchase_amount, starts_at, ends_at,
        applies_to_all_products, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `, [code, title, description, shopifyDiscountId, discountType, value, usageLimit, usageLimitPerCustomer, minimumPurchaseAmount, startsAt, endsAt, appliesToAllProducts, status, createdBy]);
  },

  async update(title, description, value, usageLimit, usageLimitPerCustomer, minimumPurchaseAmount, startsAt, endsAt, status, id) {
    return execute(`
      UPDATE discount_codes
      SET title = $1, description = $2, value = $3,
          usage_limit = $4, usage_limit_per_customer = $5,
          minimum_purchase_amount = $6,
          starts_at = $7, ends_at = $8,
          status = $9, updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
    `, [title, description, value, usageLimit, usageLimitPerCustomer, minimumPurchaseAmount, startsAt, endsAt, status, id]);
  },

  async updateShopifyId(shopifyDiscountId, id) {
    return execute(`
      UPDATE discount_codes
      SET shopify_discount_id = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [shopifyDiscountId, id]);
  },

  async updateSyncTime(id) {
    return execute('UPDATE discount_codes SET last_synced_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
  },

  async softDelete(id) {
    return execute(`
      UPDATE discount_codes
      SET status = 'deleted', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [id]);
  },

  async hardDelete(id) {
    return execute('DELETE FROM discount_codes WHERE id = $1', [id]);
  },

  async updateStatus(status, id) {
    return execute(`
      UPDATE discount_codes
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [status, id]);
  },

  async getExpired() {
    return queryAll(`
      SELECT * FROM discount_codes
      WHERE status = 'active'
        AND ends_at IS NOT NULL
        AND ends_at < CURRENT_TIMESTAMP
    `);
  },

  async getStats() {
    return queryOne(`
      SELECT
        COUNT(*) as total_codes,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_codes,
        COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired_codes,
        COUNT(CASE WHEN status = 'inactive' THEN 1 END) as inactive_codes
      FROM discount_codes
      WHERE status != 'deleted'
    `);
  },
};

/**
 * Discount Code Products Queries
 */
export const discountCodeProductQueries = {
  async getByDiscount(discountCodeId) {
    return queryAll('SELECT variant_gid FROM discount_code_products WHERE discount_code_id = $1', [discountCodeId]);
  },

  async add(discountCodeId, variantGid) {
    return execute(`
      INSERT INTO discount_code_products (discount_code_id, variant_gid)
      VALUES ($1, $2)
      ON CONFLICT(discount_code_id, variant_gid) DO NOTHING
    `, [discountCodeId, variantGid]);
  },

  async removeAll(discountCodeId) {
    return execute('DELETE FROM discount_code_products WHERE discount_code_id = $1', [discountCodeId]);
  },

  async remove(discountCodeId, variantGid) {
    return execute(`
      DELETE FROM discount_code_products
      WHERE discount_code_id = $1 AND variant_gid = $2
    `, [discountCodeId, variantGid]);
  },
};

/**
 * Discount Code Usage Queries
 */
export const discountCodeUsageQueries = {
  async getByDiscount(discountCodeId) {
    return queryAll(`
      SELECT * FROM discount_code_usage
      WHERE discount_code_id = $1
      ORDER BY redeemed_at DESC
    `, [discountCodeId]);
  },

  async getByDiscountPaginated(discountCodeId, limit, offset) {
    return queryAll(`
      SELECT * FROM discount_code_usage
      WHERE discount_code_id = $1
      ORDER BY redeemed_at DESC
      LIMIT $2 OFFSET $3
    `, [discountCodeId, limit, offset]);
  },

  async add(discountCodeId, orderId, shopifyOrderId, customerId, customerEmail, discountAmount, orderTotal) {
    return execute(`
      INSERT INTO discount_code_usage (
        discount_code_id, order_id, shopify_order_id,
        customer_id, customer_email, discount_amount, order_total
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [discountCodeId, orderId, shopifyOrderId, customerId, customerEmail, discountAmount, orderTotal]);
  },

  async countByDiscount(discountCodeId) {
    return queryOne('SELECT COUNT(*) as total FROM discount_code_usage WHERE discount_code_id = $1', [discountCodeId]);
  },

  async countByCustomer(discountCodeId, customerEmail) {
    return queryOne(`
      SELECT COUNT(*) as total FROM discount_code_usage
      WHERE discount_code_id = $1 AND customer_email = $2
    `, [discountCodeId, customerEmail]);
  },

  async getAnalytics(discountCodeId, startDate, endDate) {
    return queryOne(`
      SELECT
        COUNT(*) as total_uses,
        COUNT(DISTINCT customer_email) as unique_customers,
        SUM(discount_amount) as total_discount_given,
        SUM(order_total) as total_revenue,
        AVG(order_total) as avg_order_value,
        MIN(redeemed_at) as first_use,
        MAX(redeemed_at) as last_use
      FROM discount_code_usage
      WHERE discount_code_id = $1
        AND redeemed_at >= $2 AND redeemed_at <= $3
    `, [discountCodeId, startDate, endDate]);
  },

  async getTopCustomers(discountCodeId, limit) {
    return queryAll(`
      SELECT
        customer_email,
        COUNT(*) as usage_count,
        SUM(discount_amount) as total_discount,
        SUM(order_total) as total_spent
      FROM discount_code_usage
      WHERE discount_code_id = $1
      GROUP BY customer_email
      ORDER BY usage_count DESC, total_spent DESC
      LIMIT $2
    `, [discountCodeId, limit]);
  },

  async getUsageOverTime(discountCodeId, startDate, endDate) {
    return queryAll(`
      SELECT
        DATE(redeemed_at) as date,
        COUNT(*) as count,
        SUM(discount_amount) as total_discount
      FROM discount_code_usage
      WHERE discount_code_id = $1
        AND redeemed_at >= $2 AND redeemed_at <= $3
      GROUP BY DATE(redeemed_at)
      ORDER BY date ASC
    `, [discountCodeId, startDate, endDate]);
  },
};

/**
 * Discount Code Sync Log Queries
 */
export const discountCodeSyncLogQueries = {
  async add(discountCodeId, shopifyDiscountId, action, details) {
    return execute(`
      INSERT INTO discount_code_sync_log (discount_code_id, shopify_discount_id, action, details)
      VALUES ($1, $2, $3, $4)
    `, [discountCodeId, shopifyDiscountId, action, details]);
  },

  async getRecent(limit) {
    return queryAll('SELECT * FROM discount_code_sync_log ORDER BY synced_at DESC LIMIT $1', [limit]);
  },

  async getByDiscount(discountCodeId, limit) {
    return queryAll(`
      SELECT * FROM discount_code_sync_log
      WHERE discount_code_id = $1
      ORDER BY synced_at DESC
      LIMIT $2
    `, [discountCodeId, limit]);
  },
};

/**
 * Transaction helper.
 * Passes the client to the callback so queries run within the transaction.
 *
 * @param {(client: pg.PoolClient) => Promise<T>} fn - Callback receiving the transaction client
 * @returns {Promise<T>} Result of the callback
 */
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Transaction] Error - rolling back:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Close pool (for graceful shutdown)
 */
export async function closePool() {
  await pool.end();
}

export { pool, query, queryOne, queryAll, execute };
export default pool;
