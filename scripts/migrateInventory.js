/**
 * Migration Script: Copy Inventory from Shopify to Local Database
 *
 * Usage:
 *   node scripts/migrateInventory.js
 *
 * This script:
 * 1. Fetches all Fotobox products from Shopify
 * 2. Extracts variant inventory quantities
 * 3. Stores them in local SQLite database
 */

import shopifyClient from '../config/shopify.js';
import { variantInventoryQueries } from '../db/database.js';

async function migrateInventory() {
  console.log('[Migration] Starting inventory migration from Shopify...\n');

  try {
    // Fetch all products from Shopify
    console.log('[Migration] Step 1: Fetching products from Shopify...');

    const query = `
      query getAllProducts {
        products(first: 250) {
          nodes {
            id
            title
            tags
            variants(first: 100) {
              nodes {
                id
                title
                inventoryQuantity
                price
              }
            }
          }
        }
      }
    `;

    const response = await shopifyClient.graphql(query);
    const products = response.products.nodes;

    console.log(`[Migration] ✓ Found ${products.length} products\n`);

    if (products.length === 0) {
      console.log('[Migration] ⚠️  No products found in Shopify!');
      console.log('[Migration] Please check:');
      console.log('[Migration]   1. Your SHOPIFY_ACCESS_TOKEN has read_products permission');
      console.log('[Migration]   2. Your store has products');
      console.log('[Migration]   3. Your API credentials are correct\n');
      return;
    }

    // Show all products
    console.log('[Migration] Available products:');
    products.forEach(p => {
      console.log(`  - ${p.title} (${p.variants.nodes.length} variants, tags: ${p.tags.join(', ') || 'none'})`);
    });
    console.log('');

    // Filter products: only "Photobox" products
    const photoboxProducts = products.filter(p => p.title.includes('Photobox'));

    if (photoboxProducts.length === 0) {
      console.log('[Migration] ⚠️  No "Photobox" products found!');
      return;
    }

    console.log(`[Migration] Filtered to ${photoboxProducts.length} Photobox products\n`);

    // Process each product
    let totalVariants = 0;
    let migratedCount = 0;

    for (const product of photoboxProducts) {
      console.log(`[Migration] Processing: ${product.title}`);

      for (const variant of product.variants.nodes) {
        totalVariants++;

        // Extract numeric ID from GID
        const numericId = variant.id.split('/').pop();

        // Prepare data
        const variantData = {
          variant_gid: variant.id,
          variant_numeric_id: numericId,
          product_title: product.title,
          variant_title: variant.title || 'Standard',
          total_units: variant.inventoryQuantity || 1,
          price: variant.price,
        };

        try {
          // Insert into database
          variantInventoryQueries.upsert(
            variantData.variant_gid,
            variantData.variant_numeric_id,
            variantData.product_title,
            variantData.variant_title,
            variantData.total_units,
            variantData.price
          );

          console.log(`  ✓ ${variant.title}: ${variant.inventoryQuantity} units`);
          migratedCount++;
        } catch (error) {
          console.error(`  ✗ Failed to migrate ${variant.title}:`, error.message);
        }
      }

      console.log('');
    }

    console.log('[Migration] =====================================');
    console.log(`[Migration] Migration Complete!`);
    console.log(`[Migration] Total variants found: ${totalVariants}`);
    console.log(`[Migration] Successfully migrated: ${migratedCount}`);
    console.log(`[Migration] Failed: ${totalVariants - migratedCount}`);
    console.log('[Migration] =====================================\n');

    // Show migrated data
    console.log('[Migration] Migrated inventory:');
    const allInventory = variantInventoryQueries.getAll();

    allInventory.forEach(item => {
      console.log(`  ${item.product_title} - ${item.variant_title}: ${item.total_units} units`);
    });

    console.log('\n[Migration] ✓ You can now disable Shopify inventory tracking!');
    console.log('[Migration] ✓ The system will use this database instead.');

  } catch (error) {
    console.error('[Migration] ✗ Migration failed:', error);
    throw error;
  }
}

// Run migration
migrateInventory()
  .then(() => {
    console.log('\n[Migration] Done! You can now start the server.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n[Migration] Migration failed:', error);
    process.exit(1);
  });
