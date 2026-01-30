-- Fix customer order counts by recalculating from actual orders
-- This script recalculates total_orders and total_revenue for all customers
-- based on the actual orders in the database

-- First, set all counts to 0
UPDATE customers
SET total_orders = 0,
    total_revenue = 0,
    updated_at = CURRENT_TIMESTAMP;

-- Then, update counts based on actual orders
-- Only count orders that are NOT cancelled or refunded
UPDATE customers
SET total_orders = (
    SELECT COUNT(*)
    FROM orders
    WHERE orders.customer_id = customers.id
      AND orders.status != 'cancelled'
      AND orders.financial_status != 'refunded'
),
total_revenue = (
    SELECT COALESCE(SUM(total_amount), 0)
    FROM orders
    WHERE orders.customer_id = customers.id
      AND orders.status != 'cancelled'
      AND orders.financial_status != 'refunded'
),
updated_at = CURRENT_TIMESTAMP;

-- Show results
SELECT
    id,
    email,
    first_name,
    last_name,
    total_orders,
    total_revenue
FROM customers
WHERE total_orders > 0 OR total_revenue > 0
ORDER BY total_orders DESC;
