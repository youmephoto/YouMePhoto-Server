import express from "express";
import FotoboxInventoryManager from "../services/inventoryManager.js";
import { formatDate } from "../utils/dateHelpers.js";
import cache from "../utils/cache.js";

const router = express.Router();
const inventoryManager = new FotoboxInventoryManager();

// Start cache cleanup
cache.startCleanup(60);

/**
 * GET /api/availability
 *
 * Prüft Verfügbarkeit für eine Produktvariante in einem Zeitraum
 *
 * Query Parameters:
 * - variantId: Shopify ProductVariant GID (required)
 * - startDate: Start-Datum im Format YYYY-MM-DD (required)
 * - endDate: End-Datum im Format YYYY-MM-DD (required)
 *
 * Response:
 * {
 *   success: true,
 *   availableDates: ['2024-12-05', '2024-12-06', ...],
 *   totalInventory: 5,
 *   metadata: {
 *     variantId: 'gid://shopify/ProductVariant/123',
 *     productTitle: 'Premium Fotobox - Schwarz'
 *   }
 * }
 */
router.get("/", async (req, res) => {
  try {
    const { variantId, startDate, endDate } = req.query;

    // Validation
    if (!variantId) {
      return res.status(400).json({
        success: false,
        error: "variantId is required",
      });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: "startDate and endDate are required",
      });
    }

    // Datum-Format validieren
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({
        success: false,
        error: "Dates must be in format YYYY-MM-DD",
      });
    }

    console.log(
      `[Availability] Fetching availability for variantId: ${variantId}, from ${startDate} to ${endDate}`
    );

    // PERFORMANCE: Cache product info (changes rarely) but NOT availability (changes with every booking!)
    const productInfoCacheKey = `productInfo:${variantId}`;
    let productInfo = cache.get(productInfoCacheKey);

    if (!productInfo) {
      productInfo = await getProductInfo(variantId);
      cache.set(productInfoCacheKey, productInfo, 300); // 5 minutes - product info rarely changes
    }

    // PERFORMANCE: Parallel ausführen da unabhängig
    console.log('[Availability] Fetching inventory + available dates in parallel...');
    const [totalInventory, availableDates] = await Promise.all([
      inventoryManager.getTotalInventory(variantId),
      inventoryManager.getAvailableDates(variantId, startDate, endDate)
    ]);
    console.log(`[Availability] Found ${availableDates.length} available dates`);

    // Check alternative colors (OPTIMIZED: only 2-3 API calls instead of 180+)
    console.log('[Availability] Calling checkAlternativeColors with:', {
      variantId,
      startDate,
      endDate,
      availableDatesCount: availableDates.length,
      availableDatesFirst5: availableDates.slice(0, 5),
      availableDatesLast5: availableDates.slice(-5),
    });
    const alternativeAvailability = await checkAlternativeColors(
      variantId,
      startDate,
      endDate,
      availableDates
    );

    res.json({
      success: true,
      availableDates,
      totalInventory,
      alternativeAvailability,
      metadata: {
        variantId,
        productTitle: productInfo.title,
        startDate,
        endDate,
      },
    });
  } catch (error) {
    console.error("[Availability] Error in availability route:", error);
    console.error("[Availability] Error stack:", error.stack);
    res.status(500).json({
      success: false,
      error: "Failed to fetch availability",
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

/**
 * GET /api/availability/check
 *
 * Prüft Verfügbarkeit für ein spezifisches Datum
 *
 * Query Parameters:
 * - variantId: Shopify ProductVariant GID (required)
 * - eventDate: Event-Datum im Format YYYY-MM-DD (required)
 *
 * Response:
 * {
 *   success: true,
 *   available: true,
 *   availableCount: 2,
 *   totalInventory: 5,
 *   blockedDates: ['2024-12-13', '2024-12-14', '2024-12-15', '2024-12-16', '2024-12-17']
 * }
 */
router.get("/check", async (req, res) => {
  try {
    const { variantId, eventDate } = req.query;

    // Validation
    if (!variantId || !eventDate) {
      return res.status(400).json({
        success: false,
        error: "variantId and eventDate are required",
      });
    }

    // Datum-Format validieren
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(eventDate)) {
      return res.status(400).json({
        success: false,
        error: "eventDate must be in format YYYY-MM-DD",
      });
    }

    // Verfügbarkeit prüfen
    const result = await inventoryManager.checkAvailability(
      variantId,
      eventDate
    );

    // Geblockte Daten berechnen
    const { calculateBlockedDates } = await import("../utils/dateHelpers.js");
    const blockedDates = calculateBlockedDates(
      eventDate,
      inventoryManager.bufferBefore,
      inventoryManager.bufferAfter
    );

    res.json({
      success: true,
      ...result,
      blockedDates,
      eventDate,
    });
  } catch (error) {
    console.error("Error in availability check route:", error);
    res.status(500).json({
      success: false,
      error: "Failed to check availability",
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
      productId: variant.product.id,
      variantId: variant.id,
    };
  } catch (error) {
    console.error("Error getting product info:", error);
    return { title: "Unknown Product" };
  }
}

/**
 * Prüft alternative Farben für nicht verfügbare Daten (OPTIMIZED VERSION)
 *
 * Holt EINMAL alle Buchungen für alle Varianten und berechnet serverseitig die Verfügbarkeit
 * Statt 180+ API calls: nur 2-3 API calls!
 *
 * @param {string} currentVariantId - Aktuell gewählte Variante
 * @param {string} startDate - Start-Datum
 * @param {string} endDate - End-Datum
 * @param {string[]} availableDates - Bereits verfügbare Daten für aktuelle Variante
 * @returns {Promise<object>} Map von Datum → verfügbare alternative Farben
 */
async function checkAlternativeColors(currentVariantId, startDate, endDate, availableDates) {
  try {
    // Import database queries
    const { blockedDatesQueries, bookingsQueries, variantInventoryQueries, colorPoolQueries } = await import('../db/database.js');

    // 1. Hole das Produkt und alle seine Varianten (1 API call)
    const query = `
      query getProductVariants($id: ID!) {
        productVariant(id: $id) {
          id
          product {
            id
            title
            variants(first: 50) {
              nodes {
                id
                title
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }
      }
    `;

    const response = await inventoryManager.shopify.graphql(query, { id: currentVariantId });
    const product = response.productVariant.product;
    const allVariants = product.variants.nodes;

    // Filtere andere Varianten (gleiche Kategorie, andere Farbe)
    const otherVariants = allVariants.filter(v => v.id !== currentVariantId);

    console.log(`[Alternative Check] Product: ${product.title}, variants: ${allVariants.length} total, ${otherVariants.length} others`);

    if (otherVariants.length === 0) {
      console.log(`[Alternative Check] No other variants found, returning empty`);
      return {}; // Keine Alternativen verfügbar
    }

    // FIX: Vorlaufzeit berechnen (gleiche Logik wie in inventoryManager)
    const minLeadTimeDays = parseInt(process.env.MIN_LEAD_TIME_DAYS || '4');
    const minBookingDate = new Date();
    minBookingDate.setDate(minBookingDate.getDate() + minLeadTimeDays);
    minBookingDate.setHours(0, 0, 0, 0);

    // 2. PERFORMANCE: Hole ALLE Daten EINMAL am Anfang (statt N+1 Queries)
    const allBookings = await bookingsQueries.getAll();

    // 3. Hole Admin-gesperrte Tage aus der Datenbank
    const allBlockedDates = await blockedDatesQueries.getAll();

    // 4. PERFORMANCE: Lade Farb-Pool Inventar und Varianten-Farben EINMAL
    const allColorPools = await colorPoolQueries.getAll();
    const allVariantInventory = await variantInventoryQueries.getAll();

    // Map: variantGid → color
    const variantColorMap = new Map();
    for (const inv of allVariantInventory) {
      if (inv.color) variantColorMap.set(inv.variant_gid, inv.color);
    }

    // Map: color → total_units (aus color_pools)
    const colorPoolMap = new Map();
    for (const pool of allColorPools) {
      colorPoolMap.set(pool.color, pool.total_units);
    }

    // 3. Generiere alle Daten im Zeitraum
    const allDates = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      allDates.push(formatDate(d));
    }

    // Finde Daten die für aktuelle Farbe NICHT verfügbar sind
    const unavailableDates = allDates.filter(date => !availableDates.includes(date));
    console.log(`[Alternative Check] ${allDates.length} dates total, ${availableDates.length} available, ${unavailableDates.length} to check for alternatives`);

    // 4. Berechne Verfügbarkeit für alle Varianten serverseitig
    const alternatives = {};

    for (const date of unavailableDates) {
      const checkDate = new Date(date);

      // Prüfe ob dieses Datum von Admin gesperrt ist
      const isAdminBlocked = allBlockedDates.some(blockedRange => {
        const blockStart = new Date(blockedRange.start_date);
        const blockEnd = new Date(blockedRange.end_date);
        return checkDate >= blockStart && checkDate <= blockEnd;
      });

      // Wenn Admin-gesperrt, keine Alternativen anzeigen
      if (isAdminBlocked) continue;

      const availableAlternatives = [];

      // Bereits geprüfte Farben merken (jede Farbe nur einmal auswerten)
      const checkedColors = new Set();

      for (const variant of otherVariants) {
        // Extrahiere Farbe aus selectedOptions ZUERST für Debugging
        const colorOption = variant.selectedOptions.find(
          opt => opt.name.toLowerCase() === 'color' ||
                 opt.name.toLowerCase() === 'farbe' ||
                 opt.name.toLowerCase() === 'colour'
        );
        const altColor = colorOption?.value || variant.title;

        // Normalisierte Farbe aus DB-Map
        const normalizedColor = variantColorMap.get(variant.id);

        // Falls Farbe nicht bekannt oder bereits geprüft → überspringen
        if (!normalizedColor || checkedColors.has(normalizedColor)) continue;
        checkedColors.add(normalizedColor);

        // Hole Inventar aus Farb-Pool (PERFORMANCE: kein DB-Query mehr!)
        const totalInventory = colorPoolMap.get(normalizedColor) ?? 0;
        if (totalInventory === 0) continue;

        // Filtere Buchungen für ALLE Varianten dieser Farbe
        const colorBookings = allBookings.filter(b => variantColorMap.get(b.variant_gid) === normalizedColor);

        const blockedCount = colorBookings.filter(booking => {
          // WICHTIG: Nur confirmed und reserved Bookings zählen (genau wie inventoryManager)
          // pending Bookings werden ignoriert, da sie noch nicht bestätigt sind
          if (booking.status !== 'confirmed' && booking.status !== 'reserved') return false;

          const eventDate = new Date(booking.event_date); // DB column name
          const checkDate = new Date(date);

          // Prüfe ob Datum in gesperrtem Zeitraum liegt (mit Buffer + Chain-Buffer)
          const bufferBefore = parseInt(process.env.SHIPPING_BUFFER_BEFORE || '2');
          const bufferAfter = parseInt(process.env.SHIPPING_BUFFER_AFTER || '2');

          const blockedStart = new Date(eventDate);
          blockedStart.setDate(blockedStart.getDate() - bufferBefore);

          // Chain-Buffer: Am Ende nochmal bufferBefore Tage anhängen
          const blockedEnd = new Date(eventDate);
          blockedEnd.setDate(blockedEnd.getDate() + bufferAfter + bufferBefore);

          return checkDate >= blockedStart && checkDate <= blockedEnd;
        }).length;

        const availableCount = totalInventory - blockedCount;

        if (availableCount > 0) {
          availableAlternatives.push({
            variantId: variant.id,
            variantTitle: variant.title,
            color: altColor,
            normalizedColor,
            availableCount
          });
        }
      }

      if (availableAlternatives.length > 0) {
        alternatives[date] = availableAlternatives;
      }
    }

    console.log(`[Alternative Check] Done: ${Object.keys(alternatives).length} dates with alternatives`);
    return alternatives;
  } catch (error) {
    console.error('[Alternative Check] ERROR checking alternative colors:', error);
    console.error('[Alternative Check] ERROR stack:', error.stack);
    console.error('[Alternative Check] ERROR name:', error.name);
    console.error('[Alternative Check] ERROR message:', error.message);
    return {};
  }
}

export default router;
