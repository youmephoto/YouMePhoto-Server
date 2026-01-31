-- Migration 013: Add Event Code to Bookings
-- Date: 2026-01-31
-- Description: Adds 6-character event code and expiration timestamp to bookings table
--
-- Event codes are used for:
-- - Fotobox App access
-- - Diashow (slideshow) access
-- - Customer self-service event viewing
--
-- Event code format: 6 uppercase alphanumeric characters (A-Z except I/O, 2-9)
-- Example codes: A3X9K2, H7P5M4, ZW8N3R
--
-- Expiration: Default 30 days after event date for security

-- ============================================
-- Add event_code and event_code_expires_at columns
-- ============================================

DO $$
BEGIN
  -- Event code column (6-char alphanumeric, UPPERCASE)
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'bookings'
      AND column_name = 'event_code'
  ) THEN
    ALTER TABLE bookings ADD COLUMN event_code VARCHAR(6) UNIQUE;
    RAISE NOTICE 'Added event_code column to bookings table';
  ELSE
    RAISE NOTICE 'event_code column already exists, skipping';
  END IF;

  -- Event code expiration timestamp
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'bookings'
      AND column_name = 'event_code_expires_at'
  ) THEN
    ALTER TABLE bookings ADD COLUMN event_code_expires_at TIMESTAMP;
    RAISE NOTICE 'Added event_code_expires_at column to bookings table';
  ELSE
    RAISE NOTICE 'event_code_expires_at column already exists, skipping';
  END IF;
END $$;

-- ============================================
-- Create performance indexes
-- ============================================

-- Unique index for fast lookups and duplicate prevention
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_event_code
  ON bookings(event_code);

-- Partial index for expiration checks (excludes NULL values for efficiency)
CREATE INDEX IF NOT EXISTS idx_bookings_event_code_expiry
  ON bookings(event_code_expires_at)
  WHERE event_code_expires_at IS NOT NULL;

-- ============================================
-- Add helpful comments to columns
-- ============================================

COMMENT ON COLUMN bookings.event_code IS
  '6-character event code for app/slideshow access (format: A3X9K2). NULL for old bookings.';

COMMENT ON COLUMN bookings.event_code_expires_at IS
  'Expiration timestamp for event code. After this date, code becomes invalid. Default: event_date + 30 days.';

-- ============================================
-- Migration verification
-- ============================================

DO $$
DECLARE
  event_code_exists BOOLEAN;
  expiry_exists BOOLEAN;
  event_code_index_exists BOOLEAN;
BEGIN
  -- Check columns exist
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'event_code'
  ) INTO event_code_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'event_code_expires_at'
  ) INTO expiry_exists;

  -- Check index exists
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'bookings' AND indexname = 'idx_bookings_event_code'
  ) INTO event_code_index_exists;

  -- Verification report
  IF event_code_exists AND expiry_exists AND event_code_index_exists THEN
    RAISE NOTICE '✓ Migration 013 completed successfully';
    RAISE NOTICE '  - event_code column: CREATED';
    RAISE NOTICE '  - event_code_expires_at column: CREATED';
    RAISE NOTICE '  - idx_bookings_event_code index: CREATED';
  ELSE
    RAISE WARNING '⚠ Migration 013 incomplete - manual verification required';
  END IF;
END $$;

-- ============================================
-- Optional: Backfill for existing bookings
-- ============================================

-- NOTE: This section is COMMENTED OUT by default
-- Uncomment and run separately if you want to generate codes for existing bookings

/*
-- Generate event codes for existing confirmed bookings
-- WARNING: This will call the application code, not directly generate codes here
-- Use server/scripts/backfill-event-codes.js instead

DO $$
DECLARE
  booking_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO booking_count
  FROM bookings
  WHERE event_code IS NULL
    AND status IN ('confirmed', 'shipped', 'delivered');

  RAISE NOTICE 'Found % bookings without event codes', booking_count;
  RAISE NOTICE 'Run: node server/scripts/backfill-event-codes.js to generate codes';
END $$;
*/

-- ============================================
-- Migration Complete
-- ============================================
