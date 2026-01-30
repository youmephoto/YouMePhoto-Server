import cron from 'node-cron';
import shippingService from './shippingService.js';
import discountSyncService from './discountSyncService.js';
import discountService from './discountService.js';

/**
 * Cron Service
 * Schedules automated tasks for shipping management and discount synchronization
 */

/**
 * Initialize all cron jobs
 * Called from server/index.js on startup
 */
export function initializeCronJobs() {
  console.log('⏰ Initializing cron jobs...');

  // Check for overdue returns daily at 9 AM
  cron.schedule('0 9 * * *', async () => {
    console.log('🔍 [CRON] Checking for overdue returns...');
    try {
      const count = await shippingService.checkOverdueReturns();
      console.log(`✓ [CRON] Processed ${count} overdue returns`);
    } catch (error) {
      console.error('❌ [CRON] Error checking overdue returns:', error);
    }
  });

  // Sync discount codes from Shopify every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    console.log('🔄 [CRON] Syncing discount codes from Shopify...');
    try {
      const result = await discountSyncService.syncFromShopify();
      if (result.success) {
        console.log(`✓ [CRON] Discount sync completed - Imported: ${result.imported}, Updated: ${result.updated}, Deleted: ${result.deleted}`);
      } else {
        console.error(`❌ [CRON] Discount sync failed: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ [CRON] Error syncing discount codes:', error);
    }
  });

  // Check and expire outdated discount codes every hour
  cron.schedule('0 * * * *', async () => {
    console.log('⏰ [CRON] Checking for expired discount codes...');
    try {
      const count = await discountService.expireOutdatedCodes();
      console.log(`✓ [CRON] Marked ${count} discount code(s) as expired`);
    } catch (error) {
      console.error('❌ [CRON] Error expiring discount codes:', error);
    }
  });

  console.log('✓ Cron jobs initialized:');
  console.log('  - Overdue returns check: Daily at 9 AM');
  console.log('  - Discount codes sync: Every 30 minutes');
  console.log('  - Discount codes expiry check: Every hour');
}

/**
 * Stop all cron jobs (for graceful shutdown)
 */
export function stopCronJobs() {
  cron.getTasks().forEach(task => task.stop());
  console.log('✓ All cron jobs stopped');
}
