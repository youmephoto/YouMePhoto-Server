-- Migration: Add custom_text column to product_features table
-- Purpose: Allow features to display custom text instead of checkmarks for better conversion

ALTER TABLE product_features ADD COLUMN IF NOT EXISTS custom_text TEXT;

-- Add comment to explain the column
COMMENT ON COLUMN product_features.custom_text IS 'Optional custom text to display instead of checkmark. If null, show checkmark based on enabled status.';
