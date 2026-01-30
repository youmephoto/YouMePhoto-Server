import express from 'express';
import CustomerService from '../services/customerService.js';
import { requireJwtAuth } from '../middleware/jwtAuth.js';

const router = express.Router();
const customerService = new CustomerService();

/**
 * GET /api/admin/customers
 * Get all customers with optional filtering
 */
router.get('/', requireJwtAuth, async (req, res) => {
  try {
    const { search, tags, limit, offset } = req.query;

    const customers = await customerService.getAllCustomers({
      search,
      tags: tags ? tags.split(',') : [],
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0,
    });

    res.json({
      success: true,
      customers,
      total: customers.length,
    });
  } catch (error) {
    console.error('[Customers API] Error fetching customers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customers',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/customers/:id
 * Get single customer with details
 */
router.get('/:id', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const customer = await customerService.getCustomer(parseInt(id));

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found',
      });
    }

    res.json({
      success: true,
      customer,
    });
  } catch (error) {
    console.error('[Customers API] Error fetching customer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customer',
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/customers
 * Create new customer
 */
router.post('/', requireJwtAuth, async (req, res) => {
  try {
    const customerData = req.body;

    const customer = await customerService.createCustomer(customerData);

    res.json({
      success: true,
      customer,
      message: 'Customer created successfully',
    });
  } catch (error) {
    console.error('[Customers API] Error creating customer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create customer',
      message: error.message,
    });
  }
});

/**
 * PUT /api/admin/customers/:id
 * Update customer
 */
router.put('/:id', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const customer = await customerService.updateCustomer(parseInt(id), updates);

    res.json({
      success: true,
      customer,
      message: 'Customer updated successfully',
    });
  } catch (error) {
    console.error('[Customers API] Error updating customer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update customer',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/admin/customers/:id
 * Delete customer
 */
router.delete('/:id', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;

    await customerService.deleteCustomer(parseInt(id));

    res.json({
      success: true,
      message: 'Customer deleted successfully',
    });
  } catch (error) {
    console.error('[Customers API] Error deleting customer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete customer',
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/customers/:id/tags
 * Add tag to customer
 */
router.post('/:id/tags', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { tag } = req.body;

    await customerService.addTag(parseInt(id), tag);

    res.json({
      success: true,
      message: 'Tag added successfully',
    });
  } catch (error) {
    console.error('[Customers API] Error adding tag:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add tag',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/admin/customers/:id/tags/:tag
 * Remove tag from customer
 */
router.delete('/:id/tags/:tag', requireJwtAuth, async (req, res) => {
  try {
    const { id, tag } = req.params;

    await customerService.removeTag(parseInt(id), decodeURIComponent(tag));

    res.json({
      success: true,
      message: 'Tag removed successfully',
    });
  } catch (error) {
    console.error('[Customers API] Error removing tag:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove tag',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/customers/:id/notes
 * Get customer notes
 */
router.get('/:id/notes', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const notes = await customerService.getNotes(parseInt(id));

    res.json({
      success: true,
      notes,
    });
  } catch (error) {
    console.error('[Customers API] Error fetching notes:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notes',
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/customers/:id/notes
 * Add note to customer
 */
router.post('/:id/notes', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    // TODO: Get actual username from auth
    const author = 'admin';

    await customerService.addNote(parseInt(id), author, content);

    res.json({
      success: true,
      message: 'Note added successfully',
    });
  } catch (error) {
    console.error('[Customers API] Error adding note:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add note',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/admin/customers/:id/notes/:noteId
 * Delete customer note
 */
router.delete('/:id/notes/:noteId', requireJwtAuth, async (req, res) => {
  try {
    const { noteId } = req.params;
    await customerService.deleteNote(parseInt(noteId));

    res.json({
      success: true,
      message: 'Note deleted successfully',
    });
  } catch (error) {
    console.error('[Customers API] Error deleting note:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete note',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/customers/:id/orders
 * Get customer's orders
 */
router.get('/:id/orders', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Import OrderService here to avoid circular dependencies
    const OrderService = (await import('../services/orderService.js')).default;
    const orderService = new OrderService();

    const orders = await orderService.getCustomerOrders(parseInt(id));

    res.json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error('[Customers API] Error fetching customer orders:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customer orders',
      message: error.message,
    });
  }
});

export default router;
