import express from 'express';
import FotoboxInventoryManager from '../services/inventoryManager.js';

const router = express.Router();
const inventoryManager = new FotoboxInventoryManager();

/**
 * GET /api/inventory/:variantId
 *
 * Holt Inventar-Informationen für eine Variante
 *
 * Response:
 * {
 *   "success": true,
 *   "variantId": "gid://shopify/ProductVariant/123",
 *   "totalInventory": 5,
 *   "productInfo": {
 *     "title": "Premium Fotobox - Schwarz"
 *   }
 * }
 */
router.get('/:variantId', async (req, res) => {
  try {
    const { variantId } = req.params;

    const totalInventory = await inventoryManager.getTotalInventory(variantId);
    const bookings = await inventoryManager.getBookingsForVariant(variantId);

    // Produktinformationen abrufen
    const productInfo = await getProductInfo(variantId);

    // Aktive Buchungen zählen
    const activeBookings = bookings.filter(
      b => b.status === 'confirmed' || b.status === 'reserved'
    );

    res.json({
      success: true,
      variantId,
      totalInventory,
      activeBookings: activeBookings.length,
      totalBookings: bookings.length,
      productInfo,
    });
  } catch (error) {
    console.error('Error in inventory route:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get inventory',
      message: error.message,
    });
  }
});

/**
 * GET /api/inventory/:variantId/bookings
 *
 * Holt alle Buchungen für eine Variante
 *
 * Query Parameters:
 * - status: Filter nach Status (optional)
 *
 * Response:
 * {
 *   "success": true,
 *   "bookings": [...]
 * }
 */
router.get('/:variantId/bookings', async (req, res) => {
  try {
    const { variantId } = req.params;
    const { status } = req.query;

    let bookings = await inventoryManager.getBookingsForVariant(variantId);

    // Filter nach Status wenn angegeben
    if (status) {
      bookings = bookings.filter(b => b.status === status);
    }

    // Sortiere nach eventDate
    bookings.sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));

    res.json({
      success: true,
      count: bookings.length,
      bookings,
    });
  } catch (error) {
    console.error('Error in get bookings route:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get bookings',
      message: error.message,
    });
  }
});

/**
 * Hilfsfunktion: Holt Produktinformationen
 */
async function getProductInfo(variantId) {
  try {
    const query = `
      query getProductVariant($id: ID!) {
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
    const response = await inventoryManager.shopify.graphql(query, variables);

    const variant = response.productVariant;
    return {
      title: `${variant.product.title} - ${variant.title}`,
      productTitle: variant.product.title,
      variantTitle: variant.title,
      price: variant.price,
      inventoryQuantity: variant.inventoryQuantity,
    };
  } catch (error) {
    console.error('Error getting product info:', error);
    return { title: 'Unknown Product' };
  }
}

export default router;
