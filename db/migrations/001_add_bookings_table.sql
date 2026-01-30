-- Add Bookings Table
-- Stores all rental bookings locally instead of in Shopify metafields

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  booking_id VARCHAR(255) UNIQUE NOT NULL,           -- UUID for external reference
  variant_gid VARCHAR(255) NOT NULL,                 -- Shopify variant GID
  product_title TEXT NOT NULL,                       -- Product name for display
  variant_title TEXT NOT NULL,                       -- Variant/color name

  customer_email VARCHAR(255) NOT NULL,              -- Customer email
  customer_name VARCHAR(255),                        -- Customer name (optional)

  event_date VARCHAR(255) NOT NULL,                  -- Event date (YYYY-MM-DD)

  status VARCHAR(50) NOT NULL DEFAULT 'pending',     -- pending, confirmed, cancelled, completed

  order_id VARCHAR(255),                             -- Shopify order ID (if confirmed)

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (variant_gid) REFERENCES variant_inventory(variant_gid)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_bookings_variant ON bookings(variant_gid);
CREATE INDEX IF NOT EXISTS idx_bookings_event_date ON bookings(event_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_email);
CREATE INDEX IF NOT EXISTS idx_bookings_booking_id ON bookings(booking_id);
