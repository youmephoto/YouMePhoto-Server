-- Migration: Add multi-day booking fields to bookings table
-- This allows storing rental periods with start/end dates and total days

-- Add new columns for multi-day bookings
ALTER TABLE bookings ADD COLUMN start_date TEXT;
ALTER TABLE bookings ADD COLUMN end_date TEXT;
ALTER TABLE bookings ADD COLUMN total_days INTEGER DEFAULT 1;

-- Set default values for existing bookings (event_date becomes start_date and end_date)
UPDATE bookings SET start_date = event_date WHERE start_date IS NULL;
UPDATE bookings SET end_date = event_date WHERE end_date IS NULL;
UPDATE bookings SET total_days = 1 WHERE total_days IS NULL;

-- Add index for date range queries
CREATE INDEX IF NOT EXISTS idx_bookings_date_range ON bookings(start_date, end_date);
