-- Migration 013: Rename Package IDs
-- Updates product_id references from old naming (basic/luxury) to new naming (eco/business)
-- Premium remains unchanged

-- Update product_features table: photobox-basic → photobox-eco
UPDATE product_features
SET product_id = 'photobox-eco'
WHERE product_id = 'photobox-basic';

-- Update product_features table: photobox-luxury → photobox-business
UPDATE product_features
SET product_id = 'photobox-business'
WHERE product_id = 'photobox-luxury';

-- Note: photobox-premium remains unchanged and does not need migration
