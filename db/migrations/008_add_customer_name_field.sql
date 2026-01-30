-- Migration 008: Add name field to customers table
-- Allows storing full name as single field (alternative to first_name/last_name)

ALTER TABLE customers ADD COLUMN name TEXT;

-- Create index for name searches
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
