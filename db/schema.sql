-- Fotobox Rental System - Database Schema
-- SQLite Database

-- Variant Inventory Table
-- Stores the total number of physical units per variant
CREATE TABLE IF NOT EXISTS variant_inventory (
  variant_gid TEXT PRIMARY KEY,              -- Shopify ProductVariant GID
  variant_numeric_id TEXT NOT NULL,          -- Numeric ID for easier reference
  product_title TEXT NOT NULL,               -- Product name (e.g. "Basic Fotobox")
  variant_title TEXT NOT NULL,               -- Variant name (e.g. "Pink")
  total_units INTEGER NOT NULL DEFAULT 1,    -- Physical units available
  price TEXT,                                -- Price for display
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_variant_numeric_id ON variant_inventory(variant_numeric_id);

-- Inventory History Table (optional, for tracking changes)
CREATE TABLE IF NOT EXISTS inventory_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_gid TEXT NOT NULL,
  old_quantity INTEGER NOT NULL,
  new_quantity INTEGER NOT NULL,
  changed_by TEXT,                           -- User/Admin who made the change
  reason TEXT,                               -- Reason for change
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (variant_gid) REFERENCES variant_inventory(variant_gid)
);

-- Admin Users Table (for authentication)
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,              -- Bcrypt hash
  email TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP
);

-- Insert default admin user (password: "admin123" - CHANGE THIS!)
-- Password hash for "admin123"
INSERT OR IGNORE INTO admin_users (username, password_hash, email)
VALUES ('admin', '$2b$10$Jpwcwf1g1653aF1KyLVT1eMWIQIuOyuswf7muRE2OpONkG6jc/2C.', 'admin@fotobox.de');

-- Blocked Dates Table (for preventing bookings on specific date ranges)
CREATE TABLE IF NOT EXISTS blocked_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_date TEXT NOT NULL,                  -- ISO date string (YYYY-MM-DD)
  end_date TEXT NOT NULL,                    -- ISO date string (YYYY-MM-DD)
  reason TEXT,                               -- Reason for blocking (optional)
  created_by TEXT,                           -- Admin who created the block
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster date range queries
CREATE INDEX IF NOT EXISTS idx_blocked_dates_range ON blocked_dates(start_date, end_date);

-- Bookings Table
-- Stores all rental bookings locally instead of in Shopify metafields
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id TEXT UNIQUE NOT NULL,           -- UUID for external reference
  variant_gid TEXT NOT NULL,                 -- Shopify variant GID
  product_title TEXT NOT NULL,               -- Product name for display
  variant_title TEXT NOT NULL,               -- Variant/color name

  customer_email TEXT NOT NULL,              -- Customer email
  customer_name TEXT,                        -- Customer name (optional)

  event_date TEXT NOT NULL,                  -- Event date (YYYY-MM-DD) - legacy, use start_date
  start_date TEXT,                           -- Multi-day: Rental start date (YYYY-MM-DD)
  end_date TEXT,                             -- Multi-day: Rental end date (YYYY-MM-DD)
  total_days INTEGER DEFAULT 1,              -- Multi-day: Total rental days

  status TEXT NOT NULL DEFAULT 'pending',    -- pending, confirmed, cancelled, completed

  order_id TEXT,                             -- Shopify order ID (if confirmed)

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_bookings_variant ON bookings(variant_gid);
CREATE INDEX IF NOT EXISTS idx_bookings_event_date ON bookings(event_date);
CREATE INDEX IF NOT EXISTS idx_bookings_date_range ON bookings(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_email);
CREATE INDEX IF NOT EXISTS idx_bookings_booking_id ON bookings(booking_id);

-- Feature Management Tables
-- Allows centralized management of product features in Admin Panel

-- Features Table
-- Stores all available features that can be assigned to products
CREATE TABLE IF NOT EXISTS features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,                 -- Feature name (e.g. "Professionelle Kamera")
  display_order INTEGER DEFAULT 0,           -- Order for display in UI
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Product Features Table
-- Maps which features are enabled for which products
CREATE TABLE IF NOT EXISTS product_features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,                  -- Product ID (e.g. "basic-fotobox", "premium-fotobox")
  feature_id INTEGER NOT NULL,               -- Reference to features table
  enabled BOOLEAN DEFAULT 1,                 -- Whether this feature is enabled for this product
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE,
  UNIQUE(product_id, feature_id)            -- Prevent duplicate entries
);

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_product_features_product ON product_features(product_id);
CREATE INDEX IF NOT EXISTS idx_product_features_feature ON product_features(feature_id);
CREATE INDEX IF NOT EXISTS idx_features_display_order ON features(display_order);
