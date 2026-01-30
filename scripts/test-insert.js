import pg from 'pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/testdb';

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function testInsert() {
  try {
    console.log('Testing INSERT with RETURNING...\n');

    // Test 1: Simple insert with RETURNING
    console.log('Test 1: Simple INSERT with RETURNING id');
    const result1 = await pool.query(`
      INSERT INTO orders (
        order_id, customer_id, shopify_order_id, shopify_order_number,
        status, financial_status, fulfillment_status,
        total_amount, currency, shopify_created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `, ['#TEST-001', 2, 'gid://shopify/Order/TEST001', '1001', 'pending', 'pending', 'unfulfilled', 100.00, 'EUR', new Date().toISOString()]);

    console.log('Result 1:', JSON.stringify(result1, null, 2));
    console.log('Rows:', result1.rows);
    console.log('ID:', result1.rows[0]?.id);
    console.log('');

    // Clean up
    if (result1.rows[0]?.id) {
      await pool.query('DELETE FROM orders WHERE id = $1', [result1.rows[0].id]);
      console.log('✓ Test order cleaned up');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

testInsert();
