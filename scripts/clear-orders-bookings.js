import pg from 'pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/testdb';

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function clearData() {
  const client = await pool.connect();

  try {
    console.log('🗑️  Starting cleanup...\n');

    // Start transaction
    await client.query('BEGIN');

    // 1. Check current counts
    const ordersCount = await client.query('SELECT COUNT(*) as count FROM orders');
    const orderItemsCount = await client.query('SELECT COUNT(*) as count FROM order_items');
    const orderHistoryCount = await client.query('SELECT COUNT(*) as count FROM order_status_history');
    const bookingsCount = await client.query('SELECT COUNT(*) as count FROM bookings');

    console.log('📊 Current counts:');
    console.log(`  - Orders: ${ordersCount.rows[0].count}`);
    console.log(`  - Order Items: ${orderItemsCount.rows[0].count}`);
    console.log(`  - Order History: ${orderHistoryCount.rows[0].count}`);
    console.log(`  - Bookings: ${bookingsCount.rows[0].count}`);
    console.log('');

    // 2. Delete order status history (has foreign key to orders)
    console.log('🗑️  Deleting order status history...');
    await client.query('DELETE FROM order_status_history');

    // 3. Delete order items (has foreign key to orders)
    console.log('🗑️  Deleting order items...');
    await client.query('DELETE FROM order_items');

    // 4. Delete orders
    console.log('🗑️  Deleting orders...');
    await client.query('DELETE FROM orders');

    // 5. Delete bookings
    console.log('🗑️  Deleting bookings...');
    await client.query('DELETE FROM bookings');

    // 6. Reset customer stats
    console.log('🗑️  Resetting customer stats...');
    await client.query('UPDATE customers SET total_orders = 0, total_revenue = 0.0, last_order_at = NULL');

    // Commit transaction
    await client.query('COMMIT');

    console.log('');
    console.log('✅ Cleanup complete!');
    console.log('');

    // Verify counts
    const newOrdersCount = await client.query('SELECT COUNT(*) as count FROM orders');
    const newBookingsCount = await client.query('SELECT COUNT(*) as count FROM bookings');

    console.log('📊 New counts:');
    console.log(`  - Orders: ${newOrdersCount.rows[0].count}`);
    console.log(`  - Bookings: ${newBookingsCount.rows[0].count}`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    client.release();
    await pool.end();
  }
}

clearData();
