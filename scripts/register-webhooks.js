/**
 * Script to register Shopify Webhooks
 *
 * This script registers all required webhooks in Shopify to keep
 * orders and bookings synchronized.
 *
 * Usage:
 *   node server/scripts/register-webhooks.js
 */

import shopifyClient from '../config/shopify.js';

const WEBHOOKS = [
  {
    topic: 'ORDERS_CREATE',
    endpoint: process.env.WEBHOOK_BASE_URL + '/api/webhooks/shopify/orders/create',
    description: 'Creates booking when order is placed'
  },
  {
    topic: 'ORDERS_UPDATED',
    endpoint: process.env.WEBHOOK_BASE_URL + '/api/webhooks/shopify/orders/updated',
    description: 'Syncs order status changes'
  },
  {
    topic: 'ORDERS_CANCELLED',
    endpoint: process.env.WEBHOOK_BASE_URL + '/api/webhooks/shopify/orders/cancelled',
    description: 'Cancels bookings and releases inventory'
  },
  {
    topic: 'REFUNDS_CREATE',
    endpoint: process.env.WEBHOOK_BASE_URL + '/api/webhooks/shopify/refunds/create',
    description: 'Handles refunds and partial refunds'
  }
];

/**
 * Check if webhook already exists
 */
async function getExistingWebhooks() {
  const query = `
    query {
      webhookSubscriptions(first: 50) {
        edges {
          node {
            id
            topic
            endpoint {
              __typename
              ... on WebhookHttpEndpoint {
                callbackUrl
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await shopifyClient.graphql(query);
    return response.webhookSubscriptions.edges.map(edge => edge.node);
  } catch (error) {
    console.error('Error fetching existing webhooks:', error);
    return [];
  }
}

/**
 * Register a single webhook
 */
async function registerWebhook(webhook) {
  const mutation = `
    mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
        webhookSubscription {
          id
          topic
          endpoint {
            __typename
            ... on WebhookHttpEndpoint {
              callbackUrl
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    topic: webhook.topic,
    webhookSubscription: {
      callbackUrl: webhook.endpoint,
      format: 'JSON'
    }
  };

  try {
    const response = await shopifyClient.graphql(mutation, variables);

    if (response.webhookSubscriptionCreate.userErrors.length > 0) {
      throw new Error(
        response.webhookSubscriptionCreate.userErrors
          .map(e => e.message)
          .join(', ')
      );
    }

    return response.webhookSubscriptionCreate.webhookSubscription;
  } catch (error) {
    throw new Error(`Failed to register webhook: ${error.message}`);
  }
}

/**
 * Delete a webhook
 */
async function deleteWebhook(id) {
  const mutation = `
    mutation webhookSubscriptionDelete($id: ID!) {
      webhookSubscriptionDelete(id: $id) {
        deletedWebhookSubscriptionId
        userErrors {
          field
          message
        }
      }
    }
  `;

  try {
    await shopifyClient.graphql(mutation, { id });
    return true;
  } catch (error) {
    console.error(`Error deleting webhook ${id}:`, error.message);
    return false;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🔄 Shopify Webhook Registration\n');
  console.log('Base URL:', process.env.WEBHOOK_BASE_URL);
  console.log('Webhooks to register:', WEBHOOKS.length);
  console.log('');

  if (!process.env.WEBHOOK_BASE_URL) {
    console.error('❌ ERROR: WEBHOOK_BASE_URL environment variable not set');
    console.error('   Set it to your production URL, e.g.:');
    console.error('   export WEBHOOK_BASE_URL=https://api.youmephoto.com');
    process.exit(1);
  }

  // Get existing webhooks
  console.log('📋 Fetching existing webhooks...');
  const existingWebhooks = await getExistingWebhooks();
  console.log(`   Found ${existingWebhooks.length} existing webhooks\n`);

  // Register each webhook
  for (const webhook of WEBHOOKS) {
    console.log(`📡 ${webhook.topic}`);
    console.log(`   ${webhook.description}`);
    console.log(`   URL: ${webhook.endpoint}`);

    // Check if already exists
    const existing = existingWebhooks.find(
      w => w.topic === webhook.topic &&
           w.endpoint?.callbackUrl === webhook.endpoint
    );

    if (existing) {
      console.log(`   ⏭️  Already registered (ID: ${existing.id})`);
    } else {
      // Check if different URL exists for same topic
      const oldWebhook = existingWebhooks.find(w => w.topic === webhook.topic);

      if (oldWebhook) {
        console.log(`   🗑️  Deleting old webhook with different URL...`);
        console.log(`      Old: ${oldWebhook.endpoint?.callbackUrl}`);
        await deleteWebhook(oldWebhook.id);
      }

      try {
        const registered = await registerWebhook(webhook);
        console.log(`   ✅ Registered successfully (ID: ${registered.id})`);
      } catch (error) {
        console.log(`   ❌ Failed: ${error.message}`);
      }
    }

    console.log('');
  }

  console.log('✨ Webhook registration complete!\n');
  console.log('Next steps:');
  console.log('1. Verify webhooks in Shopify Admin → Settings → Notifications');
  console.log('2. Test webhooks with test orders');
  console.log('3. Monitor webhook logs in Railway\n');
}

// Run script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
