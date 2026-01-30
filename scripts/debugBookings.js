import shopifyClient from '../config/shopify.js';

const SCHWARZ_GID = 'gid://shopify/ProductVariant/51917489013073';
const PRODUCT_ID = 'gid://shopify/Product/10370369093969';

async function debugBookings() {
  console.log('Fetching bookings for Schwarz variant...\n');

  const query = `
    query getProductMetafields($id: ID!) {
      product(id: $id) {
        metafield(namespace: "fotobox_rental", key: "bookings") {
          value
        }
      }
    }
  `;

  const response = await shopifyClient.graphql(query, { id: PRODUCT_ID });
  const allBookings = response.product?.metafield?.value
    ? JSON.parse(response.product.metafield.value)
    : [];

  const schwarzBookings = allBookings.filter(b => b.variantId === SCHWARZ_GID);

  console.log(`Total bookings for Schwarz: ${schwarzBookings.length}\n`);
  console.log('All bookings:');
  console.log(JSON.stringify(schwarzBookings, null, 2));

  console.log('\n\n=== Checking which bookings block December 25, 2025 ===\n');

  const checkDate = new Date('2025-12-25');
  const bufferBefore = 2;
  const bufferAfter = 2;

  schwarzBookings.forEach((booking, idx) => {
    if (booking.status === 'cancelled') {
      console.log(`Booking ${idx + 1}: CANCELLED - ${booking.eventDate}`);
      return;
    }

    const eventDate = new Date(booking.eventDate);
    const blockedStart = new Date(eventDate);
    blockedStart.setDate(blockedStart.getDate() - bufferBefore);

    const blockedEnd = new Date(eventDate);
    blockedEnd.setDate(blockedEnd.getDate() + bufferAfter);

    const blocks25th = checkDate >= blockedStart && checkDate <= blockedEnd;

    console.log(`Booking ${idx + 1}:`);
    console.log(`  Event Date: ${booking.eventDate}`);
    console.log(`  Blocked Range: ${blockedStart.toISOString().split('T')[0]} to ${blockedEnd.toISOString().split('T')[0]}`);
    console.log(`  Blocks Dec 25? ${blocks25th ? '✅ YES' : '❌ NO'}`);
    console.log(`  Status: ${booking.status}`);
    console.log('');
  });
}

debugBookings().catch(console.error);
