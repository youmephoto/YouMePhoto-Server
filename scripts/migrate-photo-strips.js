import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../db/fotobox.db');
const migrationPath = path.join(__dirname, '../db/migrations/add_photo_strips.sql');

try {
  console.log('🔄 Running photo strips migration...\n');

  // Check if database exists
  if (!fs.existsSync(dbPath)) {
    console.error('❌ Database not found at:', dbPath);
    console.error('Please run the main schema initialization first.');
    process.exit(1);
  }

  // Check if migration file exists
  if (!fs.existsSync(migrationPath)) {
    console.error('❌ Migration file not found at:', migrationPath);
    process.exit(1);
  }

  // Open database
  const db = new Database(dbPath);
  console.log('✓ Connected to database');

  // Read migration SQL
  const migration = fs.readFileSync(migrationPath, 'utf-8');
  console.log('✓ Migration file loaded');

  // Execute migration
  db.exec(migration);
  console.log('✓ Photo strips schema created');

  // Initialize default templates
  console.log('\n🎨 Initializing default templates...');

  // Template 1: Hochzeit Elegant
  const weddingTemplate = {
    version: '6.0.2',
    objects: [
      {
        type: 'text',
        text: 'Unsere Hochzeit',
        fontFamily: 'Outfit',
        fontSize: 60,
        fill: '#d4af37',
        left: 400,
        top: 200,
        originX: 'center',
        originY: 'center',
        fontWeight: 'bold'
      },
      {
        type: 'text',
        text: 'Sarah & Michael',
        fontFamily: 'Dancing Script',
        fontSize: 48,
        fill: '#333333',
        left: 400,
        top: 300,
        originX: 'center',
        originY: 'center'
      },
      {
        type: 'rect',
        width: 600,
        height: 3,
        fill: '#d4af37',
        left: 100,
        top: 350,
        rx: 1,
        ry: 1
      }
    ],
    background: '#f5e6d3'
  };

  const insertTemplate = db.prepare(`
    INSERT INTO design_templates (name, category, template_data, description, display_order, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `);

  insertTemplate.run(
    'Hochzeit Elegant',
    'wedding',
    JSON.stringify(weddingTemplate),
    'Elegantes Design für Hochzeiten mit goldenen Akzenten',
    1
  );
  console.log('  ✓ Hochzeit Elegant template created');

  // Template 2: Geburtstag Bunt
  const birthdayTemplate = {
    version: '6.0.2',
    objects: [
      {
        type: 'text',
        text: 'Happy Birthday!',
        fontFamily: 'Fredoka One',
        fontSize: 64,
        fill: '#ff6b6b',
        left: 400,
        top: 250,
        originX: 'center',
        originY: 'center',
        fontWeight: 'bold'
      },
      {
        type: 'circle',
        radius: 40,
        fill: '#feca57',
        left: 150,
        top: 150
      },
      {
        type: 'circle',
        radius: 40,
        fill: '#48dbfb',
        left: 650,
        top: 150
      },
      {
        type: 'circle',
        radius: 40,
        fill: '#ff9ff3',
        left: 150,
        top: 350
      },
      {
        type: 'circle',
        radius: 40,
        fill: '#54a0ff',
        left: 650,
        top: 350
      }
    ],
    background: '#ffffff'
  };

  insertTemplate.run(
    'Geburtstag Bunt',
    'birthday',
    JSON.stringify(birthdayTemplate),
    'Farbenfrohe Vorlage für Geburtstagsfeiern',
    2
  );
  console.log('  ✓ Geburtstag Bunt template created');

  // Template 3: Corporate Professional
  const corporateTemplate = {
    version: '6.0.2',
    objects: [
      {
        type: 'rect',
        width: 800,
        height: 200,
        fill: '#2c3e50',
        left: 0,
        top: 0
      },
      {
        type: 'text',
        text: 'Company Event 2026',
        fontFamily: 'Roboto',
        fontSize: 48,
        fill: '#ffffff',
        left: 400,
        top: 100,
        originX: 'center',
        originY: 'center',
        fontWeight: 'bold'
      },
      {
        type: 'text',
        text: 'Ihr Logo hier',
        fontFamily: 'Roboto',
        fontSize: 24,
        fill: '#7f8c8d',
        left: 400,
        top: 300,
        originX: 'center',
        originY: 'center'
      }
    ],
    background: '#ecf0f1'
  };

  insertTemplate.run(
    'Corporate Professional',
    'corporate',
    JSON.stringify(corporateTemplate),
    'Professionelles Design für Firmenevents',
    3
  );
  console.log('  ✓ Corporate Professional template created');

  // Close database
  db.close();

  console.log('\n✅ Migration completed successfully!');
  console.log('\nNext steps:');
  console.log('1. Mount routes in server/index.js');
  console.log('2. Add FRONTEND_URL to .env');
  console.log('3. Create frontend components');
  console.log('4. Test the complete flow\n');

} catch (error) {
  console.error('\n❌ Migration failed:', error.message);
  console.error(error);
  process.exit(1);
}
