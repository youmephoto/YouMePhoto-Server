-- Migration 006: Inventory Schedule
-- Adds time-based inventory management for production scaling
-- Allows defining future inventory levels based on production dates

-- ==========================================
-- INVENTORY SCHEDULE TABLE
-- ==========================================
-- Stores inventory snapshots that become active at specific dates
-- Example: 2 units now, 5 units from March 1st, 10 units from May 1st
CREATE TABLE IF NOT EXISTS inventory_schedule (
  id SERIAL PRIMARY KEY,
  variant_gid VARCHAR(255) NOT NULL,         -- Link to variant_inventory
  effective_date VARCHAR(255) NOT NULL,      -- Date when this quantity becomes active (YYYY-MM-DD)
  total_units INTEGER NOT NULL,              -- Number of units available from this date
  note TEXT,                                 -- Optional: Reason/description (e.g. "Production batch 2")
  created_by VARCHAR(255) DEFAULT 'admin',   -- Admin who created this schedule
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (variant_gid) REFERENCES variant_inventory(variant_gid) ON DELETE CASCADE
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_inventory_schedule_variant ON inventory_schedule(variant_gid);
CREATE INDEX IF NOT EXISTS idx_inventory_schedule_date ON inventory_schedule(effective_date);
CREATE INDEX IF NOT EXISTS idx_inventory_schedule_variant_date ON inventory_schedule(variant_gid, effective_date);

-- ==========================================
-- EXAMPLE DATA (COMMENTED OUT)
-- ==========================================
-- Uncomment and adjust for your variants:
--
-- INSERT INTO inventory_schedule (variant_gid, effective_date, total_units, note)
-- VALUES
--   ('gid://shopify/ProductVariant/123', '2026-01-09', 2, 'Currently available'),
--   ('gid://shopify/ProductVariant/123', '2026-03-01', 5, 'Production batch 2 delivered'),
--   ('gid://shopify/ProductVariant/123', '2026-05-01', 10, 'Production batch 3 completed');
