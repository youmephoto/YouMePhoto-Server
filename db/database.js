/**
 * Database Layer - PostgreSQL Only
 *
 * Re-exports everything from database-postgres.js.
 * Provides a SQLite-compatible `prepare()` wrapper for PostgreSQL queries.
 */

import { pool } from './database-postgres.js';

export * from './database-postgres.js';

/**
 * SQLite-compatible prepare() wrapper for PostgreSQL.
 * Returns an object with .get() and .run() methods that execute
 * parameterized queries against the PostgreSQL pool.
 *
 * @param {string} sql - SQL query string with $1, $2, ... placeholders
 * @returns {{ get: Function, run: Function, all: Function }}
 */
export function prepare(sql) {
  return {
    /** Returns the first row or null */
    async get(...params) {
      const result = await pool.query(sql, params);
      return result.rows[0] || null;
    },
    /** Executes the query (INSERT/UPDATE/DELETE), returns result info */
    async run(...params) {
      const result = await pool.query(sql, params);
      return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id };
    },
    /** Returns all matching rows */
    async all(...params) {
      const result = await pool.query(sql, params);
      return result.rows;
    },
  };
}
