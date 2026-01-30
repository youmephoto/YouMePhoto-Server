-- Fotobox Rental System - PostgreSQL Database Schema
-- Migrated from SQLite

-- Variant Inventory Table
CREATE TABLE IF NOT EXISTS variant_inventory (
  variant_gid TEXT PRIMARY KEY,
  variant_numeric_id TEXT NOT NULL,
  product_title TEXT NOT NULL,
  variant_title TEXT NOT NULL,
  total_units INTEGER NOT NULL DEFAULT 1,
  price TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_variant_numeric_id ON variant_inventory(variant_numeric_id);

-- Inventory History Table
CREATE TABLE IF NOT EXISTS inventory_history (
  id SERIAL PRIMARY KEY,
  variant_gid TEXT NOT NULL REFERENCES variant_inventory(variant_gid),
  old_quantity INTEGER NOT NULL,
  new_quantity INTEGER NOT NULL,
  changed_by TEXT,
  reason TEXT,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Admin Users Table
CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP
);

-- Insert default admin user (password: "admin123" - CHANGE THIS!)
INSERT INTO admin_users (username, password_hash, email)
VALUES ('admin', '$2b$10$Jpwcwf1g1653aF1KyLVT1eMWIQIuOyuswf7muRE2OpONkG6jc/2C.', 'admin@fotobox.de')
ON CONFLICT (username) DO NOTHING;

-- Blocked Dates Table
CREATE TABLE IF NOT EXISTS blocked_dates (
  id SERIAL PRIMARY KEY,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_blocked_dates_range ON blocked_dates(start_date, end_date);

-- Bookings Table
CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  booking_id TEXT UNIQUE NOT NULL,
  variant_gid TEXT NOT NULL,
  product_title TEXT NOT NULL,
  variant_title TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_name TEXT,
  event_date TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  total_days INTEGER DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  order_id TEXT,
  -- Shipping fields
  shipping_status TEXT DEFAULT 'not_shipped',
  tracking_number TEXT,
  shipping_carrier TEXT DEFAULT 'DHL',
  shipped_at TIMESTAMP,
  delivered_at TIMESTAMP,
  returned_at TIMESTAMP,
  shipping_label_url TEXT,
  setup_instructions_url TEXT DEFAULT '/docs/setup-guide.pdf',
  notes TEXT,
  -- E-commerce links
  customer_id INTEGER,
  order_id_fk INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bookings_variant ON bookings(variant_gid);
CREATE INDEX IF NOT EXISTS idx_bookings_event_date ON bookings(event_date);
CREATE INDEX IF NOT EXISTS idx_bookings_date_range ON bookings(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_email);
CREATE INDEX IF NOT EXISTS idx_bookings_booking_id ON bookings(booking_id);
CREATE INDEX IF NOT EXISTS idx_bookings_shipping_status ON bookings(shipping_status);
CREATE INDEX IF NOT EXISTS idx_bookings_shipped_at ON bookings(shipped_at);
CREATE INDEX IF NOT EXISTS idx_bookings_tracking_number ON bookings(tracking_number);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_order ON bookings(order_id_fk);

-- Features Table
CREATE TABLE IF NOT EXISTS features (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_features_display_order ON features(display_order);

-- Product Features Table
CREATE TABLE IF NOT EXISTS product_features (
  id SERIAL PRIMARY KEY,
  product_id TEXT NOT NULL,
  feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, feature_id)
);

CREATE INDEX IF NOT EXISTS idx_product_features_product ON product_features(product_id);
CREATE INDEX IF NOT EXISTS idx_product_features_feature ON product_features(feature_id);

-- Customers Table
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  customer_id TEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  street TEXT,
  postal_code TEXT,
  city TEXT,
  country TEXT DEFAULT 'DE',
  shopify_customer_id TEXT UNIQUE,
  total_orders INTEGER DEFAULT 0,
  total_revenue REAL DEFAULT 0.0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_order_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_customer_id ON customers(customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_shopify_id ON customers(shopify_customer_id);

-- Customer Tags Table
CREATE TABLE IF NOT EXISTS customer_tags (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(customer_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_customer_tags_customer ON customer_tags(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_tags_tag ON customer_tags(tag);

-- Customer Notes Table
CREATE TABLE IF NOT EXISTS customer_notes (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customer_notes_customer ON customer_notes(customer_id);

-- Orders Table
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_id TEXT UNIQUE NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  shopify_order_id TEXT UNIQUE,
  shopify_order_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  financial_status TEXT,
  fulfillment_status TEXT,
  total_amount REAL NOT NULL DEFAULT 0.0,
  currency TEXT DEFAULT 'EUR',
  -- Shipping Address
  shipping_name TEXT,
  shipping_address1 TEXT,
  shipping_address2 TEXT,
  shipping_city TEXT,
  shipping_province TEXT,
  shipping_country TEXT,
  shipping_zip TEXT,
  shipping_phone TEXT,
  -- Billing Address
  billing_name TEXT,
  billing_address1 TEXT,
  billing_address2 TEXT,
  billing_city TEXT,
  billing_province TEXT,
  billing_country TEXT,
  billing_zip TEXT,
  billing_phone TEXT,
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  shopify_created_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_financial_status ON orders(financial_status);
CREATE INDEX IF NOT EXISTS idx_orders_shopify_order_id ON orders(shopify_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_shipping_zip ON orders(shipping_zip);
CREATE INDEX IF NOT EXISTS idx_orders_shipping_city ON orders(shipping_city);
CREATE INDEX IF NOT EXISTS idx_orders_billing_zip ON orders(billing_zip);
CREATE INDEX IF NOT EXISTS idx_orders_billing_city ON orders(billing_city);

-- Order Items Table
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_gid TEXT NOT NULL,
  product_title TEXT NOT NULL,
  variant_title TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  total_days INTEGER DEFAULT 1,
  unit_price REAL NOT NULL,
  quantity INTEGER DEFAULT 1,
  total_price REAL NOT NULL,
  booking_id INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_variant ON order_items(variant_gid);
CREATE INDEX IF NOT EXISTS idx_order_items_booking ON order_items(booking_id);

-- Order Status History Table
CREATE TABLE IF NOT EXISTS order_status_history (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(order_id);

-- Inventory Schedule Table
CREATE TABLE IF NOT EXISTS inventory_schedule (
  id SERIAL PRIMARY KEY,
  variant_gid TEXT NOT NULL REFERENCES variant_inventory(variant_gid),
  effective_date TEXT NOT NULL,
  total_units INTEGER NOT NULL,
  note TEXT,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inventory_schedule_variant ON inventory_schedule(variant_gid);
CREATE INDEX IF NOT EXISTS idx_inventory_schedule_date ON inventory_schedule(effective_date);
CREATE INDEX IF NOT EXISTS idx_inventory_schedule_variant_date ON inventory_schedule(variant_gid, effective_date);

-- Shipping History Table
CREATE TABLE IF NOT EXISTS shipping_history (
  id SERIAL PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  tracking_number TEXT NOT NULL,
  status TEXT NOT NULL,
  status_description TEXT,
  location TEXT,
  timestamp TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shipping_history_booking ON shipping_history(booking_id);
CREATE INDEX IF NOT EXISTS idx_shipping_history_tracking ON shipping_history(tracking_number);
CREATE INDEX IF NOT EXISTS idx_shipping_history_status ON shipping_history(status);
CREATE INDEX IF NOT EXISTS idx_shipping_history_timestamp ON shipping_history(timestamp);

-- Photo Strips Table
CREATE TABLE IF NOT EXISTS photo_strips (
  id SERIAL PRIMARY KEY,
  strip_id TEXT UNIQUE NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  customer_email TEXT NOT NULL,
  design_data TEXT NOT NULL DEFAULT '{}',
  template_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER DEFAULT 1,
  preview_image_path TEXT,
  final_image_path TEXT,
  access_token TEXT NOT NULL,
  access_expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finalized_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_photo_strips_booking ON photo_strips(booking_id);
CREATE INDEX IF NOT EXISTS idx_photo_strips_access_token ON photo_strips(access_token);
CREATE INDEX IF NOT EXISTS idx_photo_strips_strip_id ON photo_strips(strip_id);
CREATE INDEX IF NOT EXISTS idx_photo_strips_customer_email ON photo_strips(customer_email);
CREATE INDEX IF NOT EXISTS idx_photo_strips_status ON photo_strips(status);

-- Design Templates Table
CREATE TABLE IF NOT EXISTS design_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  template_data TEXT NOT NULL,
  thumbnail_path TEXT,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_templates_category ON design_templates(category);
CREATE INDEX IF NOT EXISTS idx_templates_active ON design_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_templates_display_order ON design_templates(display_order);

-- Uploaded Images Table
CREATE TABLE IF NOT EXISTS uploaded_images (
  id SERIAL PRIMARY KEY,
  image_id TEXT UNIQUE NOT NULL,
  photo_strip_id INTEGER NOT NULL REFERENCES photo_strips(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  optimized_path TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_uploaded_images_strip ON uploaded_images(photo_strip_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_images_image_id ON uploaded_images(image_id);

-- Photo Strip Versions Table
CREATE TABLE IF NOT EXISTS photo_strip_versions (
  id SERIAL PRIMARY KEY,
  photo_strip_id INTEGER NOT NULL REFERENCES photo_strips(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  design_data TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(photo_strip_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_photo_strip_versions ON photo_strip_versions(photo_strip_id);

-- Discount Codes Table
CREATE TABLE IF NOT EXISTS discount_codes (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  shopify_discount_id TEXT UNIQUE,
  shopify_price_rule_id TEXT,
  discount_type TEXT NOT NULL,
  value REAL NOT NULL,
  usage_limit INTEGER,
  usage_limit_per_customer INTEGER DEFAULT 1,
  minimum_purchase_amount REAL,
  starts_at TIMESTAMP NOT NULL,
  ends_at TIMESTAMP,
  applies_to_all_products BOOLEAN DEFAULT true,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_synced_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discount_codes_code ON discount_codes(code);
CREATE INDEX IF NOT EXISTS idx_discount_codes_status ON discount_codes(status);
CREATE INDEX IF NOT EXISTS idx_discount_codes_shopify_id ON discount_codes(shopify_discount_id);
CREATE INDEX IF NOT EXISTS idx_discount_codes_dates ON discount_codes(starts_at, ends_at);

-- Discount Code Products Table
CREATE TABLE IF NOT EXISTS discount_code_products (
  id SERIAL PRIMARY KEY,
  discount_code_id INTEGER NOT NULL REFERENCES discount_codes(id) ON DELETE CASCADE,
  variant_gid TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(discount_code_id, variant_gid)
);

CREATE INDEX IF NOT EXISTS idx_discount_products_code ON discount_code_products(discount_code_id);
CREATE INDEX IF NOT EXISTS idx_discount_products_variant ON discount_code_products(variant_gid);

-- Discount Code Usage Table
CREATE TABLE IF NOT EXISTS discount_code_usage (
  id SERIAL PRIMARY KEY,
  discount_code_id INTEGER NOT NULL REFERENCES discount_codes(id) ON DELETE CASCADE,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  shopify_order_id TEXT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_email TEXT,
  discount_amount REAL NOT NULL,
  order_total REAL,
  redeemed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discount_usage_code ON discount_code_usage(discount_code_id);
CREATE INDEX IF NOT EXISTS idx_discount_usage_customer ON discount_code_usage(customer_id);
CREATE INDEX IF NOT EXISTS idx_discount_usage_order ON discount_code_usage(order_id);
CREATE INDEX IF NOT EXISTS idx_discount_usage_redeemed ON discount_code_usage(redeemed_at);

-- Discount Code Sync Log Table
CREATE TABLE IF NOT EXISTS discount_code_sync_log (
  id SERIAL PRIMARY KEY,
  discount_code_id INTEGER REFERENCES discount_codes(id) ON DELETE SET NULL,
  shopify_discount_id TEXT,
  action TEXT NOT NULL,
  details TEXT,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discount_sync_log_code ON discount_code_sync_log(discount_code_id);
CREATE INDEX IF NOT EXISTS idx_discount_sync_log_shopify ON discount_code_sync_log(shopify_discount_id);
CREATE INDEX IF NOT EXISTS idx_discount_sync_log_synced ON discount_code_sync_log(synced_at);

-- Migrations Tracking Table
CREATE TABLE IF NOT EXISTS migrations (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
