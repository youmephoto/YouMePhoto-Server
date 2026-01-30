import { shopifyApi, LATEST_API_VERSION } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Shopify API Configuration
 *
 * Initialisiert die Shopify API mit den erforderlichen Credentials
 */

const shopifyConfig = {
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: [
    'read_products',
    'write_products',
    'read_orders',
    'write_orders',
    'read_inventory',
    'write_inventory',
    'read_discounts',
    'write_discounts',
  ],
  hostName: process.env.SHOPIFY_HOST_NAME || 'localhost:3000',
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: false,
};

const shopify = shopifyApi(shopifyConfig);

/**
 * GraphQL Client Wrapper
 *
 * Vereinfacht GraphQL-Anfragen an Shopify
 */
class ShopifyGraphQLClient {
  constructor() {
    this.accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
    this.shop = process.env.SHOPIFY_STORE_URL;

    if (!this.accessToken || !this.shop) {
      throw new Error(
        'SHOPIFY_ACCESS_TOKEN and SHOPIFY_STORE_URL must be set in environment variables'
      );
    }

    this.client = new shopify.clients.Graphql({
      session: {
        shop: this.shop,
        accessToken: this.accessToken,
      },
    });
  }

  /**
   * Führt eine GraphQL Query oder Mutation aus
   *
   * @param {string} query - GraphQL Query/Mutation String
   * @param {object} variables - Query Variables
   * @returns {Promise<object>} GraphQL Response Data
   */
  async graphql(query, variables = {}) {
    try {
      console.log(`Shopify GraphQL: querying shop=${this.shop} apiVersion=${LATEST_API_VERSION}`);

      // Use the new request method instead of deprecated query method
      const response = await this.client.request(query, { variables });

      if (response.errors) {
        console.error('GraphQL Errors:', response.errors);
        throw new Error(response.errors[0].message);
      }

      if (!response.data) {
        throw new Error('No data returned from Shopify GraphQL');
      }

      return response.data;
    } catch (error) {
      console.error('Shopify GraphQL Error:', error);
      throw error;
    }
  }

  /**
   * Holt Produkt-Details
   *
   * @param {string} productId - Product GID
   * @returns {Promise<object>} Produkt-Daten
   */
  async getProduct(productId) {
    const query = `
      query getProduct($id: ID!) {
        product(id: $id) {
          id
          title
          description
          variants(first: 100) {
            nodes {
              id
              title
              inventoryQuantity
              price
            }
          }
          metafields(first: 10) {
            nodes {
              namespace
              key
              value
            }
          }
        }
      }
    `;

    const variables = { id: productId };
    const data = await this.graphql(query, variables);
    return data.product;
  }

  /**
   * Holt Varianten-Details
   *
   * @param {string} variantId - ProductVariant GID
   * @returns {Promise<object>} Varianten-Daten
   */
  async getVariant(variantId) {
    const query = `
      query getVariant($id: ID!) {
        productVariant(id: $id) {
          id
          title
          inventoryQuantity
          price
          product {
            id
            title
          }
        }
      }
    `;

    const variables = { id: variantId };
    const data = await this.graphql(query, variables);
    return data.productVariant;
  }

  /**
   * Erstellt oder aktualisiert ein Metafield
   *
   * @param {string} ownerId - Owner GID (Product, Variant, etc.)
   * @param {string} namespace - Metafield Namespace
   * @param {string} key - Metafield Key
   * @param {any} value - Metafield Value
   * @param {string} type - Metafield Type
   * @returns {Promise<object>} Metafield Daten
   */
  async setMetafield(ownerId, namespace, key, value, type = 'json') {
    const mutation = `
      mutation createMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
            value
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      metafields: [
        {
          namespace,
          key,
          type,
          value: typeof value === 'string' ? value : JSON.stringify(value),
          ownerId,
        },
      ],
    };

    const data = await this.graphql(mutation, variables);

    if (data.metafieldsSet.userErrors?.length > 0) {
      throw new Error(data.metafieldsSet.userErrors[0].message);
    }

    return data.metafieldsSet.metafields[0];
  }

  /**
   * Holt ein Metafield
   *
   * @param {string} ownerId - Owner GID
   * @param {string} namespace - Metafield Namespace
   * @param {string} key - Metafield Key
   * @returns {Promise<object|null>} Metafield Daten
   */
  async getMetafield(ownerId, namespace, key) {
    const query = `
      query getMetafield($id: ID!, $namespace: String!, $key: String!) {
        node(id: $id) {
          ... on Product {
            metafield(namespace: $namespace, key: $key) {
              id
              namespace
              key
              value
              type
            }
          }
        }
      }
    `;

    const variables = { id: ownerId, namespace, key };
    const data = await this.graphql(query, variables);
    return data.node?.metafield || null;
  }

  /**
   * DISCOUNT CODE METHODS
   */

  /**
   * Erstellt einen Percentage oder Fixed Amount Discount Code
   *
   * @param {object} discountData - Discount configuration
   * @returns {Promise<object>} Created discount node
   */
  async createBasicDiscount(discountData) {
    const mutation = `
      mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode {
            id
            codeDiscount {
              ... on DiscountCodeBasic {
                title
                codes(first: 1) {
                  nodes {
                    code
                  }
                }
                startsAt
                endsAt
                usageLimit
                appliesOncePerCustomer
                customerGets {
                  value {
                    ... on DiscountPercentage {
                      percentage
                    }
                    ... on DiscountAmount {
                      amount {
                        amount
                      }
                    }
                  }
                  items {
                    ... on AllDiscountItems {
                      allItems
                    }
                    ... on DiscountProducts {
                      productVariants(first: 250) {
                        nodes {
                          id
                        }
                      }
                    }
                  }
                }
                minimumRequirement {
                  ... on DiscountMinimumSubtotal {
                    greaterThanOrEqualToSubtotal {
                      amount
                    }
                  }
                }
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

    const variables = { basicCodeDiscount: discountData };
    const data = await this.graphql(mutation, variables);

    if (data.discountCodeBasicCreate.userErrors?.length > 0) {
      throw new Error(data.discountCodeBasicCreate.userErrors[0].message);
    }

    return data.discountCodeBasicCreate.codeDiscountNode;
  }

  /**
   * Erstellt einen Free Shipping Discount Code
   *
   * @param {object} discountData - Free shipping discount configuration
   * @returns {Promise<object>} Created discount node
   */
  async createFreeShippingDiscount(discountData) {
    const mutation = `
      mutation discountCodeFreeShippingCreate($freeShippingCodeDiscount: DiscountCodeFreeShippingInput!) {
        discountCodeFreeShippingCreate(freeShippingCodeDiscount: $freeShippingCodeDiscount) {
          codeDiscountNode {
            id
            codeDiscount {
              ... on DiscountCodeFreeShipping {
                title
                codes(first: 1) {
                  nodes {
                    code
                  }
                }
                startsAt
                endsAt
                usageLimit
                appliesOncePerCustomer
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

    const variables = { freeShippingCodeDiscount: discountData };
    const data = await this.graphql(mutation, variables);

    if (data.discountCodeFreeShippingCreate.userErrors?.length > 0) {
      throw new Error(data.discountCodeFreeShippingCreate.userErrors[0].message);
    }

    return data.discountCodeFreeShippingCreate.codeDiscountNode;
  }

  /**
   * Aktualisiert einen Discount Code
   *
   * @param {string} discountId - Discount Node GID
   * @param {object} discountData - Updated discount configuration
   * @returns {Promise<object>} Updated discount node
   */
  async updateDiscount(discountId, discountData) {
    const mutation = `
      mutation discountCodeBasicUpdate($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      id: discountId,
      basicCodeDiscount: discountData,
    };

    const data = await this.graphql(mutation, variables);

    if (data.discountCodeBasicUpdate.userErrors?.length > 0) {
      throw new Error(data.discountCodeBasicUpdate.userErrors[0].message);
    }

    return data.discountCodeBasicUpdate.codeDiscountNode;
  }

  /**
   * Löscht einen Discount Code
   *
   * @param {string} discountId - Discount Node GID
   * @returns {Promise<boolean>} Success status
   */
  async deleteDiscount(discountId) {
    const mutation = `
      mutation discountCodeDelete($id: ID!) {
        discountCodeDelete(id: $id) {
          deletedCodeDiscountId
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = { id: discountId };
    const data = await this.graphql(mutation, variables);

    if (data.discountCodeDelete.userErrors?.length > 0) {
      throw new Error(data.discountCodeDelete.userErrors[0].message);
    }

    return true;
  }

  /**
   * Holt alle Discount Codes (für Sync)
   *
   * @param {number} limit - Maximum number of codes to fetch
   * @returns {Promise<Array>} Array of discount codes
   */
  async getAllDiscountCodes(limit = 250) {
    const query = `
      query codeDiscountNodes($first: Int!) {
        codeDiscountNodes(first: $first) {
          nodes {
            id
            codeDiscount {
              ... on DiscountCodeBasic {
                title
                codes(first: 1) {
                  nodes {
                    code
                  }
                }
                startsAt
                endsAt
                status
                usageLimit
                appliesOncePerCustomer
                asyncUsageCount
                customerGets {
                  value {
                    ... on DiscountPercentage {
                      percentage
                    }
                    ... on DiscountAmount {
                      amount {
                        amount
                      }
                    }
                  }
                  items {
                    ... on AllDiscountItems {
                      allItems
                    }
                    ... on DiscountProducts {
                      productVariants(first: 250) {
                        nodes {
                          id
                        }
                      }
                    }
                  }
                }
                minimumRequirement {
                  ... on DiscountMinimumSubtotal {
                    greaterThanOrEqualToSubtotal {
                      amount
                    }
                  }
                }
              }
              ... on DiscountCodeFreeShipping {
                title
                codes(first: 1) {
                  nodes {
                    code
                  }
                }
                startsAt
                endsAt
                status
                usageLimit
                appliesOncePerCustomer
                asyncUsageCount
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const variables = { first: limit };
    const data = await this.graphql(query, variables);

    return data.codeDiscountNodes.nodes;
  }

  /**
   * Holt einen spezifischen Discount Code
   *
   * @param {string} discountId - Discount Node GID
   * @returns {Promise<object>} Discount code data
   */
  async getDiscountCode(discountId) {
    const query = `
      query codeDiscountNode($id: ID!) {
        codeDiscountNode(id: $id) {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              title
              codes(first: 1) {
                nodes {
                  code
                }
              }
              startsAt
              endsAt
              status
              usageLimit
              appliesOncePerCustomer
              asyncUsageCount
              customerGets {
                value {
                  ... on DiscountPercentage {
                    percentage
                  }
                  ... on DiscountAmount {
                    amount {
                      amount
                    }
                  }
                }
              }
            }
            ... on DiscountCodeFreeShipping {
              title
              codes(first: 1) {
                nodes {
                  code
                }
              }
              startsAt
              endsAt
              status
              usageLimit
              appliesOncePerCustomer
              asyncUsageCount
            }
          }
        }
      }
    `;

    const variables = { id: discountId };
    const data = await this.graphql(query, variables);

    return data.codeDiscountNode;
  }

  /**
   * GraphQL mit Retry Logic (für Rate Limits)
   *
   * @param {string} query - GraphQL query/mutation
   * @param {object} variables - Query variables
   * @param {number} retries - Number of retries
   * @returns {Promise<object>} GraphQL response
   */
  async graphqlWithRetry(query, variables = {}, retries = 3) {
    try {
      return await this.graphql(query, variables);
    } catch (error) {
      if (error.message.includes('Throttled') && retries > 0) {
        const delay = 1000 * (4 - retries); // 1s, 2s, 3s
        console.log(`[Shopify] Rate limited, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.graphqlWithRetry(query, variables, retries - 1);
      }
      throw error;
    }
  }
}

const shopifyClient = new ShopifyGraphQLClient();

export { shopify, shopifyClient };
export default shopifyClient;
