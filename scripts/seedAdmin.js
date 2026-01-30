import bcrypt from 'bcrypt';
import db from '../db/database.js';

/**
 * Seeds the database with a default admin user
 */
async function seedAdmin() {
  console.log('[Seed] Creating default admin user...\n');

  const username = 'admin';
  const password = 'admin123';
  const email = 'admin@fotobox.de';

  try {
    // Check if admin already exists
    const existingUser = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);

    if (existingUser) {
      console.log('[Seed] ℹ️  Admin user already exists. Updating password...');

      // Generate new password hash
      const passwordHash = await bcrypt.hash(password, 10);

      // Update existing user
      db.prepare('UPDATE admin_users SET password_hash = ? WHERE username = ?')
        .run(passwordHash, username);

      console.log('[Seed] ✓ Admin password updated successfully');
    } else {
      console.log('[Seed] Creating new admin user...');

      // Generate password hash
      const passwordHash = await bcrypt.hash(password, 10);

      // Insert new user
      db.prepare(`
        INSERT INTO admin_users (username, password_hash, email)
        VALUES (?, ?, ?)
      `).run(username, passwordHash, email);

      console.log('[Seed] ✓ Admin user created successfully');
    }

    console.log('\n[Seed] =====================================');
    console.log('[Seed] Login Credentials:');
    console.log('[Seed] Username: admin');
    console.log('[Seed] Password: admin123');
    console.log('[Seed] =====================================');
    console.log('[Seed] ⚠️  WICHTIG: Ändere das Passwort nach dem ersten Login!');
    console.log('[Seed] =====================================\n');

  } catch (error) {
    console.error('[Seed] ❌ Error creating admin user:', error);
    throw error;
  }
}

// Run seed
seedAdmin()
  .then(() => {
    console.log('[Seed] Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[Seed] Failed:', error);
    process.exit(1);
  });
