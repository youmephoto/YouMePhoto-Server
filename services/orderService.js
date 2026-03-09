import {
  orderQueries,
  orderItemQueries,
  orderStatusHistoryQueries,
  customerQueries,
  transaction,
} from '../db/database.js';
import CustomerService from './customerService.js';
import BookingService from './bookingService.js';
import shopifyClient from '../config/shopify.js';

const customerService = new CustomerService();
const bookingService = new BookingService();

/**
 * OrderService
 *
 * Handles order management and Shopify synchronization
 */
class OrderService {
  /**
   * Get all orders with customer info
   */
  async getAllOrders(filters = {}) {
    // TODO: Implement filtering by status, date, etc.
    return await orderQueries.getAll();
  }

  /**
   * Get order by ID with items and history
   */
  async getOrder(id) {
    const order = await orderQueries.getById(id);

    if (!order) {
      return null;
    }

    // Get order items
    const items = await orderItemQueries.getByOrder(id);

    // Get status history
    const history = await orderStatusHistoryQueries.getByOrder(id);

    return {
      ...order,
      items,
      history,
    };
  }

  /**
   * Get order by Shopify Order ID
   */
  async getOrderByShopifyId(shopifyOrderId) {
    return await orderQueries.getByShopifyOrderId(shopifyOrderId);
  }

  /**
   * Create order from Shopify webhook data
   *
   * @param {object} shopifyOrder - Shopify order object from webhook
   */
  async createOrderFromShopify(shopifyOrder) {
    console.log('[OrderService] Creating order from Shopify:', shopifyOrder.name);

    // 1. Get or create customer (OUTSIDE transaction, because it's async)
    const customerData = shopifyOrder.customer || {};
    const shippingAddress = shopifyOrder.shipping_address || {};
    const customerEmail = customerData.email || shopifyOrder.email || shopifyOrder.contact_email;
    console.log('[OrderService] Getting/creating customer:', customerEmail);
    console.log('[OrderService] Shipping address:', JSON.stringify(shippingAddress, null, 2));

    const customer = await customerService.getOrCreateCustomer(
      customerEmail,
      {
        firstName: customerData.first_name || '',
        lastName: customerData.last_name || '',
        phone: customerData.phone || shippingAddress.phone || null,
        shopifyCustomerId: customerData.id ? `gid://shopify/Customer/${customerData.id}` : null,
        // Address will be stored in orders table, not customer table
      }
    );

    console.log('[OrderService] Customer ID:', customer.id);

    // 2. Create order (without transaction for now, to debug)
    try {
      console.log('[OrderService] Inserting order into database...');

      // Extract billing address
      const billingAddress = shopifyOrder.billing_address || {};

      const orderResult = await orderQueries.create(
        shopifyOrder.name, // order_id (e.g. "#1234")
        customer.id, // customer_id
        shopifyOrder.admin_graphql_api_id, // shopify_order_id
        shopifyOrder.order_number, // shopify_order_number
        shopifyOrder.financial_status || 'pending', // status
        shopifyOrder.financial_status, // financial_status
        shopifyOrder.fulfillment_status || 'unfulfilled', // fulfillment_status
        parseFloat(shopifyOrder.total_price), // total_amount
        shopifyOrder.currency || 'EUR', // currency
        shopifyOrder.created_at, // shopify_created_at
        // Shipping address
        shippingAddress.name || null,
        shippingAddress.address1 || null,
        shippingAddress.address2 || null,
        shippingAddress.city || null,
        shippingAddress.province || null,
        shippingAddress.country || null,
        shippingAddress.zip || null,
        shippingAddress.phone || null,
        // Billing address
        billingAddress.name || null,
        billingAddress.address1 || null,
        billingAddress.address2 || null,
        billingAddress.city || null,
        billingAddress.province || null,
        billingAddress.country || null,
        billingAddress.zip || null,
        billingAddress.phone || null
      );

      console.log('[OrderService] Order result:', orderResult);
      const orderId = orderResult?.id;
      console.log('[OrderService] Order ID:', orderId);

      if (!orderId) {
        throw new Error('Failed to get order ID from database');
      }

      // Create order items
      console.log('[OrderService] Creating order items...');
      for (const lineItem of shopifyOrder.line_items) {
        // Extract dates from line item properties (if available)
        const properties = lineItem.properties || [];
        const startDateProp = properties.find(p => p.name === 'Start Date' || p.name === 'Event Date');
        const endDateProp = properties.find(p => p.name === 'End Date');
        const totalDaysProp = properties.find(p => p.name === 'Total Days');

        const startDate = startDateProp?.value || new Date().toISOString().split('T')[0];
        const endDate = endDateProp?.value || startDate;
        const totalDays = totalDaysProp?.value ? parseInt(totalDaysProp.value) : 1;

        await orderItemQueries.create(
          orderId, // order_id
          `gid://shopify/ProductVariant/${lineItem.variant_id}`, // variant_gid
          lineItem.title, // product_title
          lineItem.variant_title || 'Default', // variant_title
          startDate, // start_date
          endDate, // end_date
          totalDays, // total_days
          parseFloat(lineItem.price), // unit_price
          lineItem.quantity, // quantity
          parseFloat(lineItem.price) * lineItem.quantity, // total_price
          null // booking_id (will be linked later)
        );
      }

      // Add initial status history
      console.log('[OrderService] Creating status history...');
      await orderStatusHistoryQueries.add(
        orderId,
        null, // from_status
        shopifyOrder.financial_status || 'pending', // to_status
        'system', // changed_by
        'Order created from Shopify' // note
      );

      // Update customer stats
      console.log('[OrderService] Updating customer stats...');
      await customerService.incrementOrderStats(customer.id, parseFloat(shopifyOrder.total_price));

      console.log('[OrderService] ✓ Order created successfully:', shopifyOrder.name);

      return orderId;
    } catch (error) {
      console.error('[OrderService] ERROR creating order:', error.message);
      console.error('[OrderService] ERROR stack:', error.stack);
      throw error;
    }
  }

  /**
   * Update order status from Shopify webhook
   */
  async updateOrderStatus(shopifyOrderId, newStatus, financialStatus, fulfillmentStatus) {
    const order = await this.getOrderByShopifyId(shopifyOrderId);

    if (!order) {
      console.warn('[OrderService] Order not found for Shopify ID:', shopifyOrderId);
      return { success: false, message: 'Order not found' };
    }

    const oldStatus = order.status;

    // Update order
    await orderQueries.updateStatus(
      newStatus,
      financialStatus,
      fulfillmentStatus,
      order.id
    );

    // Add status history
    await orderStatusHistoryQueries.add(
      order.id,
      oldStatus,
      newStatus,
      'system',
      'Updated from Shopify webhook'
    );

    console.log('[OrderService] ✓ Order status updated:', order.order_id, oldStatus, '→', newStatus);

    // If order is cancelled or refunded, cancel all associated bookings
    if ((newStatus === 'cancelled' || financialStatus === 'refunded') && oldStatus !== 'cancelled') {
      console.log('[OrderService] Order cancelled/refunded - cancelling associated bookings...');
      await this.cancelOrderBookings(shopifyOrderId, 'Order cancelled/refunded');
    }

    return { success: true };
  }

  // REMOVED: Old cancelOrder method - use cancelOrderInShopify instead

  /**
   * Cancel all bookings associated with an order
   * Called when order is cancelled or refunded
   *
   * @param {string} shopifyOrderId - Shopify Order ID (GID)
   * @param {string} reason - Cancellation reason
   */
  async cancelOrderBookings(shopifyOrderId, reason) {
    try {
      // Get all bookings for this order
      const bookings = await bookingService.inventoryManager.getAllBookings();
      const orderBookings = bookings.filter(b => b.orderId === shopifyOrderId || b.order_id === shopifyOrderId);

      console.log(`[OrderService] Found ${orderBookings.length} bookings for order ${shopifyOrderId}`);

      // Cancel each booking
      for (const booking of orderBookings) {
        console.log(`[OrderService] Cancelling booking ${booking.bookingId}...`);
        await bookingService.cancelBooking(booking.bookingId, reason);
        console.log(`[OrderService] ✓ Booking ${booking.bookingId} cancelled and inventory released`);
      }

      return { success: true, cancelledCount: orderBookings.length };
    } catch (error) {
      console.error('[OrderService] Error cancelling order bookings:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get orders for a specific customer
   */
  async getCustomerOrders(customerId) {
    return await orderQueries.getByCustomer(customerId);
  }

  /**
   * Delete cancelled order from database
   * CAUTION: Only use for cancelled orders
   *
   * @param {number} orderId - Internal order ID
   * @returns {Promise<object>} Success status
   */
  async deleteOrder(orderId) {
    const order = await this.getOrder(orderId);

    if (!order) {
      return { success: false, message: 'Order not found' };
    }

    // Safety check: Only delete cancelled orders
    if (order.status !== 'cancelled' && order.financial_status !== 'refunded') {
      return { success: false, message: 'Can only delete cancelled orders' };
    }

    try {
      // First, delete all associated bookings to free up inventory
      console.log('[OrderService] Deleting bookings for order:', order.shopify_order_id);
      await this.cancelOrderBookings(order.shopify_order_id, 'Order deleted');

      // Delete order (CASCADE will delete related items and history)
      await orderQueries.delete(orderId);

      // Decrement customer order count and revenue
      await customerQueries.decrementOrders(
        order.total_amount,
        order.total_amount,
        order.customer_id
      );

      console.log('[OrderService] ✓ Cancelled order and bookings deleted:', order.order_id);
      console.log('[OrderService] ✓ Customer stats decremented for customer:', order.customer_id);

      return { success: true };
    } catch (error) {
      console.error('[OrderService] Error deleting order:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Cancel an order in Shopify
   * This will trigger the orders/cancelled webhook which will cancel bookings
   *
   * @param {string} shopifyOrderId - Shopify Order GID (e.g., "gid://shopify/Order/123")
   * @param {string} reason - Cancellation reason
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async cancelOrderInShopify(shopifyOrderId, reason = 'Customer request') {
    try {
      console.log(`[OrderService] Cancelling order in Shopify: ${shopifyOrderId}`);

      const mutation = `
        mutation orderCancel($orderId: ID!, $reason: OrderCancelReason!, $restock: Boolean!) {
          orderCancel(orderId: $orderId, reason: $reason, restock: $restock) {
            job {
              id
              done
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      // Map reason to Shopify enum
      const reasonMap = {
        'Customer request': 'CUSTOMER',
        'Fraud': 'FRAUD',
        'Inventory': 'INVENTORY',
        'Declined': 'DECLINED',
        'Other': 'OTHER'
      };

      const variables = {
        orderId: shopifyOrderId,
        reason: reasonMap[reason] || 'OTHER',
        restock: true  // Restock inventory when cancelling
      };

      console.log('[OrderService] DEBUG - Cancel mutation variables:', variables);

      const response = await shopifyClient.graphql(mutation, variables);

      console.log('[OrderService] DEBUG - Cancel response:', JSON.stringify(response, null, 2));

      if (response.orderCancel.userErrors.length > 0) {
        const errorMessages = response.orderCancel.userErrors.map(e => e.message).join(', ');
        console.error('[OrderService] Shopify cancel error:', errorMessages);
        return {
          success: false,
          error: errorMessages
        };
      }

      console.log('[OrderService] ✓ Order cancelled in Shopify:', shopifyOrderId);
      console.log('   Webhook will trigger to cancel bookings and release inventory');

      return { success: true };
    } catch (error) {
      console.error('[OrderService] Error cancelling order in Shopify:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create a refund in Shopify
   * This will trigger the refunds/create webhook which will cancel bookings
   *
   * @param {string} shopifyOrderId - Shopify Order GID
   * @param {object} refundData - Refund details
   * @param {number} refundData.amount - Total refund amount (optional)
   * @param {string} refundData.reason - Refund reason (optional)
   * @param {Array} refundData.lineItems - Line items to refund (optional)
   * @returns {Promise<{success: boolean, refund?: object, error?: string}>}
   */
  async createRefundInShopify(shopifyOrderId, refundData = {}) {
    try {
      console.log(`[OrderService] Creating refund in Shopify: ${shopifyOrderId}`);

      // First, get order details including existing refunds
      const orderQuery = `
        query getOrder($id: ID!) {
          order(id: $id) {
            id
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            lineItems(first: 10) {
              edges {
                node {
                  id
                  quantity
                  refundableQuantity
                  variant {
                    id
                  }
                }
              }
            }
            refunds {
              refundLineItems(first: 50) {
                edges {
                  node {
                    lineItem {
                      id
                    }
                    quantity
                  }
                }
              }
            }
          }
        }
      `;

      const orderResponse = await shopifyClient.graphql(orderQuery, { id: shopifyOrderId });
      const order = orderResponse.order;

      if (!order) {
        return {
          success: false,
          error: 'Order not found in Shopify'
        };
      }

      console.log('[OrderService] DEBUG - Order data:', {
        orderId: order.id,
        totalLineItems: order.lineItems.edges.length,
        totalRefunds: order.refunds?.length || 0,
        lineItems: order.lineItems.edges.map(e => ({
          id: e.node.id,
          quantity: e.node.quantity,
          refundableQuantity: e.node.refundableQuantity
        })),
        refunds: order.refunds?.map(r => ({
          refundLineItems: r.refundLineItems?.edges?.length || 0
        }))
      });

      // Calculate already refunded quantities
      const refundedQuantities = {};
      if (order.refunds && order.refunds.length > 0) {
        order.refunds.forEach(refund => {
          if (refund.refundLineItems && refund.refundLineItems.edges) {
            refund.refundLineItems.edges.forEach(edge => {
              const lineItemId = edge.node.lineItem.id;
              refundedQuantities[lineItemId] = (refundedQuantities[lineItemId] || 0) + edge.node.quantity;
            });
          }
        });
      }

      // Build refund line items
      let refundLineItems = [];

      if (refundData.lineItems && refundData.lineItems.length > 0) {
        // Refund specific line items
        refundLineItems = refundData.lineItems.map(item => ({
          lineItemId: item.lineItemId,
          quantity: item.quantity
        }));
      } else {
        // Refund all line items (only refundable quantities)
        refundLineItems = order.lineItems.edges
          .map(edge => {
            const lineItemId = edge.node.id;
            const originalQuantity = edge.node.quantity;
            const alreadyRefunded = refundedQuantities[lineItemId] || 0;
            const refundableQuantity = originalQuantity - alreadyRefunded;

            // Only include if there's quantity left to refund
            if (refundableQuantity > 0) {
              return {
                lineItemId: lineItemId,
                quantity: refundableQuantity
              };
            }
            return null;
          })
          .filter(item => item !== null);
      }

      // If nothing to refund, return error
      if (refundLineItems.length === 0) {
        console.log('[OrderService] DEBUG - No refundable items:', {
          refundedQuantities,
          calculatedRefundableItems: order.lineItems.edges.map(e => ({
            lineItemId: e.node.id,
            originalQty: e.node.quantity,
            alreadyRefunded: refundedQuantities[e.node.id] || 0,
            remaining: e.node.quantity - (refundedQuantities[e.node.id] || 0)
          }))
        });
        return {
          success: false,
          error: 'Order is already fully refunded or has no refundable items'
        };
      }

      console.log('[OrderService] DEBUG - Refund line items to create:', refundLineItems);

      // Create refund mutation
      const refundMutation = `
        mutation refundCreate($input: RefundInput!) {
          refundCreate(input: $input) {
            refund {
              id
              totalRefundedSet {
                shopMoney {
                  amount
                  currencyCode
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

      const refundInput = {
        orderId: shopifyOrderId,
        note: refundData.reason || 'Refund created via admin panel',
        refundLineItems: refundLineItems,
        notify: true, // Send refund notification email
      };

      // Add shipping refund if full refund
      if (!refundData.lineItems || refundData.lineItems.length === order.lineItems.edges.length) {
        refundInput.shipping = {
          fullRefund: true
        };
      }

      const refundResponse = await shopifyClient.graphql(refundMutation, { input: refundInput });

      if (refundResponse.refundCreate.userErrors.length > 0) {
        const errorMessages = refundResponse.refundCreate.userErrors.map(e => e.message).join(', ');
        console.error('[OrderService] Shopify refund error:', errorMessages);
        return {
          success: false,
          error: errorMessages
        };
      }

      const refund = refundResponse.refundCreate.refund;
      console.log('[OrderService] ✓ Refund created in Shopify:', refund.id);
      console.log('   Amount:', refund.totalRefundedSet.shopMoney.amount, refund.totalRefundedSet.shopMoney.currencyCode);
      console.log('   Webhook will trigger to cancel bookings and release inventory');

      return {
        success: true,
        refund: refund
      };
    } catch (error) {
      console.error('[OrderService] Error creating refund in Shopify:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default OrderService;
