# Changelog

## [1.1.0] - 2026-02-13 - Code Review & Bug Fixes

### Removed (Dead Code)
| File | Lines | Reason |
|---|---|---|
| `db/database-sqlite.js` | ~1025 | Unused - PostgreSQL only |
| `db/migrate.js` | ~60 | SQLite migration runner - unused |
| `db/fotobox.db.backup` | binary | SQLite backup file - unused |
| `services/backupService.js` | ~300 | SQLite-only backup service |
| `routes/admin-postgres.js` | ~1150 | Duplicate of admin.js (incomplete) |
| `routes/testPhotoStrips.js` | ~100 | Test route using SQLite directly |

**Total removed: ~2,635 lines of dead code**

### Fixed (Critical Bugs)

| File | Issue | Fix |
|---|---|---|
| `services/shopifySync.js:102` | Missing `await` on `getByVariantGid()` - Promise always truthy, new variants never detected | Added `await`, fixed price comparison with `String()` |
| `services/shopifySync.js:113` | Missing `await` on `updateMetadata()` - updates fire-and-forget | Added `await` |
| `services/discountSyncService.js:114` | Missing `await` on `create()` - `discountId` was undefined | Added `await` on all 12 async DB calls |
| `services/discountSyncService.js:131` | `result.lastInsertRowid` (SQLite API) returned undefined in PostgreSQL | Changed to `result?.id \|\| result?.lastInsertRowid` |
| `services/discountSyncService.js:137,148,171,185,190,196,207,263,266` | Missing `await` on write operations - race conditions, errors silenced | Added `await` to all DB operations |
| `db/database-postgres.js:1043` | Transaction helper `fn()` called without passing `client` - queries ran outside transaction | Changed to `fn(client)` so callback receives the transaction client |
| `db/database.js` | `prepare()` returned plain SQL string - `.get()` and `.run()` calls failed | Rewrote `prepare()` to return object with proper PostgreSQL query methods |

### Fixed (Security)

| File | Issue | Fix |
|---|---|---|
| `routes/admin.js:470` | SQL injection via string interpolation in `INTERVAL '${LOCKOUT_MINUTES} minutes'` | Changed to parameterized query `($3 \|\| ' minutes')::INTERVAL` |
| `routes/admin.js:463-464` | `parseInt()` without radix, no fallback defaults | Added radix `10` and fallback defaults (`\|\| 5`, `\|\| 15`) |
| `services/emailService.js` | User data (productTitle, customerName, etc.) interpolated directly into HTML templates - XSS risk | Added `escapeHtml()` utility, applied to user-provided data in email templates |
| `services/discountSyncService.js:140` | Only caught `UNIQUE constraint` errors (SQLite) | Added `duplicate key` for PostgreSQL compatibility |

### Fixed (Broken Queries in admin.js)

| Line | Issue | Fix |
|---|---|---|
| 1271 | `prepare()` called as function instead of using `.get()` method | Replaced with `pool.query()` |
| 1301, 1307 | `prepare()` with `?` placeholders (SQLite syntax) | Replaced with `pool.query()` using `$1, $2` |
| 1416 | Same pattern as 1271 | Replaced with `pool.query()` |
| 1463, 1474, 1497 | `prepare()` called without `.run()` method | Replaced with `pool.query()` |
| 1639 | `prepare()` for INSERT called as function | Replaced with `pool.query()` |
| 1962 | `prepare()` with `?` placeholders for UPDATE | Replaced with `pool.query()` using `$1-$8` |

### Added (Developer Experience)

| File | Description |
|---|---|
| `README.md` | Project overview, setup instructions, API endpoints, deployment info |
| `.gitignore` | Covers node_modules, .env, db files, backups, IDE files |
| `.eslintrc.json` | ESLint config for Node.js ES Modules |
| `.prettierrc` | Prettier formatting config |
| `.env.example` | Complete list of all environment variables with descriptions |
| `CHANGELOG.md` | This file |

### Changed (package.json)

- Added missing `compression` dependency (was used but not listed)
- Added `devDependencies`: eslint, prettier, vitest
- Added scripts: `test`, `test:watch`, `lint`, `lint:fix`, `format`, `seed:admin`

### Updated (index.js)

- Removed `testPhotoStripsRoutes` import and route registration
- Removed `BackupService` comment (service deleted)
- Removed stale `BackupService` note in startup

---

## Open Issues / Recommendations

### High Priority
1. **Missing `escapeHtml()` in remaining email templates** - Only the reservation email was updated. All other templates (`sendConfirmationEmail`, `sendCancellationEmail`, etc.) still need the same treatment.
2. **photoStripAuth.js still uses old `prepare()` pattern** - Now works with the fixed `prepare()` wrapper, but should be migrated to use query objects from `database-postgres.js` for consistency.
3. **shippingService.js uses `prepare()` with SQLite-style queries** - Some methods reference `prepare()` but use inconsistent patterns. Needs review.

### Medium Priority
4. **N+1 queries in customerService.js** - Tags fetched per-customer instead of batch query.
5. **Dashboard endpoints (admin.js:652, 734)** - Fetch ALL data into memory for filtering. Should use database-level aggregation.
6. **No input validation middleware** - Consider adding `express-validator` or `joi` for centralized request validation.
7. **Email addresses not normalized** - IDOR checks in `bookings.js` use case-sensitive string comparison.

### Low Priority
8. **Hardcoded color maps in products.js** - Should be in database or config.
9. **Dynamic imports inside route handlers** - `availability.js`, `features.js` use `await import()` inside request handlers. Should be top-level imports.
10. **Missing structured logging** - All logging uses `console.log/error`. Consider Winston or Pino for log levels and JSON output.
