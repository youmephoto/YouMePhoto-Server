import crypto from 'crypto';
import { bookingsQueries } from '../db/database-postgres.js';

/**
 * Event Code Generator Configuration
 *
 * - Length: 6 characters
 * - Charset: A-Z (except I, O) + 2-9 (no 0, 1)
 * - Total combinations: 32^6 = 1,073,741,824 (~ 1 billion)
 * - Cryptographically secure using crypto.randomBytes()
 */

const EVENT_CODE_LENGTH = 6;
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars (no I, O, 0, 1)
const MAX_COLLISION_RETRIES = 10;

// Blacklist offensive/problematic combinations
const BLACKLIST = [
  'FUCK', 'SHIT', 'DAMN', 'HELL', 'NAZI', 'KILL', 'DEAD',
  'HATE', 'RAPE', 'PORN', 'DICK', 'COCK', 'CUNT', 'SLUT'
];

/**
 * Generate a cryptographically secure 6-character event code
 *
 * @returns {Promise<string>} A unique 6-character event code (e.g., "A3X9K2")
 * @throws {Error} If unable to generate unique code after MAX_COLLISION_RETRIES attempts
 *
 * @example
 * const code = await generateEventCode();
 * console.log(code); // "H7P5M4"
 */
export async function generateEventCode() {
  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
    const code = generateRandomCode();

    // Check blacklist
    if (containsBlacklistedWord(code)) {
      console.log(`[EventCodeGenerator] Blacklisted code generated, retrying: ${code}`);
      continue;
    }

    // Check uniqueness in database
    const existing = await bookingsQueries.getByEventCodeAdmin(code);

    if (!existing) {
      return code;
    }

    console.log(
      `[EventCodeGenerator] Collision detected for code ${code}, ` +
      `retry ${attempt + 1}/${MAX_COLLISION_RETRIES}`
    );
  }

  throw new Error(
    `Failed to generate unique event code after ${MAX_COLLISION_RETRIES} attempts`
  );
}

/**
 * Generate a random code using crypto.randomBytes for cryptographic security
 *
 * @returns {string} A random 6-character code
 * @private
 */
function generateRandomCode() {
  // Generate extra bytes for random selection
  const bytes = crypto.randomBytes(EVENT_CODE_LENGTH * 2);
  let code = '';

  for (let i = 0; i < EVENT_CODE_LENGTH; i++) {
    const randomIndex = bytes[i] % CHARSET.length;
    code += CHARSET[randomIndex];
  }

  return code;
}

/**
 * Check if code contains any blacklisted words
 *
 * @param {string} code - The event code to check
 * @returns {boolean} True if code contains blacklisted word
 * @private
 */
function containsBlacklistedWord(code) {
  return BLACKLIST.some(word => code.includes(word));
}

/**
 * Validate event code format
 *
 * @param {string} code - The event code to validate
 * @returns {boolean} True if code matches valid format
 *
 * @example
 * isValidEventCode('A3X9K2');  // true
 * isValidEventCode('ABC123');  // false (contains 1)
 * isValidEventCode('A3X9K');   // false (only 5 chars)
 */
export function isValidEventCode(code) {
  if (!code || typeof code !== 'string') {
    return false;
  }

  // Exact 6 characters from allowed charset
  const regex = new RegExp(`^[${CHARSET}]{${EVENT_CODE_LENGTH}}$`);
  return regex.test(code);
}

/**
 * Normalize event code to uppercase and trim whitespace
 *
 * @param {string} code - The event code to normalize
 * @returns {string|null} Normalized code or null if invalid input
 *
 * @example
 * normalizeEventCode('  a3x9k2  ');  // 'A3X9K2'
 * normalizeEventCode('abc');          // 'ABC'
 * normalizeEventCode(null);           // null
 */
export function normalizeEventCode(code) {
  if (!code) {
    return null;
  }

  return code.toString().toUpperCase().trim();
}
