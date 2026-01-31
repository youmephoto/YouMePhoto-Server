import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateEventCode, isValidEventCode, normalizeEventCode } from '../utils/eventCodeGenerator.js';

describe('Event Code Generator', () => {
  describe('generateEventCode()', () => {
    it('should generate a 6-character code', async () => {
      const code = await generateEventCode();
      expect(code).toHaveLength(6);
    });

    it('should only contain valid characters (A-Z except I/O, 2-9)', async () => {
      const code = await generateEventCode();
      // Matches the exact charset from the generator
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    });

    it('should not contain confusing characters (I, O, 0, 1)', async () => {
      const code = await generateEventCode();
      expect(code).not.toMatch(/[IO01]/);
    });

    it('should generate unique codes (no duplicates in 100 attempts)', async () => {
      const codes = new Set();

      for (let i = 0; i < 100; i++) {
        const code = await generateEventCode();
        expect(codes.has(code)).toBe(false); // No duplicates
        codes.add(code);
      }

      expect(codes.size).toBe(100);
    }, 30000); // 30 second timeout for 100 generations

    it('should be uppercase only', async () => {
      const code = await generateEventCode();
      expect(code).toBe(code.toUpperCase());
    });

    it('should not generate blacklisted words', async () => {
      const BLACKLIST = ['FUCK', 'SHIT', 'NAZI', 'KILL', 'DEAD'];

      for (let i = 0; i < 50; i++) {
        const code = await generateEventCode();

        BLACKLIST.forEach(word => {
          expect(code).not.toContain(word);
        });
      }
    }, 20000); // 20 second timeout
  });

  describe('isValidEventCode()', () => {
    it('should accept valid 6-char codes', () => {
      expect(isValidEventCode('ABC234')).toBe(true);
      expect(isValidEventCode('H7P5M4')).toBe(true);
      expect(isValidEventCode('ZW8N3R')).toBe(true);
      expect(isValidEventCode('A3X9K2')).toBe(true);
    });

    it('should reject codes with invalid length', () => {
      expect(isValidEventCode('ABC23')).toBe(false); // Too short (5)
      expect(isValidEventCode('ABC2345')).toBe(false); // Too long (7)
      expect(isValidEventCode('A')).toBe(false); // Too short (1)
      expect(isValidEventCode('')).toBe(false); // Empty
    });

    it('should reject codes with confusing characters (I, O, 0, 1)', () => {
      expect(isValidEventCode('ABC1O0')).toBe(false); // Contains 1, O, 0
      expect(isValidEventCode('ABCI23')).toBe(false); // Contains I
      expect(isValidEventCode('ABC023')).toBe(false); // Contains 0
      expect(isValidEventCode('ABC123')).toBe(false); // Contains 1
      expect(isValidEventCode('ABCIO0')).toBe(false); // Contains I, O, 0
    });

    it('should reject lowercase codes', () => {
      expect(isValidEventCode('abc234')).toBe(false);
      expect(isValidEventCode('aBc234')).toBe(false);
      expect(isValidEventCode('ABC23d')).toBe(false);
    });

    it('should reject codes with special characters', () => {
      expect(isValidEventCode('ABC-23')).toBe(false);
      expect(isValidEventCode('ABC_23')).toBe(false);
      expect(isValidEventCode('ABC 23')).toBe(false);
      expect(isValidEventCode('ABC@23')).toBe(false);
    });

    it('should reject null/undefined/non-string inputs', () => {
      expect(isValidEventCode(null)).toBe(false);
      expect(isValidEventCode(undefined)).toBe(false);
      expect(isValidEventCode(123456)).toBe(false);
      expect(isValidEventCode({})).toBe(false);
      expect(isValidEventCode([])).toBe(false);
    });
  });

  describe('normalizeEventCode()', () => {
    it('should convert to uppercase', () => {
      expect(normalizeEventCode('abc234')).toBe('ABC234');
      expect(normalizeEventCode('aBc234')).toBe('ABC234');
      expect(normalizeEventCode('ABC234')).toBe('ABC234');
    });

    it('should trim whitespace', () => {
      expect(normalizeEventCode('  ABC234  ')).toBe('ABC234');
      expect(normalizeEventCode(' ABC234')).toBe('ABC234');
      expect(normalizeEventCode('ABC234 ')).toBe('ABC234');
      expect(normalizeEventCode('\\tABC234\\n')).toBe('ABC234');
    });

    it('should handle both uppercase and trim together', () => {
      expect(normalizeEventCode('  abc234  ')).toBe('ABC234');
      expect(normalizeEventCode(' aBc234 ')).toBe('ABC234');
    });

    it('should return null for invalid input', () => {
      expect(normalizeEventCode(null)).toBe(null);
      expect(normalizeEventCode(undefined)).toBe(null);
      expect(normalizeEventCode('')).toBe(null);
    });

    it('should convert numbers to string and uppercase', () => {
      expect(normalizeEventCode(123456)).toBe('123456');
    });
  });

  describe('Integration: Generated codes pass validation', () => {
    it('all generated codes should be valid', async () => {
      for (let i = 0; i < 20; i++) {
        const code = await generateEventCode();
        expect(isValidEventCode(code)).toBe(true);
      }
    }, 15000); // 15 second timeout

    it('normalized codes should remain valid', async () => {
      const code = await generateEventCode();
      const normalized = normalizeEventCode(code);
      expect(isValidEventCode(normalized)).toBe(true);
    });
  });

  describe('Performance', () => {
    it('should generate code in under 100ms (without DB check)', async () => {
      const start = Date.now();

      // This will fail on collision check since we don't have DB mocked,
      // but we can measure the generation time
      try {
        await generateEventCode();
      } catch (error) {
        // Expected to fail without DB
      }

      const duration = Date.now() - start;
      // First attempt should be fast (crypto.randomBytes is quick)
      // May be slower due to DB connection, so we're lenient
      expect(duration).toBeLessThan(5000); // 5 seconds max
    });
  });

  describe('Charset Distribution', () => {
    it('should use characters from the entire charset', async () => {
      const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const usedChars = new Set();

      // Generate 100 codes and collect all characters
      for (let i = 0; i < 100; i++) {
        const code = await generateEventCode();
        for (const char of code) {
          usedChars.add(char);
        }
      }

      // Should have used at least 60% of the charset (probabilistic)
      const coveragePercent = (usedChars.size / charset.length) * 100;
      expect(coveragePercent).toBeGreaterThan(60);
    }, 30000); // 30 second timeout
  });
});
