import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../db/fotobox.db');
const db = new Database(DB_PATH);

console.log('[Check] Database:', DB_PATH);
console.log('\n=== Variant Inventory ===');
const variants = db.prepare('SELECT variant_gid, product_title, variant_title, total_units FROM variant_inventory').all();
console.log(JSON.stringify(variants, null, 2));

console.log('\n=== Bookings ===');
const bookings = db.prepare('SELECT booking_id, variant_gid, product_title, variant_title, event_date, start_date, end_date, total_days, status FROM bookings').all();
console.log(JSON.stringify(bookings, null, 2));

db.close();
