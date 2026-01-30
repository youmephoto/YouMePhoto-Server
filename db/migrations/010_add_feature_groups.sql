-- Migration 010: Add Feature Groups
-- This migration adds support for grouping features together

-- Create feature_groups table
CREATE TABLE IF NOT EXISTS feature_groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add group_id column to features table (only if it doesn't exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='features' AND column_name='group_id') THEN
    ALTER TABLE features ADD COLUMN group_id INTEGER REFERENCES feature_groups(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Insert default group "Allgemeine Features" (only if it doesn't exist)
INSERT INTO feature_groups (name, display_order)
SELECT 'Allgemeine Features', 0
WHERE NOT EXISTS (SELECT 1 FROM feature_groups WHERE name = 'Allgemeine Features');

-- Update all existing features to use the default group
UPDATE features
SET group_id = (SELECT id FROM feature_groups WHERE name = 'Allgemeine Features')
WHERE group_id IS NULL;

-- Create index on group_id for better query performance
CREATE INDEX IF NOT EXISTS idx_features_group_id ON features(group_id);
CREATE INDEX IF NOT EXISTS idx_feature_groups_display_order ON feature_groups(display_order);
