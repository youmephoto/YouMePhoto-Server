import { v4 as uuidv4 } from 'uuid';
import {
  customerQueries,
  customerTagQueries,
  customerNoteQueries,
  transaction,
} from '../db/database.js';

/**
 * CustomerService
 *
 * Handles all customer-related operations
 */
class CustomerService {
  /**
   * Get all customers with optional filters
   */
  async getAllCustomers(filters = {}) {
    const { search, tags, limit = 100, offset = 0 } = filters;

    // TODO: Implement search and tags filtering
    // For now, return all
    const customers = await customerQueries.getAll();

    // Get tags for each customer
    const customersWithTags = [];
    for (const customer of customers) {
      const tags = await customerTagQueries.getByCustomer(customer.id);
      customersWithTags.push({
        ...customer,
        tags: tags.map(t => t.tag),
      });
    }

    return customersWithTags;
  }

  /**
   * Get customer by ID
   */
  async getCustomer(id) {
    const customer = await customerQueries.getById(id);

    if (!customer) {
      return null;
    }

    // Get tags and notes
    const tags = await customerTagQueries.getByCustomer(id);
    const notes = await customerNoteQueries.getByCustomer(id);

    return {
      ...customer,
      tags: tags.map(t => t.tag),
      notes,
    };
  }

  /**
   * Get customer by email (or create if doesn't exist)
   */
  async getOrCreateCustomer(email, additionalData = {}) {
    let customer = await customerQueries.getByEmail(email);

    if (!customer) {
      // Create new customer
      const customerId = uuidv4();
      const {
        firstName = '',
        lastName = '',
        phone = null,
        shopifyCustomerId = null,
      } = additionalData;

      const result = await customerQueries.create(
        customerId,
        firstName,
        lastName,
        email,
        phone,
        null, // street - stored in orders table
        null, // postal_code - stored in orders table
        null, // city - stored in orders table
        'DE', // country - stored in orders table
        shopifyCustomerId
      );

      // Get customer by the autoincrement ID
      const customerId_db = result?.id;
      customer = await customerQueries.getById(customerId_db);
    }

    return customer;
  }

  /**
   * Create new customer
   */
  async createCustomer(customerData) {
    const {
      firstName,
      lastName,
      email,
      phone = null,
      street = null,
      postalCode = null,
      city = null,
      country = 'DE',
      shopifyCustomerId = null,
      tags = [],
    } = customerData;

    const customerId = uuidv4();

    const createTransaction = transaction(async () => {
      // Create customer
      await customerQueries.create(
        customerId,
        firstName,
        lastName,
        email,
        phone,
        street,
        postalCode,
        city,
        country,
        shopifyCustomerId
      );

      // Get the created customer
      const customer = await customerQueries.getByCustomerId(customerId);

      // Add tags if provided
      if (tags.length > 0) {
        for (const tag of tags) {
          await customerTagQueries.add(customer.id, tag);
        }
      }

      return customer;
    });

    return await createTransaction();
  }

  /**
   * Update customer
   */
  async updateCustomer(id, updates) {
    // Get current customer data
    const currentCustomer = await customerQueries.getById(id);

    if (!currentCustomer) {
      throw new Error('Customer not found');
    }

    // Merge updates with current data (only update provided fields)
    const {
      firstName = currentCustomer.first_name,
      lastName = currentCustomer.last_name,
      email = currentCustomer.email,
      phone = currentCustomer.phone,
      street = currentCustomer.street,
      postalCode = currentCustomer.postal_code,
      city = currentCustomer.city,
      country = currentCustomer.country,
    } = updates;

    await customerQueries.update(
      firstName,
      lastName,
      email,
      phone,
      street,
      postalCode,
      city,
      country,
      id
    );

    return await this.getCustomer(id);
  }

  /**
   * Delete customer
   */
  async deleteCustomer(id) {
    await customerQueries.delete(id);
    return { success: true };
  }

  /**
   * Add tag to customer
   */
  async addTag(customerId, tag) {
    await customerTagQueries.add(customerId, tag);
    return { success: true };
  }

  /**
   * Remove tag from customer
   */
  async removeTag(customerId, tag) {
    await customerTagQueries.remove(customerId, tag);
    return { success: true };
  }

  /**
   * Get notes for customer
   */
  async getNotes(customerId) {
    return await customerNoteQueries.getByCustomer(customerId);
  }

  /**
   * Add note to customer
   */
  async addNote(customerId, author, noteText) {
    await customerNoteQueries.add(customerId, author, noteText);
    return { success: true };
  }

  /**
   * Delete note
   */
  async deleteNote(noteId) {
    await customerNoteQueries.delete(noteId);
    return { success: true };
  }

  /**
   * Increment customer's order count and revenue
   * Called when an order is created
   */
  async incrementOrderStats(customerId, orderAmount) {
    await customerQueries.incrementOrders(orderAmount, customerId);
    return { success: true };
  }
}

export default CustomerService;
