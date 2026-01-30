import shopifyClient from '../config/shopify.js';
import db from '../db/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('=== Migration: Shopify Bookings → Local Database ===\n');

// 1. Create bookings table
console.log('Step 1: Creating bookings table...');
const migrationSQL = fs.readFileSync(
  path.join(__dirname, '../db/migrations/001_add_bookings_table.sql'),
  'utf-8'
);
db.exec(migrationSQL);
console.log('✓ Bookings table created\n');

// 2. Fetch all products with bookings from Shopify
console.log('Step 2: Fetching bookings from Shopify...');

const query = `
  query {
    products(first: 50, query: "title:*Photobox*") {
      nodes {
        id
        title
        variants(first: 50) {
          nodes {
            id
            title
          }
        }
        metafield(namespace: "fotobox_rental", key: "bookings") {
          value
        }
      }
    }
  }
`;

const response = await shopifyClient.graphql(query);
const products = response.products.nodes;

let totalBookings = 0;
let migratedBookings = 0;

// 3. Prepare insert statement
const insertBooking = db.prepare(`
  INSERT OR IGNORE INTO bookings (
    booking_id,
    variant_gid,
    product_title,
    variant_title,
    customer_email,
    customer_name,
    event_date,
    status,
    order_id,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// 4. Migrate each product's bookings
for (const product of products) {
  if (!product.metafield?.value) continue;

  const bookings = JSON.parse(product.metafield.value);
  totalBookings += bookings.length;

  console.log(`\nProduct: ${product.title} - ${bookings.length} bookings`);

  for (const booking of bookings) {
    // Find variant title
    const variant = product.variants.nodes.find(v => v.id === booking.variantId);
    const variantTitle = variant?.title || 'Unknown';

    // Skip test bookings (optional - you can delete these)
    // Uncomment the next 3 lines if you want to skip test bookings during migration
    // if (booking.customerEmail === 'maffey.marcel@gmx.net' || booking.customerEmail === 'yschollmayer@gmail.com') {
    //   console.log(`  Skipping test booking: ${booking.bookingId}`);
    //   continue;
    // }

    try {
      insertBooking.run(
        booking.bookingId,
        booking.variantId,
        booking.productTitle || product.title,
        variantTitle,
        booking.customerEmail,
        null, // customer_name not in old format
        booking.eventDate,
        booking.status || 'pending',
        null, // order_id not in old format
        booking.createdAt
      );
      migratedBookings++;
      console.log(`  ✓ Migrated: ${booking.bookingId} - ${booking.eventDate}`);
    } catch (error) {
      console.log(`  ✗ Failed: ${booking.bookingId} - ${error.message}`);
    }
  }
}

console.log(`\n=== Migration Complete ===`);
console.log(`Total bookings found in Shopify: ${totalBookings}`);
console.log(`Successfully migrated to database: ${migratedBookings}`);

// 5. Verify migration
const count = db.prepare('SELECT COUNT(*) as count FROM bookings').get();
console.log(`\nBookings in database: ${count.count}`);

// 6. Show sample data
console.log('\nSample bookings:');
const sample = db.prepare('SELECT * FROM bookings LIMIT 5').all();
console.table(sample);

console.log('\n✅ Migration completed successfully!');
console.log('\nNext steps:');
console.log('1. Test the system to ensure bookings work correctly');
console.log('2. If everything works, you can clear Shopify metafield bookings');
console.log('3. Update code to use local DB instead of Shopify metafields');
