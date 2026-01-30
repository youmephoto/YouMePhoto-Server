/**
 * Database Layer - PostgreSQL Only
 *
 * This file now directly re-exports everything from database-postgres.js
 * All SQLite support has been removed as the application now runs exclusively on PostgreSQL.
 */

export * from './database-postgres.js';

// For backwards compatibility, provide a prepare function
// In PostgreSQL, we don't need to prepare statements the same way as SQLite
// but some code may still call prepare() expecting a query string
export function prepare(sql) {
  return sql;
}

console.log('[Database] Using PostgreSQL (SQLite support removed)');
