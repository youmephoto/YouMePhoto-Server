import pg from 'pg';

const connectionString = 'postgresql://postgres:FtxKRPOiKkxAMCEBgypOiZkxpSmkpvfh@gondola.proxy.rlwy.net:52060/railway';

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function checkOrders() {
  try {
    console.log('🔍 Checking orders in database...\n');

    // Check total orders
    const totalResult = await pool.query('SELECT COUNT(*) as total FROM orders');
    console.log(`Total orders: ${totalResult.rows[0].total}`);

    // Check recent orders
    const ordersResult = await pool.query(`
      SELECT
        id,
        order_id,
        shopify_order_id,
        status,
        financial_status,
        total_amount,
        created_at
      FROM orders
      ORDER BY created_at DESC
      LIMIT 10
    `);

    if (ordersResult.rows.length > 0) {
      console.log('\n📦 Recent orders:');
      ordersResult.rows.forEach(order => {
        console.log(`  - ${order.order_id} | Status: ${order.status} | Amount: ${order.total_amount} | Created: ${order.created_at}`);
      });
    } else {
      console.log('\n⚠️  No orders found in database!');
    }

    // Check customers
    const customersResult = await pool.query('SELECT COUNT(*) as total FROM customers');
    console.log(`\nTotal customers: ${customersResult.rows[0].total}`);

    // Check order items
    const itemsResult = await pool.query('SELECT COUNT(*) as total FROM order_items');
    console.log(`Total order items: ${itemsResult.rows[0].total}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

checkOrders();
