/**
 * Debug Script: Prüft Verfügbarkeit für Januar 2026
 * Zeigt welche Daten als "available" zurückgegeben werden
 */

import FotoboxInventoryManager from '../services/inventoryManager.js';
import { USE_POSTGRES } from '../db/database.js';
import { blockedDatesQueries, bookingsQueries, prepare } from '../db/database.js';

const inventoryManager = new FotoboxInventoryManager();

// Helper für async queries
const q = {
  async get(query, ...args) {
    return USE_POSTGRES ? await query.get(...args) : query.get(...args);
  },
  async all(query, ...args) {
    return USE_POSTGRES ? await query.all(...args) : query.all(...args);
  }
};

async function debugAvailability() {
  try {
    console.log('=== DEBUG AVAILABILITY FOR JANUAR 2026 ===\n');

    // Test mit einer Variante (z.B. Premium Fotobox - Schwarz)
    // Du kannst die variantId hier anpassen
    const testVariantId = 'gid://shopify/ProductVariant/51917489045841'; // Beispiel, bitte anpassen

    console.log(`Testing variant: ${testVariantId}\n`);

    // 1. Prüfe Inventar
    const totalInventory = await inventoryManager.getTotalInventory(testVariantId);
    console.log(`Total Inventory: ${totalInventory}\n`);

    // 2. Hole alle Buchungen
    const allBookings = await q.all(bookingsQueries.getAll);
    console.log(`Total Bookings in DB: ${allBookings.length}`);

    const variantBookings = allBookings.filter(b => b.variant_gid === testVariantId);
    console.log(`Bookings for this variant: ${variantBookings.length}`);

    if (variantBookings.length > 0) {
      console.log('\nBookings:');
      variantBookings.forEach(b => {
        console.log(`  - ${b.event_date}: Status=${b.status}, Created=${b.created_at}`);
      });
    }

    // 3. Hole blocked dates
    const blockedDates = await q.all(blockedDatesQueries.getAll);
    console.log(`\nAdmin blocked date ranges: ${blockedDates.length}`);
    if (blockedDates.length > 0) {
      blockedDates.forEach(b => {
        console.log(`  - ${b.start_date} to ${b.end_date}: ${b.reason || 'No reason'}`);
      });
    }

    // 4. Teste Verfügbarkeit für Januar 2026
    console.log('\n=== TESTING AVAILABILITY FOR JANUARY 2026 ===\n');

    const availableDates = await inventoryManager.getAvailableDates(
      testVariantId,
      '2026-01-01',
      '2026-01-31'
    );

    console.log(`Available dates count: ${availableDates.length}`);
    console.log('\nAvailable dates:');
    console.log(availableDates.join(', '));

    // 5. Prüfe spezifische Daten die im Screenshot blau sind
    const blueDates = ['2026-01-20', '2026-01-21', '2026-01-22'];
    console.log('\n=== CHECKING BLUE DATES FROM SCREENSHOT ===\n');

    for (const date of blueDates) {
      const result = await inventoryManager.checkAvailability(testVariantId, date);
      console.log(`${date}:`);
      console.log(`  Available: ${result.available}`);
      console.log(`  Available Count: ${result.availableCount}`);
      console.log(`  Total Inventory: ${result.totalInventory}`);
      console.log(`  Blocked Dates: ${result.blockedDates.join(', ')}`);
      console.log('');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

debugAvailability();
