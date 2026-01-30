-- Migration 009: Discount Code Management with Shopify Sync
-- Adds discount code tracking, bidirectional sync, and analytics

-- ==========================================
-- DISCOUNT CODES TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS discount_codes (
  id SERIAL PRIMARY KEY,

  -- Basic Info
  code VARCHAR(255) UNIQUE NOT NULL,            -- Discount code (e.g., "SUMMER20")
  title VARCHAR(255) NOT NULL,                  -- Admin-friendly title
  description TEXT,                             -- Optional description

  -- Shopify Integration
  shopify_discount_id VARCHAR(255) UNIQUE,      -- Shopify Discount GID (e.g., "gid://shopify/DiscountCodeNode/123")
  shopify_price_rule_id VARCHAR(255),           -- Legacy field (may not be used)

  -- Discount Type & Value
  discount_type VARCHAR(50) NOT NULL,           -- 'percentage', 'fixed_amount', 'free_shipping'
  value NUMERIC(10, 2) NOT NULL,                -- Percentage (10.0 = 10%) or Amount (20.00 = €20)

  -- Restrictions
  usage_limit INTEGER,                          -- NULL = unlimited, or max total redemptions
  usage_limit_per_customer INTEGER DEFAULT 1,   -- How many times one customer can use
  minimum_purchase_amount NUMERIC(10, 2),       -- Minimum cart value (optional)

  -- Date Restrictions
  starts_at TIMESTAMP NOT NULL,                 -- When discount becomes active
  ends_at TIMESTAMP,                            -- NULL = no expiry, or end date

  -- Product-Specific Restrictions
  applies_to_all_products BOOLEAN DEFAULT true, -- true = all products, false = specific variants

  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'inactive', 'expired', 'deleted'

  -- Metadata
  created_by VARCHAR(255) NOT NULL,             -- Admin username who created this
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_synced_at TIMESTAMP                      -- Last Shopify sync timestamp
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_discount_codes_code ON discount_codes(code);
CREATE INDEX IF NOT EXISTS idx_discount_codes_status ON discount_codes(status);
CREATE INDEX IF NOT EXISTS idx_discount_codes_shopify_id ON discount_codes(shopify_discount_id);
CREATE INDEX IF NOT EXISTS idx_discount_codes_dates ON discount_codes(starts_at, ends_at);

-- ==========================================
-- DISCOUNT CODE PRODUCTS
-- Product-specific restrictions (many-to-many)
-- ==========================================
CREATE TABLE IF NOT EXISTS discount_code_products (
  id SERIAL PRIMARY KEY,
  discount_code_id INTEGER NOT NULL,
  variant_gid VARCHAR(255) NOT NULL,            -- Link to variant_inventory (Shopify variant GID)

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (discount_code_id) REFERENCES discount_codes(id) ON DELETE CASCADE,
  UNIQUE(discount_code_id, variant_gid)
);

CREATE INDEX IF NOT EXISTS idx_discount_products_code ON discount_code_products(discount_code_id);
CREATE INDEX IF NOT EXISTS idx_discount_products_variant ON discount_code_products(variant_gid);

-- ==========================================
-- DISCOUNT CODE USAGE TRACKING
-- Tracks each redemption locally for analytics
-- ==========================================
CREATE TABLE IF NOT EXISTS discount_code_usage (
  id SERIAL PRIMARY KEY,
  discount_code_id INTEGER NOT NULL,

  -- Order/Customer Info
  order_id INTEGER,                             -- Link to orders table (if available)
  shopify_order_id VARCHAR(255),                -- Shopify Order GID
  customer_id INTEGER,                          -- Link to customers table
  customer_email VARCHAR(255),                  -- For analytics even if customer not in DB

  -- Usage Details
  discount_amount NUMERIC(10, 2) NOT NULL,      -- Actual discount applied (€)
  order_total NUMERIC(10, 2),                   -- Total order value

  -- Timestamps
  redeemed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (discount_code_id) REFERENCES discount_codes(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_discount_usage_code ON discount_code_usage(discount_code_id);
CREATE INDEX IF NOT EXISTS idx_discount_usage_customer ON discount_code_usage(customer_id);
CREATE INDEX IF NOT EXISTS idx_discount_usage_order ON discount_code_usage(order_id);
CREATE INDEX IF NOT EXISTS idx_discount_usage_redeemed ON discount_code_usage(redeemed_at);

-- ==========================================
-- DISCOUNT CODE SYNC LOG (Optional - for debugging)
-- Tracks synchronization actions between Shopify and local DB
-- ==========================================
CREATE TABLE IF NOT EXISTS discount_code_sync_log (
  id SERIAL PRIMARY KEY,
  discount_code_id INTEGER,
  shopify_discount_id VARCHAR(255),
  action VARCHAR(50) NOT NULL,                  -- 'imported', 'updated', 'deleted', 'conflict'
  details TEXT,                                 -- JSON with changes
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (discount_code_id) REFERENCES discount_codes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_discount_sync_log_code ON discount_code_sync_log(discount_code_id);
CREATE INDEX IF NOT EXISTS idx_discount_sync_log_shopify ON discount_code_sync_log(shopify_discount_id);
CREATE INDEX IF NOT EXISTS idx_discount_sync_log_synced ON discount_code_sync_log(synced_at);
