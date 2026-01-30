import shopifyClient from '../config/shopify.js';

async function findProduct() {
  const query = `
    query {
      products(first: 10, query: "title:*Photobox*") {
        nodes {
          id
          title
          productType
          variants(first: 5) {
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

  console.log('Found products:');
  response.products.nodes.forEach(product => {
    console.log(`\nProduct: ${product.title}`);
    console.log(`  ID: ${product.id}`);
    console.log(`  Type: ${product.productType}`);
    console.log(`  Variants:`);
    product.variants.nodes.forEach(v => {
      console.log(`    - ${v.title} (${v.id})`);
    });

    if (product.metafield?.value) {
      const bookings = JSON.parse(product.metafield.value);
      console.log(`  Bookings: ${bookings.length} total`);
    } else {
      console.log(`  Bookings: No bookings metafield`);
    }
  });
}

findProduct().catch(console.error);
