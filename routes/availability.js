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

    // Optimierung: Daten nur einmal laden
    const totalInventory = await inventoryManager.getTotalInventory(variantId);

    // Verfügbare Daten abrufen (verwendet intern auch getTotalInventory,
    // aber wir können das später cachen wenn nötig)
    console.log('[Availability] Fetching available dates...');
    const availableDates = await inventoryManager.getAvailableDates(
      variantId,
      startDate,
      endDate
    );
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
    const { blockedDatesQueries, bookingsQueries, variantInventoryQueries } = await import('../db/database.js');

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

    console.log(`[Alternative Check] Product: ${product.title}, Total variants: ${allVariants.length}, Other variants: ${otherVariants.length}`);
    console.log(`[Alternative Check] Current variant: ${currentVariantId}`);

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

    // 4. PERFORMANCE: Lade ALLE Inventory-Daten EINMAL (statt für jede Variante einzeln)
    const allInventory = await variantInventoryQueries.getAll();

    // Erstelle Map für schnellen Lookup: variantGid → inventory
    const inventoryMap = new Map();
    for (const inv of allInventory) {
      inventoryMap.set(inv.variant_gid, inv);
    }

    // 3. Generiere alle Daten im Zeitraum
    console.log(`[Alternative Check] Date range parameters: startDate="${startDate}", endDate="${endDate}"`);
    const allDates = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    console.log(`[Alternative Check] Parsed dates: start=${start.toISOString()}, end=${end.toISOString()}`);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      allDates.push(formatDate(d));
    }
    console.log(`[Alternative Check] Generated allDates (first 5):`, allDates.slice(0, 5));
    console.log(`[Alternative Check] Generated allDates (last 5):`, allDates.slice(-5));

    // Finde Daten die für aktuelle Farbe NICHT verfügbar sind
    const unavailableDates = allDates.filter(date => !availableDates.includes(date));
    console.log(`[Alternative Check] availableDates array (first 5):`, availableDates.slice(0, 5));

    console.log(`[Alternative Check] Total dates in range: ${allDates.length}, Available for current variant: ${availableDates.length}, Unavailable: ${unavailableDates.length}`);
    console.log(`[Alternative Check] Unavailable dates to check:`, unavailableDates);

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
      if (isAdminBlocked) {
        console.log(`[Alternative Check] Date ${date} is admin-blocked, skipping alternatives`);
        continue;
      }

      // WICHTIG: Vorlaufzeit-Prüfung für Alternativen
      // Wenn das Datum in der Vergangenheit oder zu nah liegt, zeige trotzdem Alternativen
      // (Der Kalender zeigt es bereits als "unavailable" - Alternativen sind die einzige Option)
      const isWithinLeadTime = checkDate < minBookingDate;
      if (isWithinLeadTime) {
        console.log(`[Alternative Check] Date ${date} is within lead time - will show alternatives anyway`);
      }

      const availableAlternatives = [];

      console.log(`[Alternative Check] ===== Checking date ${date} (${otherVariants.length} variants to check) =====`);

      for (const variant of otherVariants) {
        // Extrahiere Farbe aus selectedOptions ZUERST für Debugging
        const colorOption = variant.selectedOptions.find(
          opt => opt.name.toLowerCase() === 'color' ||
                 opt.name.toLowerCase() === 'farbe' ||
                 opt.name.toLowerCase() === 'colour'
        );
        const altColor = colorOption?.value || variant.title;

        // Filtere Buchungen für diese Variante (DB verwendet variant_gid statt variantId)
        const variantBookings = allBookings.filter(b => b.variant_gid === variant.id);

        // Hole Inventory aus Map (PERFORMANCE: kein DB-Query mehr!)
        const dbInventory = inventoryMap.get(variant.id);
        const totalInventory = dbInventory?.total_units || 0;

        // Falls nicht in DB, überspringe diese Variante
        if (!dbInventory) {
          console.log(`[Alternative Check] ${altColor} - NO INVENTORY IN DB, skipping`);
          continue;
        }
        const blockedCount = variantBookings.filter(booking => {
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

        console.log(`[Alternative Check] ${altColor} (${variant.id}) - Total: ${totalInventory}, Blocked: ${blockedCount}, Available: ${availableCount}`);

        if (availableCount > 0) {
          availableAlternatives.push({
            variantId: variant.id,
            variantTitle: variant.title,
            color: altColor,
            availableCount
          });
          console.log(`[Alternative Check] ✓ Added ${altColor} as alternative`);
        }
      }

      if (availableAlternatives.length > 0) {
        alternatives[date] = availableAlternatives;
        console.log(`[Alternative Check] ✓ Found ${availableAlternatives.length} alternatives for ${date}`);
      } else {
        console.log(`[Alternative Check] ✗ No alternatives found for ${date}`);
      }
    }

    console.log(`[Alternative Check] Final alternatives object:`, JSON.stringify(alternatives, null, 2));
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
