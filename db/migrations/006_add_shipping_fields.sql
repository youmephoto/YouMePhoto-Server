-- Migration 006: Add Shipping & Order Management Fields
-- Date: 2026-01-09
-- Description: Adds shipping status tracking, DHL integration fields, and order management

-- ============================================
-- Add shipping fields to bookings table
-- ============================================

DO $$
BEGIN
  -- Shipping status (workflow states)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bookings' AND column_name='shipping_status') THEN
    ALTER TABLE bookings ADD COLUMN shipping_status VARCHAR(50) DEFAULT 'not_shipped';
  END IF;
  -- Possible values: not_shipped, preparing, shipped, delivered, returned, overdue

  -- Tracking information
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bookings' AND column_name='tracking_number') THEN
    ALTER TABLE bookings ADD COLUMN tracking_number VARCHAR(255);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bookings' AND column_name='shipping_carrier') THEN
    ALTER TABLE bookings ADD COLUMN shipping_carrier VARCHAR(100) DEFAULT 'DHL';
  END IF;

  -- Shipping timestamps
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bookings' AND column_name='shipped_at') THEN
    ALTER TABLE bookings ADD COLUMN shipped_at TIMESTAMP;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bookings' AND column_name='delivered_at') THEN
    ALTER TABLE bookings ADD COLUMN delivered_at TIMESTAMP;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bookings' AND column_name='returned_at') THEN
    ALTER TABLE bookings ADD COLUMN returned_at TIMESTAMP;
  END IF;

  -- Shipping documents
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bookings' AND column_name='shipping_label_url') THEN
    ALTER TABLE bookings ADD COLUMN shipping_label_url TEXT;
  END IF;
  -- Path to generated DHL label PDF: /uploads/shipping-labels/{booking_id}.pdf

  -- Customer resources
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bookings' AND column_name='setup_instructions_url') THEN
    ALTER TABLE bookings ADD COLUMN setup_instructions_url TEXT DEFAULT '/docs/setup-guide.pdf';
  END IF;
  -- Link to setup guide/manual

  -- Admin notes
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bookings' AND column_name='notes') THEN
    ALTER TABLE bookings ADD COLUMN notes TEXT;
  END IF;
  -- Internal notes for admin team
END $$;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_bookings_shipping_status ON bookings(shipping_status);
CREATE INDEX IF NOT EXISTS idx_bookings_shipped_at ON bookings(shipped_at);
CREATE INDEX IF NOT EXISTS idx_bookings_tracking_number ON bookings(tracking_number);

-- ============================================
-- Create shipping_history table
-- ============================================

CREATE TABLE IF NOT EXISTS shipping_history (
  id SERIAL PRIMARY KEY,
  booking_id VARCHAR(255) NOT NULL,
  tracking_number VARCHAR(255) NOT NULL,

  -- DHL status codes
  status VARCHAR(50) NOT NULL,
    -- Possible values: in_transit, out_for_delivery, delivered, exception, returned

  status_description TEXT,
    -- Human-readable description from DHL

  location VARCHAR(255),
    -- Current location of package

  timestamp TIMESTAMP NOT NULL,
    -- When this status occurred

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- When we recorded this event

  FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE
);

-- Indexes for shipping_history queries
CREATE INDEX IF NOT EXISTS idx_shipping_history_booking ON shipping_history(booking_id);
CREATE INDEX IF NOT EXISTS idx_shipping_history_tracking ON shipping_history(tracking_number);
CREATE INDEX IF NOT EXISTS idx_shipping_history_status ON shipping_history(status);
CREATE INDEX IF NOT EXISTS idx_shipping_history_timestamp ON shipping_history(timestamp);

-- ============================================
-- Migration Complete
-- ============================================
