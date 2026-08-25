# VoltXpress Backend

Node.js, Express 5, and MySQL API for the VoltXpress Pakistani tech accessories store.

## Setup

```bash
cd backend
cp .env.example .env   # configure DB, JWT secrets, etc.
npm install
npm run db:setup       # creates DB, tables, seeds data + admin user
npm run dev            # starts with file-watch on http://127.0.0.1:4000
```

## API Overview

All endpoints return consistent JSON: `{ success, message, data, errors }`

Base URL: `http://127.0.0.1:4000/api/v1`  
Legacy (backward compat): `http://127.0.0.1:4000/api`

---

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/health | DB connectivity check |

### Auth (`/api/v1/auth`) — Rate limited: 5 req/min
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /auth/register | Register (bcrypt + JWT access 15m + refresh 7d) |
| POST | /auth/login | Login |
| POST | /auth/refresh | Refresh access token (rotation) |
| POST | /auth/send-otp | Send OTP to Pakistani phone (+923XXXXXXXXX) |
| POST | /auth/verify-otp | Verify OTP code |
| POST | /auth/forgot-password | Email password reset link |
| POST | /auth/reset-password | Reset password with token |
| GET | /auth/me | Current user profile (requires auth) |

### User Profile (`/api/v1/user`) — Requires auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /user/profile | Get profile |
| PUT | /user/profile | Update name, phone, gender, dob |
| POST | /user/avatar | Upload avatar (multipart, Cloudinary) |
| GET | /user/addresses | List addresses |
| POST | /user/addresses | Add address |
| PUT | /user/addresses/:id | Update address, set default |
| GET | /user/orders | Paginated order history |

### Products (`/api/v1/products`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /products | Filters: ?category, minPrice, maxPrice, rating, color, brand, sort=price_asc\|price_desc\|newest\|popular, page, limit |
| GET | /products/:id | Full detail + images + review stats |
| GET | /products/:id/images | Product images |
| POST | /products/:id/images | Upload images (admin, multipart) |
| DELETE | /products/:id/images/:imageId | Delete image (admin) |

### Categories (`/api/v1/categories`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /categories | All categories with product counts |
| GET | /categories/:slug/products | Products in a category |

### Cart (`/api/v1/cart`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /cart | Get cart (guest via x-device-id header, or auth) |
| POST | /cart/add | Add item |
| PUT | /cart/update/:itemId | Update quantity |
| DELETE | /cart/remove/:itemId | Remove item |
| POST | /cart/apply-coupon | Validate & apply coupon |

### Orders (`/api/v1/orders`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /orders | Checkout (validates stock, deducts, applies coupon) |
| GET | /orders/:orderNumber | Order detail + status timeline |
| POST | /orders/:id/cancel | Cancel (pending/processing only, restores stock) |

### Payments (`/api/v1/payments`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /payments/methods | JazzCash, Easypaisa, 1LINK, HBL, Meezan, UBL, COD |
| POST | /payments/initiate | Start payment (COD auto-confirms, others redirect) |
| POST | /payments/callback | Webhook handler (verifies HMAC signature) |

### Reviews (`/api/v1/reviews`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /reviews | Paginated, includes avg rating |
| GET | /reviews/product/:productId | Product-specific reviews |
| POST | /reviews | Submit (auth, purchase verified, 1 per product) |

### Wishlist (`/api/v1/wishlist`) — Requires auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /wishlist | Get wishlist |
| POST | /wishlist/add | Add product |
| DELETE | /wishlist/remove/:productId | Remove |

### Search (`/api/v1/search`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /search?q= | Search products + suggested categories |

### Admin (`/api/v1/admin`) — Requires auth + admin role
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/summary | Dashboard stats (revenue PKR, orders, users today, low stock) |
| GET | /admin/orders | Paginated orders, filter by ?status |
| PUT | /admin/orders/:id/status | Update status (pending→processing→shipped→delivered→returned) |
| GET | /admin/users | Paginated user list |
| PUT | /admin/users/:id/ban | Ban/unban user |
| GET | /admin/users/:id/orders | User's order history |
| POST | /admin/products | Create product (with slug, brand, is_new, color variants) |
| PUT | /admin/products/:id | Update product |
| DELETE | /admin/products/:id | Soft delete (sets deleted_at) |
| POST | /admin/categories | Create category (supports parent_id) |
| PUT | /admin/categories/:id | Update category |
| DELETE | /admin/categories/:id | Delete category |
| GET | /admin/coupons | List coupons |
| POST | /admin/coupons | Create coupon (flat/percent, min order, expiry) |
| PUT | /admin/coupons/:id | Update coupon |
| DELETE | /admin/coupons/:id | Delete coupon |
| GET | /admin/banners | List banners |
| POST | /admin/banners | Create banner (image, link, is_active, display_order) |
| PUT | /admin/banners/:id | Update banner |
| DELETE | /admin/banners/:id | Delete banner |
| GET | /admin/reviews | Paginated reviews (all statuses) |
| PUT | /admin/reviews/:id/approve | Approve review |
| PUT | /admin/reviews/:id/reject | Reject review |
| GET | /admin/activity-log | Admin audit trail |

---

## Security & Middleware

- **helmet** — security headers
- **cors** — whitelist-based origin control
- **express-rate-limit** — 5 req/min on auth, 100 req/min general
- **JWT** — access token (15m) + refresh token (7d) with rotation
- **bcrypt** — 12 rounds for password hashing
- **Input validation** — required fields, email format, password length
- **Admin activity log** — all admin actions recorded with timestamp

## Environment Variables

See `.env.example` for the full list including JWT secrets, Twilio SMS, Cloudinary, SMTP, JazzCash, and Easypaisa configuration.
