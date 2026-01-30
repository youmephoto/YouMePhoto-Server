-- Photo Strips Feature Migration
-- Adds tables for custom photo strip design editor
-- Run with: node server/scripts/migrate-photo-strips.js

-- Photo Strips Table
-- Stores customer design data and access control
CREATE TABLE IF NOT EXISTS photo_strips (
  id SERIAL PRIMARY KEY,
  strip_id VARCHAR(255) UNIQUE NOT NULL,      -- UUID for external access
  booking_id VARCHAR(255) NOT NULL,           -- FK to bookings table
  customer_email VARCHAR(255) NOT NULL,       -- For validation

  -- Design Data (stored as JSON)
  design_data TEXT NOT NULL DEFAULT '{}',     -- JSON: Fabric.js Canvas State
  template_id INTEGER,                        -- FK to design_templates (optional)

  -- Status & Metadata
  status VARCHAR(50) NOT NULL DEFAULT 'draft', -- draft, finalized, delivered
  version INTEGER DEFAULT 1,                  -- Design version number

  -- File References
  preview_image_path TEXT,                    -- Path to preview PNG
  final_image_path TEXT,                      -- Path to finalized design

  -- Access Control
  access_token VARCHAR(255) NOT NULL,         -- Secure token for URL access
  access_expires_at TIMESTAMP,                -- Optional expiry for link

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finalized_at TIMESTAMP,

  FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE
);

-- Indexes for photo_strips
CREATE INDEX IF NOT EXISTS idx_photo_strips_booking ON photo_strips(booking_id);
CREATE INDEX IF NOT EXISTS idx_photo_strips_access_token ON photo_strips(access_token);
CREATE INDEX IF NOT EXISTS idx_photo_strips_strip_id ON photo_strips(strip_id);
CREATE INDEX IF NOT EXISTS idx_photo_strips_customer_email ON photo_strips(customer_email);
CREATE INDEX IF NOT EXISTS idx_photo_strips_status ON photo_strips(status);

-- Design Templates Table
-- Stores predefined templates (Hochzeit, Geburtstag, Corporate, etc.)
CREATE TABLE IF NOT EXISTS design_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,                 -- "Hochzeit Elegant", "Geburtstag Bunt"
  category VARCHAR(100) NOT NULL,             -- "wedding", "birthday", "corporate", "custom"

  -- Template Configuration (JSON)
  template_data TEXT NOT NULL,                -- JSON: Fabric.js objects, styles, layout

  -- Metadata
  thumbnail_path TEXT,                        -- Preview image for template selector
  description TEXT,                           -- User-facing description
  is_active BOOLEAN DEFAULT true,             -- Enable/disable templates
  display_order INTEGER DEFAULT 0,            -- Sort order in UI

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for design_templates
CREATE INDEX IF NOT EXISTS idx_templates_category ON design_templates(category);
CREATE INDEX IF NOT EXISTS idx_templates_active ON design_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_templates_display_order ON design_templates(display_order);

-- Uploaded Images Table
-- Tracks customer-uploaded logos and images
CREATE TABLE IF NOT EXISTS uploaded_images (
  id SERIAL PRIMARY KEY,
  image_id VARCHAR(255) UNIQUE NOT NULL,      -- UUID
  photo_strip_id INTEGER NOT NULL,            -- FK to photo_strips

  -- File Information
  original_filename VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,                    -- Path on Railway storage
  file_size INTEGER NOT NULL,                 -- Bytes
  mime_type VARCHAR(100) NOT NULL,            -- image/png, image/jpeg

  -- Image Dimensions
  width INTEGER,
  height INTEGER,

  -- Optimization
  optimized_path TEXT,                        -- Resized/optimized version

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (photo_strip_id) REFERENCES photo_strips(id) ON DELETE CASCADE
);

-- Indexes for uploaded_images
CREATE INDEX IF NOT EXISTS idx_uploaded_images_strip ON uploaded_images(photo_strip_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_images_image_id ON uploaded_images(image_id);

-- Photo Strip Versions Table (optional - for design history)
CREATE TABLE IF NOT EXISTS photo_strip_versions (
  id SERIAL PRIMARY KEY,
  photo_strip_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,
  design_data TEXT NOT NULL,                  -- Snapshot of design_data
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (photo_strip_id) REFERENCES photo_strips(id) ON DELETE CASCADE,
  UNIQUE(photo_strip_id, version_number)
);

-- Index for versions
CREATE INDEX IF NOT EXISTS idx_photo_strip_versions ON photo_strip_versions(photo_strip_id);
