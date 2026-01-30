-- Migration 012: Add Shipping & Billing Addresses to Orders Table
-- Date: 2026-01-24
-- Description: Adds shipping and billing address fields to orders table for order data persistence

DO $$
BEGIN
  -- ============================================
  -- Add Shipping Address Fields
  -- ============================================

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='orders' AND column_name='shipping_name') THEN
    ALTER TABLE orders ADD COLUMN shipping_name TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='orders' AND column_name='shipping_address1') THEN
    ALTER TABLE orders ADD COLUMN shipping_address1 TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='orders' AND column_name='shipping_address2') THEN
    ALTER TABLE orders ADD COLUMN shipping_address2 TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='orders' AND column_name='shipping_city') THEN
    ALTER TABLE orders ADD COLUMN shipping_city TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='orders' AND column_name='shipping_province') THEN
    ALTER TABLE orders ADD COLUMN shipping_province TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='orders' AND column_name='shipping_country') THEN
    ALTER TABLE orders ADD COLUMN shipping_country TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='orders' AND column_name='shipping_zip') THEN
    ALTER TABLE orders ADD COLUMN shipping_zip TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='orders' AND column_name='shipping_phone') THEN
    ALTER TABLE orders ADD COLUMN shipping_phone TEXT;
  END IF;

  -- ============================================
  -- Add Billing Address Fields
  -- ============================================

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='orders' AND column_name='billing_name') THEN
    ALTER TABLE orders ADD COLUMN billing_name TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='orders' AND column_name='billing_address1') THEN
    ALTER TABLE orders ADD COLUMN billing_address1 TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='orders' AND column_name='billing_address2') THEN
    ALTER TABLE orders ADD COLUMN billing_address2 TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='orders' AND column_name='billing_city') THEN
    ALTER TABLE orders ADD COLUMN billing_city TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='orders' AND column_name='billing_province') THEN
    ALTER TABLE orders ADD COLUMN billing_province TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='orders' AND column_name='billing_country') THEN
    ALTER TABLE orders ADD COLUMN billing_country TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='orders' AND column_name='billing_zip') THEN
    ALTER TABLE orders ADD COLUMN billing_zip TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='orders' AND column_name='billing_phone') THEN
    ALTER TABLE orders ADD COLUMN billing_phone TEXT;
  END IF;

END $$;

-- Create indexes for shipping address lookups
CREATE INDEX IF NOT EXISTS idx_orders_shipping_zip ON orders(shipping_zip);
CREATE INDEX IF NOT EXISTS idx_orders_shipping_city ON orders(shipping_city);
CREATE INDEX IF NOT EXISTS idx_orders_billing_zip ON orders(billing_zip);
CREATE INDEX IF NOT EXISTS idx_orders_billing_city ON orders(billing_city);

-- ============================================
-- Migration Complete
-- ============================================
