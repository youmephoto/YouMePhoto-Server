import express from 'express';
import OrderService from '../services/orderService.js';
import { requireJwtAuth } from '../middleware/jwtAuth.js';

const router = express.Router();
const orderService = new OrderService();

/**
 * GET /api/admin/orders
 * Get all orders with customer info
 */
router.get('/', requireJwtAuth, async (req, res) => {
  try {
    const { status, customer, limit, offset } = req.query;

    const orders = await orderService.getAllOrders({
      status,
      customer,
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0,
    });

    res.json({
      success: true,
      orders,
      total: orders.length,
    });
  } catch (error) {
    console.error('[Orders API] Error fetching orders:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch orders',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/orders/:id
 * Get single order with items and history
 */
router.get('/:id', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const order = await orderService.getOrder(parseInt(id));

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
      });
    }

    res.json({
      success: true,
      order,
    });
  } catch (error) {
    console.error('[Orders API] Error fetching order:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch order',
      message: error.message,
    });
  }
});

// REMOVED: Old cancel endpoint - replaced with correct implementation below that uses cancelOrderInShopify

/**
 * GET /api/admin/orders/:id/history
 * Get order status history
 */
router.get('/:id/history', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const order = await orderService.getOrder(parseInt(id));

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
      });
    }

    res.json({
      success: true,
      history: order.history,
    });
  } catch (error) {
    console.error('[Orders API] Error fetching order history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch order history',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/admin/orders/:id
 * Delete cancelled order from database
 * NOTE: Only cancelled orders can be deleted
 */
router.delete('/:id', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`[Orders API] Delete request for order: ${id}`);

    const order = await orderService.getOrder(parseInt(id));
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    // Only allow deleting cancelled orders
    if (order.status !== 'cancelled' && order.financial_status !== 'refunded') {
      return res.status(400).json({
        success: false,
        error: 'Can only delete cancelled orders'
      });
    }

    // Delete order (OrderService has deleteOrder method)
    const result = await orderService.deleteOrder(parseInt(id));

    if (result.success) {
      res.json({
        success: true,
        message: 'Order deleted successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.message
      });
    }
  } catch (error) {
    console.error('[Orders API] Error deleting order:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete order',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/orders/:id/cancel
 * Cancel an order in Shopify (triggers webhook to cancel bookings)
 */
router.post('/:id/cancel', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    console.log(`[Orders API] Cancel request for order: ${id}`);

    const order = await orderService.getOrder(parseInt(id));
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    // Cancel order via Shopify API
    const result = await orderService.cancelOrderInShopify(order.shopify_order_id, reason);

    if (result.success) {
      console.log(`[Orders API] Order cancelled in Shopify: ${id}`);

      // Update local database immediately (don't wait for webhook)
      await orderService.updateOrderStatus(
        order.shopify_order_id,
        'cancelled',
        'refunded',
        'cancelled'
      );

      res.json({
        success: true,
        message: 'Order cancelled successfully. Bookings will be released automatically.'
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Failed to cancel order in Shopify'
      });
    }
  } catch (error) {
    console.error('[Orders API] Error cancelling order:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel order',
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/orders/:id/refund
 * Create a refund for an order in Shopify
 *
 * Body: {
 *   amount: number,  // Optional: total refund amount (if not provided, refunds all)
 *   reason: string,  // Optional: reason for refund
 *   lineItems: [     // Optional: specific line items to refund
 *     { lineItemId: string, quantity: number }
 *   ]
 * }
 */
router.post('/:id/refund', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, reason, lineItems } = req.body;

    console.log(`[Orders API] Refund request for order: ${id}`);

    const order = await orderService.getOrder(parseInt(id));
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    // Create refund via Shopify API
    const result = await orderService.createRefundInShopify(order.shopify_order_id, {
      amount,
      reason,
      lineItems
    });

    if (result.success) {
      console.log(`[Orders API] Refund created in Shopify: ${id}`);

      // Update local database immediately (don't wait for webhook)
      await orderService.updateOrderStatus(
        order.shopify_order_id,
        'cancelled',
        'refunded',
        'cancelled'
      );

      res.json({
        success: true,
        message: 'Refund created successfully. Bookings will be cancelled automatically.',
        refund: result.refund
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Failed to create refund in Shopify'
      });
    }
  } catch (error) {
    console.error('[Orders API] Error creating refund:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create refund',
      message: error.message,
    });
  }
});

export default router;
