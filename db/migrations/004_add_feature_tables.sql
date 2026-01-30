-- Feature Management Tables
-- Allows centralized management of product features in Admin Panel

-- Features Table
-- Stores all available features that can be assigned to products
CREATE TABLE IF NOT EXISTS features (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,         -- Feature name (e.g. "Professionelle Kamera")
  display_order INTEGER DEFAULT 0,           -- Order for display in UI
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Product Features Table
-- Maps which features are enabled for which products
CREATE TABLE IF NOT EXISTS product_features (
  id SERIAL PRIMARY KEY,
  product_id VARCHAR(255) NOT NULL,          -- Product ID (e.g. "basic-fotobox", "premium-fotobox")
  feature_id INTEGER NOT NULL,               -- Reference to features table
  enabled BOOLEAN DEFAULT true,              -- Whether this feature is enabled for this product
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE,
  UNIQUE(product_id, feature_id)            -- Prevent duplicate entries
);

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_product_features_product ON product_features(product_id);
CREATE INDEX IF NOT EXISTS idx_product_features_feature ON product_features(feature_id);
CREATE INDEX IF NOT EXISTS idx_features_display_order ON features(display_order);
