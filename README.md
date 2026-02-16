# Fotobox Booking Server

Backend API for the Fotobox Calendar Booking System. Manages inventory, bookings, Shopify integration, photo strips, and admin operations.

## Tech Stack

- **Runtime:** Node.js (>=18) with ES Modules
- **Framework:** Express.js
- **Database:** PostgreSQL (via `pg`)
- **Shopify:** GraphQL Admin API (`@shopify/shopify-api`)
- **Auth:** JWT + bcrypt
- **Email:** Nodemailer (SMTP)
- **Image Processing:** Sharp
- **Scheduling:** node-cron
- **Security:** Helmet, CORS, express-rate-limit

## Project Structure

```
server/
├── config/           # Shopify API configuration
├── db/               # Database layer & migrations
│   ├── database.js           # Main DB export (PostgreSQL)
│   ├── database-postgres.js  # PostgreSQL queries & pool
│   ├── migrate-postgres.js   # Migration runner
│   └── migrations/           # SQL migration files
├── middleware/        # Express middleware
│   ├── auth.js               # Basic auth (legacy)
│   ├── jwtAuth.js            # JWT authentication
│   ├── photoStripAuth.js     # Photo strip access control
│   └── rateLimiter.js        # Rate limiting configs
├── routes/            # API route handlers
│   ├── admin.js              # Admin panel endpoints
│   ├── availability.js       # Calendar availability
│   ├── bookings.js           # Booking CRUD
│   ├── calendar.js           # iCal feed generation
│   ├── cart.js               # Cart validation
│   ├── config.js             # Public configuration
│   ├── customers.js          # Customer management
│   ├── eventPhotos.js        # Event photos (WIP)
│   ├── features.js           # Product features
│   ├── inventory.js          # Inventory info
│   ├── orders.js             # Order management
│   ├── photoStrips.js        # Photo strip editor
│   ├── products.js           # Product catalog
│   └── webhooks.js           # Shopify webhooks
├── services/          # Business logic
│   ├── bookingService.js     # Booking lifecycle
│   ├── cronService.js        # Scheduled jobs
│   ├── customerService.js    # Customer operations
│   ├── dhlService.js         # DHL shipping API
│   ├── discountService.js    # Discount code management
│   ├── discountSyncService.js# Shopify discount sync
│   ├── emailService.js       # Transactional emails
│   ├── inventoryManager.js   # Inventory & availability
│   ├── orderService.js       # Order processing
│   ├── photoStripService.js  # Photo strip CRUD
│   ├── shippingService.js    # Shipping management
│   ├── shopifySync.js        # Product data sync
│   ├── templateService.js    # Design templates
│   └── uploadService.js      # Image uploads
├── utils/             # Utility functions
│   ├── cache.js              # In-memory TTL cache
│   ├── dateHelpers.js        # Date calculations
│   ├── eventCodeGenerator.js # Event code generation
│   └── redactPii.js          # PII redaction for logs
├── scripts/           # Admin & migration scripts
├── tests/             # Test files
├── uploads/           # File storage (photos, templates)
├── index.js           # Application entry point
├── start.sh           # Production startup script
└── package.json
```

## Setup

### Prerequisites

- Node.js >= 18
- PostgreSQL database
- Shopify store with Admin API access
- SMTP server for emails (optional in dev)

### Installation

```bash
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

Required variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `SHOPIFY_STORE_URL` | Shopify store URL (e.g., `your-store.myshopify.com`) |
| `SHOPIFY_ACCESS_TOKEN` | Shopify Admin API access token |
| `SHOPIFY_WEBHOOK_SECRET` | Webhook signature verification secret |
| `JWT_SECRET` | Secret for JWT token signing |
| `PORT` | Server port (default: 3000) |
| `NODE_ENV` | `development` or `production` |

Optional variables: see `.env.example` for full list.

### Running

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

## API Endpoints

### Public

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/availability` | Get available dates |
| `GET` | `/api/availability/check` | Check specific date |
| `POST` | `/api/bookings/reserve` | Create reservation |
| `POST` | `/api/bookings/confirm` | Confirm after payment |
| `GET` | `/api/bookings/:id` | Get booking details |
| `POST` | `/api/cart/validate` | Validate cart bookings |
| `GET` | `/api/config/booking` | Get booking config |
| `GET` | `/api/products` | Get product catalog |
| `GET` | `/api/inventory/:variantId` | Get inventory info |

### Admin (JWT required)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/admin/login` | Admin login (returns JWT) |
| `GET` | `/api/admin/dashboard` | Dashboard stats |
| `GET` | `/api/admin/bookings` | List all bookings |
| `PATCH` | `/api/admin/bookings/:id/status` | Update booking status |
| `GET` | `/api/admin/customers` | List customers |
| `GET` | `/api/admin/orders` | List orders |
| `GET/POST/DELETE` | `/api/admin/features` | Feature management |
| `GET/POST/DELETE` | `/api/admin/discounts` | Discount codes |

### Webhooks

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/webhooks/shopify/orders/create` | Shopify order created |
| `POST` | `/webhooks/shopify/orders/updated` | Shopify order updated |
| `POST` | `/webhooks/shopify/orders/cancelled` | Shopify order cancelled |
| `POST` | `/webhooks/shopify/refunds/create` | Shopify refund created |

## Database

Uses PostgreSQL with automatic schema initialization and migration on startup.

Migrations are in `db/migrations/` and run automatically via `migrate-postgres.js`.

## Deployment

Deployed on Railway with:
- PostgreSQL addon for database
- Persistent volume at `/app/data` for uploads
- Automatic SSL via Railway

## Testing

```bash
npm test
```

Currently includes unit tests for the event code generator. See `tests/` directory.

## License

MIT
