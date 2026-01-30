-- Migration 007: Add street_number field to customers table
-- Separates street from house number for better data structure

ALTER TABLE customers ADD COLUMN street_number TEXT;
