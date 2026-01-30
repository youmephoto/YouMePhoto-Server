-- Migration: Remove FOREIGN KEY constraint from bookings table
-- This allows bookings for variants that aren't in variant_inventory yet
-- (e.g., new products or variants added to Shopify)

-- PostgreSQL: Drop the foreign key constraint if it exists
DO $$
BEGIN
  -- Check if the foreign key exists and drop it
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'bookings_variant_gid_fkey'
    AND table_name = 'bookings'
  ) THEN
    ALTER TABLE bookings DROP CONSTRAINT bookings_variant_gid_fkey;
  END IF;
END $$;

-- Add new columns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bookings' AND column_name='start_date') THEN
    ALTER TABLE bookings ADD COLUMN start_date VARCHAR(255);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bookings' AND column_name='end_date') THEN
    ALTER TABLE bookings ADD COLUMN end_date VARCHAR(255);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bookings' AND column_name='total_days') THEN
    ALTER TABLE bookings ADD COLUMN total_days INTEGER DEFAULT 1;
  END IF;
END $$;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_bookings_variant ON bookings(variant_gid);
CREATE INDEX IF NOT EXISTS idx_bookings_event_date ON bookings(event_date);
CREATE INDEX IF NOT EXISTS idx_bookings_date_range ON bookings(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_email);
CREATE INDEX IF NOT EXISTS idx_bookings_booking_id ON bookings(booking_id);
