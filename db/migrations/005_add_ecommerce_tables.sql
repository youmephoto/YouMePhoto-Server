-- Migration 005: E-Commerce Tables (Customers & Orders)
-- Adds customer management and order tracking with Shopify sync

-- ==========================================
-- CUSTOMERS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  customer_id VARCHAR(255) UNIQUE NOT NULL,  -- UUID for external reference

  -- Basic Info
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(50),

  -- Address (optional)
  street VARCHAR(255),
  postal_code VARCHAR(50),
  city VARCHAR(255),
  country VARCHAR(2) DEFAULT 'DE',

  -- Shopify Integration
  shopify_customer_id VARCHAR(255) UNIQUE,   -- Shopify Customer GID (optional)

  -- Metadata
  total_orders INTEGER DEFAULT 0,            -- Cached count
  total_revenue NUMERIC(10, 2) DEFAULT 0.0,  -- Cached sum (in EUR)

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_order_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_customer_id ON customers(customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_shopify_id ON customers(shopify_customer_id);

-- ==========================================
-- CUSTOMER TAGS
-- ==========================================
CREATE TABLE IF NOT EXISTS customer_tags (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  tag VARCHAR(255) NOT NULL,                 -- e.g. "VIP", "Stammkunde", "Event-Planer"
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  UNIQUE(customer_id, tag)                   -- No duplicates
);

CREATE INDEX IF NOT EXISTS idx_customer_tags_customer ON customer_tags(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_tags_tag ON customer_tags(tag);

-- ==========================================
-- CUSTOMER NOTES
-- ==========================================
CREATE TABLE IF NOT EXISTS customer_notes (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  author VARCHAR(255) NOT NULL,              -- Admin username
  note TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_notes_customer ON customer_notes(customer_id);

-- ==========================================
-- ORDERS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_id VARCHAR(255) UNIQUE NOT NULL,     -- e.g. "#1234" from Shopify

  -- Customer Link
  customer_id INTEGER NOT NULL,

  -- Shopify Integration
  shopify_order_id VARCHAR(255) UNIQUE,      -- Shopify Order GID
  shopify_order_number VARCHAR(255),         -- Shopify order number (for display)

  -- Status (managed by Shopify)
  status VARCHAR(50) NOT NULL DEFAULT 'pending',  -- pending, confirmed, fulfilled, cancelled
  financial_status VARCHAR(50),              -- paid, pending, refunded (from Shopify)
  fulfillment_status VARCHAR(50),            -- fulfilled, unfulfilled, partial (from Shopify)

  -- Financial (display only, not managed here)
  total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.0,
  currency VARCHAR(3) DEFAULT 'EUR',

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  shopify_created_at TIMESTAMP,              -- Original Shopify timestamp

  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_financial_status ON orders(financial_status);
CREATE INDEX IF NOT EXISTS idx_orders_shopify_order_id ON orders(shopify_order_id);

-- ==========================================
-- ORDER ITEMS
-- ==========================================
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL,

  -- Product Info
  variant_gid VARCHAR(255) NOT NULL,         -- Link to variant_inventory
  product_title TEXT NOT NULL,
  variant_title TEXT NOT NULL,

  -- Rental Details
  start_date VARCHAR(255) NOT NULL,          -- YYYY-MM-DD
  end_date VARCHAR(255) NOT NULL,            -- YYYY-MM-DD
  total_days INTEGER DEFAULT 1,

  -- Pricing
  unit_price NUMERIC(10, 2) NOT NULL,
  quantity INTEGER DEFAULT 1,
  total_price NUMERIC(10, 2) NOT NULL,       -- unit_price * quantity * total_days

  -- Link to Booking
  booking_id INTEGER,                        -- Optional: Link to bookings table

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (variant_gid) REFERENCES variant_inventory(variant_gid),
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_variant ON order_items(variant_gid);
CREATE INDEX IF NOT EXISTS idx_order_items_booking ON order_items(booking_id);

-- ==========================================
-- ORDER STATUS HISTORY
-- ==========================================
CREATE TABLE IF NOT EXISTS order_status_history (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL,

  from_status VARCHAR(50),                   -- Previous status (NULL on creation)
  to_status VARCHAR(50) NOT NULL,            -- New status

  changed_by VARCHAR(255) NOT NULL,          -- Admin username or "system"
  note TEXT,                                 -- Optional: Reason for status change

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(order_id);

-- ==========================================
-- EXTEND BOOKINGS TABLE
-- ==========================================
-- Add customer_id and order_id foreign keys to existing bookings table

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bookings' AND column_name='customer_id') THEN
    ALTER TABLE bookings ADD COLUMN customer_id INTEGER;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bookings' AND column_name='order_id_fk') THEN
    ALTER TABLE bookings ADD COLUMN order_id_fk INTEGER;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_order ON bookings(order_id_fk);
