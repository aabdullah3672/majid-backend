import { Router } from "express";
import { query } from "../config/db.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { attachProductColors } from "../services/catalogService.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { success, created, paginated } from "../utils/response.js";
import { cleanString, requireFields } from "../utils/validation.js";
import { logAdminAction } from "../utils/adminLog.js";

export const adminRoutes = Router();
adminRoutes.use(requireAuth, requireAdmin);

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

adminRoutes.get("/summary", asyncHandler(async (req, res) => {
  const [orderStats, productStats, userStats, reviewStats, todayUsers, revenueToday] = await Promise.all([
    query("SELECT COUNT(*) AS totalOrders, COALESCE(SUM(total), 0) AS revenue FROM orders"),
    query("SELECT COUNT(*) AS totalProducts, SUM(stock < 20) AS lowStock FROM products WHERE deleted_at IS NULL"),
    query("SELECT COUNT(*) AS totalUsers FROM users"),
    query("SELECT COUNT(*) AS totalReviews, SUM(status = 'pending') AS pendingReviews FROM reviews"),
    query("SELECT COUNT(*) AS count FROM users WHERE DATE(created_at) = CURDATE()"),
    query("SELECT COALESCE(SUM(total), 0) AS amount FROM orders WHERE DATE(created_at) = CURDATE()")
  ]);

  // Order breakdown by status
  const statusBreakdown = await query(`
    SELECT status, COUNT(*) AS count FROM orders GROUP BY status
  `);

  return success(res, {
    summary: {
      totalOrders: orderStats[0]?.totalOrders || 0,
      revenue: orderStats[0]?.revenue || 0,
      revenueToday: revenueToday[0]?.amount || 0,
      totalProducts: productStats[0]?.totalProducts || 0,
      lowStock: productStats[0]?.lowStock || 0,
      totalUsers: userStats[0]?.totalUsers || 0,
      newUsersToday: todayUsers[0]?.count || 0,
      totalReviews: reviewStats[0]?.totalReviews || 0,
      pendingReviews: reviewStats[0]?.pendingReviews || 0,
      ordersByStatus: Object.fromEntries(statusBreakdown.map((r) => [r.status, r.count]))
    }
  }, "Dashboard summary retrieved.");
}));

// ─── Revenue Chart Data (daily for last 30 days, weekly for 12 weeks, monthly for 12 months) ──
adminRoutes.get("/analytics/revenue", asyncHandler(async (req, res) => {
  const period = req.query.period || "daily"; // daily | weekly | monthly

  let rows;
  if (period === "monthly") {
    rows = await query(`
      SELECT DATE_FORMAT(created_at, '%Y-%m') AS label,
             COUNT(*) AS orders,
             COALESCE(SUM(total), 0) AS revenue
      FROM orders
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY label ORDER BY label ASC
    `);
  } else if (period === "weekly") {
    rows = await query(`
      SELECT CONCAT(YEAR(created_at), '-W', LPAD(WEEK(created_at), 2, '0')) AS label,
             COUNT(*) AS orders,
             COALESCE(SUM(total), 0) AS revenue
      FROM orders
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK)
      GROUP BY label ORDER BY label ASC
    `);
  } else {
    rows = await query(`
      SELECT DATE(created_at) AS label,
             COUNT(*) AS orders,
             COALESCE(SUM(total), 0) AS revenue
      FROM orders
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY label ORDER BY label ASC
    `);
  }

  return success(res, { period, chart: rows }, "Revenue data retrieved.");
}));

// ─── Top Selling Products ────────────────────────────────────────────────────
adminRoutes.get("/analytics/top-products", asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);

  const rows = await query(`
    SELECT oi.product_id, oi.product_name, p.image, p.price, p.stock,
           SUM(oi.quantity) AS totalSold,
           SUM(oi.line_total) AS totalRevenue
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    INNER JOIN orders o ON o.id = oi.order_id AND o.status NOT IN ('cancelled', 'returned')
    GROUP BY oi.product_id, oi.product_name, p.image, p.price, p.stock
    ORDER BY totalSold DESC
    LIMIT ${limit}
  `);

  return success(res, { products: rows }, "Top selling products retrieved.");
}));

// ─── Recent Orders Feed ──────────────────────────────────────────────────────
adminRoutes.get("/analytics/recent-orders", asyncHandler(async (req, res) => {
  const rows = await query(`
    SELECT id, order_number, customer_name, status, total, payment_method, created_at
    FROM orders
    ORDER BY created_at DESC
    LIMIT 10
  `);
  return success(res, { orders: rows.map(mapOrderListItem) }, "Recent orders retrieved.");
}));

// ─── Low Stock Products ──────────────────────────────────────────────────────
adminRoutes.get("/analytics/low-stock", asyncHandler(async (req, res) => {
  const threshold = Math.max(Number(req.query.threshold) || 20, 1);

  const rows = await query(`
    SELECT id, name, image, stock, price, category_slug
    FROM products
    WHERE deleted_at IS NULL AND stock < ?
    ORDER BY stock ASC
    LIMIT 50
  `, [threshold]);

  return success(res, { products: rows, threshold }, "Low stock products retrieved.");
}));

// ─── Customer Signups Over Time ──────────────────────────────────────────────
adminRoutes.get("/analytics/signups", asyncHandler(async (req, res) => {
  const rows = await query(`
    SELECT DATE(created_at) AS label, COUNT(*) AS count
    FROM users
    WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    GROUP BY label ORDER BY label ASC
  `);
  return success(res, { chart: rows }, "Signup data retrieved.");
}));

// ═══════════════════════════════════════════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════════════════════════════════════════

adminRoutes.get("/orders", asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const offset = (page - 1) * limit;

  const status = req.query.status;
  const where = status ? "WHERE status = ?" : "";
  const params = status ? [status] : [];

  const [rows, countRows] = await Promise.all([
    query(`SELECT id, order_number, customer_name, customer_email, status, total, created_at FROM orders ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, params),
    query(`SELECT COUNT(*) AS total FROM orders ${where}`, params)
  ]);

  return paginated(res, { orders: rows.map(mapOrderListItem) }, { page, limit, total: countRows[0]?.total || 0, totalPages: Math.ceil((countRows[0]?.total || 0) / limit) });
}));

adminRoutes.put("/orders/:id/status", asyncHandler(async (req, res) => {
  const { status, note } = req.body;
  const validStatuses = ["pending", "processing", "shipped", "delivered", "cancelled", "returned"];
  if (!validStatuses.includes(status)) throw badRequest(`Status must be one of: ${validStatuses.join(", ")}`);

  const orders = await query("SELECT id, status, order_number FROM orders WHERE id = ?", [req.params.id]);
  if (!orders.length) throw notFound("Order not found.");

  const oldStatus = orders[0].status;
  await query("UPDATE orders SET status = ? WHERE id = ?", [status, req.params.id]);

  // Log status change
  await query(
    "INSERT INTO order_status_history (order_id, status, note, changed_by) VALUES (?, ?, ?, ?)",
    [req.params.id, status, note || null, req.user.id]
  );

  // If cancelled, restore stock
  if (status === "cancelled" && oldStatus !== "cancelled") {
    const items = await query("SELECT product_id, quantity FROM order_items WHERE order_id = ?", [req.params.id]);
    for (const item of items) {
      if (item.product_id) {
        await query("UPDATE products SET stock = stock + ? WHERE id = ?", [item.quantity, item.product_id]);
      }
    }
  }

  await logAdminAction(req.user.id, "order_status_update", "order", String(req.params.id), { from: oldStatus, to: status });

  return success(res, { orderId: req.params.id, status }, "Order status updated.");
}));

// ─── Order Detail (admin full view) ──────────────────────────────────────────
adminRoutes.get("/orders/:id", asyncHandler(async (req, res) => {
  const orders = await query("SELECT * FROM orders WHERE id = ?", [req.params.id]);
  if (!orders.length) throw notFound("Order not found.");
  const order = orders[0];

  const [items, history, payment] = await Promise.all([
    query("SELECT * FROM order_items WHERE order_id = ?", [order.id]),
    query("SELECT status, note, changed_by, created_at FROM order_status_history WHERE order_id = ? ORDER BY created_at ASC", [order.id]),
    query("SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1", [order.id])
  ]);

  return success(res, {
    order: {
      id: order.id,
      orderNumber: order.order_number,
      customer: {
        name: order.customer_name,
        phone: order.customer_phone,
        email: order.customer_email,
        address: order.shipping_address,
        city: order.city,
        postalCode: order.postal_code
      },
      paymentMethod: order.payment_method,
      status: order.status,
      trackingNumber: order.tracking_number || null,
      adminNotes: order.admin_notes || null,
      subtotal: order.subtotal,
      discount: order.discount || 0,
      couponCode: order.coupon_code || null,
      tax: order.tax,
      delivery: order.delivery,
      total: order.total,
      createdAt: order.created_at,
      items: items.map((i) => ({
        productId: i.product_id,
        productName: i.product_name,
        unitPrice: i.unit_price,
        quantity: i.quantity,
        lineTotal: i.line_total
      })),
      timeline: history.map((h) => ({ status: h.status, note: h.note, changedBy: h.changed_by, date: h.created_at })),
      payment: payment[0] ? {
        id: payment[0].id,
        transactionId: payment[0].transaction_id,
        gateway: payment[0].gateway,
        status: payment[0].status,
        amount: payment[0].amount_pkr
      } : null
    }
  }, "Order detail retrieved.");
}));

// ─── Update Tracking Number ──────────────────────────────────────────────────
adminRoutes.put("/orders/:id/tracking", asyncHandler(async (req, res) => {
  const { trackingNumber } = req.body;
  if (!trackingNumber) throw badRequest("trackingNumber is required.");

  const result = await query("UPDATE orders SET tracking_number = ? WHERE id = ?", [cleanString(trackingNumber), req.params.id]);
  if (!result.affectedRows) throw notFound("Order not found.");

  await logAdminAction(req.user.id, "tracking_added", "order", String(req.params.id), { trackingNumber });
  return success(res, null, "Tracking number updated.");
}));

// ─── Add Admin Notes to Order ────────────────────────────────────────────────
adminRoutes.put("/orders/:id/notes", asyncHandler(async (req, res) => {
  const { notes } = req.body;
  if (!notes) throw badRequest("notes is required.");

  const result = await query("UPDATE orders SET admin_notes = ? WHERE id = ?", [cleanString(notes), req.params.id]);
  if (!result.affectedRows) throw notFound("Order not found.");

  await logAdminAction(req.user.id, "order_note_added", "order", String(req.params.id));
  return success(res, null, "Admin notes updated.");
}));

// ═══════════════════════════════════════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════════════════════════════════════

adminRoutes.get("/users", asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const offset = (page - 1) * limit;

  const [rows, countRows] = await Promise.all([
    query(`
      SELECT u.id, u.name, u.email, u.role, u.is_banned, u.created_at, COUNT(o.id) AS orderCount
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.id
      GROUP BY u.id, u.name, u.email, u.role, u.is_banned, u.created_at
      ORDER BY u.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    query("SELECT COUNT(*) AS total FROM users")
  ]);

  return paginated(res, { users: rows.map(mapUserListItem) }, { page, limit, total: countRows[0]?.total || 0, totalPages: Math.ceil((countRows[0]?.total || 0) / limit) });
}));

adminRoutes.put("/users/:id/ban", asyncHandler(async (req, res) => {
  const { banned } = req.body;
  const result = await query("UPDATE users SET is_banned = ? WHERE id = ? AND role != 'admin'", [banned ? 1 : 0, req.params.id]);
  if (!result.affectedRows) throw notFound("User not found or cannot ban admin.");

  await logAdminAction(req.user.id, banned ? "user_banned" : "user_unbanned", "user", req.params.id);
  return success(res, null, `User ${banned ? "banned" : "unbanned"}.`);
}));

adminRoutes.get("/users/:id/orders", asyncHandler(async (req, res) => {
  const rows = await query(
    "SELECT id, order_number, status, total, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
    [req.params.id]
  );
  return success(res, { orders: rows.map(mapOrderListItem) }, "User orders retrieved.");
}));

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════════════════════════════════════

adminRoutes.post("/products", asyncHandler(async (req, res) => {
  const product = validateProductPayload(req.body);
  await query(`
    INSERT INTO products (
      id, name, slug, category_slug, subcategory, subtitle, price, compare_at,
      badge, image, brand, is_new, is_active, created, featured, stock
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    product.id, product.name, product.slug, product.category, product.subcategory, product.subtitle,
    product.price, product.compareAt, product.badge, product.image, product.brand,
    product.isNew ? 1 : 0, product.isActive ? 1 : 0, product.created, product.featured ? 1 : 0, product.stock
  ]);
  await replaceColors(product.id, product.colors);
  await logAdminAction(req.user.id, "product_created", "product", product.id);

  const rows = await query("SELECT p.*, c.name AS category_name FROM products p INNER JOIN categories c ON c.slug = p.category_slug WHERE p.id = ?", [product.id]);
  const products = await attachProductColors(rows);
  return created(res, { product: products[0] }, "Product created.");
}));

adminRoutes.put("/products/:id", asyncHandler(async (req, res) => {
  const product = validateProductPayload({ ...req.body, id: req.params.id });
  const result = await query(`
    UPDATE products
    SET name = ?, slug = ?, category_slug = ?, subcategory = ?, subtitle = ?, price = ?, compare_at = ?,
      badge = ?, image = ?, brand = ?, is_new = ?, is_active = ?, created = ?, featured = ?, stock = ?
    WHERE id = ? AND deleted_at IS NULL
  `, [
    product.name, product.slug, product.category, product.subcategory, product.subtitle,
    product.price, product.compareAt, product.badge, product.image, product.brand,
    product.isNew ? 1 : 0, product.isActive ? 1 : 0, product.created, product.featured ? 1 : 0, product.stock,
    product.id
  ]);
  if (!result.affectedRows) throw notFound("Product not found.");
  await replaceColors(product.id, product.colors);
  await logAdminAction(req.user.id, "product_updated", "product", product.id);

  const rows = await query("SELECT p.*, c.name AS category_name FROM products p INNER JOIN categories c ON c.slug = p.category_slug WHERE p.id = ?", [product.id]);
  const products = await attachProductColors(rows);
  return success(res, { product: products[0] }, "Product updated.");
}));

// Soft delete
adminRoutes.delete("/products/:id", asyncHandler(async (req, res) => {
  const result = await query("UPDATE products SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL", [req.params.id]);
  if (!result.affectedRows) throw notFound("Product not found.");
  await logAdminAction(req.user.id, "product_deleted", "product", req.params.id);
  return success(res, null, "Product deleted (soft).");
}));

// ─── Stock Adjustment ────────────────────────────────────────────────────────
adminRoutes.post("/products/:id/adjust-stock", asyncHandler(async (req, res) => {
  const { quantity, reason } = req.body;
  const newStock = Number(quantity);
  if (!Number.isInteger(newStock) || newStock < 0) throw badRequest("quantity must be a non-negative integer.");
  if (!reason || !reason.trim()) throw badRequest("reason is required.");

  const products = await query("SELECT id, stock FROM products WHERE id = ? AND deleted_at IS NULL", [req.params.id]);
  if (!products.length) throw notFound("Product not found.");

  const previousStock = products[0].stock;
  await query("UPDATE products SET stock = ? WHERE id = ?", [newStock, req.params.id]);

  await query(
    "INSERT INTO stock_adjustments (product_id, adjusted_by, previous_stock, new_stock, reason) VALUES (?, ?, ?, ?, ?)",
    [req.params.id, req.user.id, previousStock, newStock, cleanString(reason)]
  );

  await logAdminAction(req.user.id, "stock_adjusted", "product", req.params.id, { from: previousStock, to: newStock, reason });
  return success(res, { previousStock, newStock }, "Stock adjusted.");
}));

// ─── Stock Adjustment History ────────────────────────────────────────────────
adminRoutes.get("/products/:id/stock-history", asyncHandler(async (req, res) => {
  const rows = await query(`
    SELECT sa.*, u.name AS adjusted_by_name
    FROM stock_adjustments sa
    INNER JOIN users u ON u.id = sa.adjusted_by
    WHERE sa.product_id = ?
    ORDER BY sa.created_at DESC
    LIMIT 50
  `, [req.params.id]);

  return success(res, { adjustments: rows }, "Stock history retrieved.");
}));

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORIES (Admin CRUD)
// ═══════════════════════════════════════════════════════════════════════════════

adminRoutes.post("/categories", asyncHandler(async (req, res) => {
  const { name, slug, image, parentId, sortOrder } = req.body;
  if (!name || !slug || !image) throw badRequest("name, slug, and image are required.");

  const result = await query(
    "INSERT INTO categories (name, slug, image, parent_id, sort_order) VALUES (?, ?, ?, ?, ?)",
    [cleanString(name), cleanString(slug), cleanString(image), parentId || null, sortOrder || 0]
  );
  await logAdminAction(req.user.id, "category_created", "category", String(result.insertId));
  return created(res, { id: result.insertId, name, slug }, "Category created.");
}));

adminRoutes.put("/categories/:id", asyncHandler(async (req, res) => {
  const { name, slug, image, parentId, sortOrder } = req.body;
  const updates = [];
  const params = [];

  if (name) { updates.push("name = ?"); params.push(cleanString(name)); }
  if (slug) { updates.push("slug = ?"); params.push(cleanString(slug)); }
  if (image) { updates.push("image = ?"); params.push(cleanString(image)); }
  if (parentId !== undefined) { updates.push("parent_id = ?"); params.push(parentId || null); }
  if (sortOrder !== undefined) { updates.push("sort_order = ?"); params.push(sortOrder); }

  if (!updates.length) throw badRequest("No fields to update.");
  params.push(req.params.id);

  const result = await query(`UPDATE categories SET ${updates.join(", ")} WHERE id = ?`, params);
  if (!result.affectedRows) throw notFound("Category not found.");
  await logAdminAction(req.user.id, "category_updated", "category", req.params.id);
  return success(res, null, "Category updated.");
}));

adminRoutes.delete("/categories/:id", asyncHandler(async (req, res) => {
  const result = await query("DELETE FROM categories WHERE id = ?", [req.params.id]);
  if (!result.affectedRows) throw notFound("Category not found.");
  await logAdminAction(req.user.id, "category_deleted", "category", req.params.id);
  return success(res, null, "Category deleted.");
}));

// ═══════════════════════════════════════════════════════════════════════════════
// COUPONS
// ═══════════════════════════════════════════════════════════════════════════════

adminRoutes.get("/coupons", asyncHandler(async (req, res) => {
  const rows = await query("SELECT * FROM coupons ORDER BY created_at DESC");
  return success(res, { coupons: rows.map(mapCoupon) }, "Coupons retrieved.");
}));

adminRoutes.post("/coupons", asyncHandler(async (req, res) => {
  const { code, discountType, discountValue, minOrder, maxUses, expiresAt } = req.body;
  if (!code || !discountType || !discountValue) throw badRequest("code, discountType, and discountValue are required.");
  if (!["flat", "percent"].includes(discountType)) throw badRequest("discountType must be flat or percent.");

  const result = await query(
    "INSERT INTO coupons (code, discount_type, discount_value, min_order, max_uses, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    [code.toUpperCase().trim(), discountType, discountValue, minOrder || 0, maxUses || null, expiresAt || null]
  );
  await logAdminAction(req.user.id, "coupon_created", "coupon", String(result.insertId));
  return created(res, { id: result.insertId, code: code.toUpperCase().trim() }, "Coupon created.");
}));

adminRoutes.put("/coupons/:id", asyncHandler(async (req, res) => {
  const { code, discountType, discountValue, minOrder, maxUses, expiresAt, isActive } = req.body;
  const updates = [];
  const params = [];

  if (code) { updates.push("code = ?"); params.push(code.toUpperCase().trim()); }
  if (discountType) { updates.push("discount_type = ?"); params.push(discountType); }
  if (discountValue !== undefined) { updates.push("discount_value = ?"); params.push(discountValue); }
  if (minOrder !== undefined) { updates.push("min_order = ?"); params.push(minOrder); }
  if (maxUses !== undefined) { updates.push("max_uses = ?"); params.push(maxUses); }
  if (expiresAt !== undefined) { updates.push("expires_at = ?"); params.push(expiresAt || null); }
  if (isActive !== undefined) { updates.push("is_active = ?"); params.push(isActive ? 1 : 0); }

  if (!updates.length) throw badRequest("No fields to update.");
  params.push(req.params.id);

  const result = await query(`UPDATE coupons SET ${updates.join(", ")} WHERE id = ?`, params);
  if (!result.affectedRows) throw notFound("Coupon not found.");
  await logAdminAction(req.user.id, "coupon_updated", "coupon", req.params.id);
  return success(res, null, "Coupon updated.");
}));

adminRoutes.delete("/coupons/:id", asyncHandler(async (req, res) => {
  const result = await query("DELETE FROM coupons WHERE id = ?", [req.params.id]);
  if (!result.affectedRows) throw notFound("Coupon not found.");
  await logAdminAction(req.user.id, "coupon_deleted", "coupon", req.params.id);
  return success(res, null, "Coupon deleted.");
}));

// ═══════════════════════════════════════════════════════════════════════════════
// BANNERS
// ═══════════════════════════════════════════════════════════════════════════════

adminRoutes.get("/banners", asyncHandler(async (req, res) => {
  const rows = await query("SELECT * FROM banners ORDER BY display_order ASC");
  return success(res, { banners: rows.map(mapBanner) }, "Banners retrieved.");
}));

adminRoutes.post("/banners", asyncHandler(async (req, res) => {
  const { title, image, link, isActive, displayOrder } = req.body;
  if (!title || !image) throw badRequest("title and image are required.");

  const result = await query(
    "INSERT INTO banners (title, image, link, is_active, display_order) VALUES (?, ?, ?, ?, ?)",
    [cleanString(title), cleanString(image), link || null, isActive !== false ? 1 : 0, displayOrder || 0]
  );
  await logAdminAction(req.user.id, "banner_created", "banner", String(result.insertId));
  return created(res, { id: result.insertId }, "Banner created.");
}));

adminRoutes.put("/banners/:id", asyncHandler(async (req, res) => {
  const { title, image, link, isActive, displayOrder } = req.body;
  const updates = [];
  const params = [];

  if (title) { updates.push("title = ?"); params.push(cleanString(title)); }
  if (image) { updates.push("image = ?"); params.push(cleanString(image)); }
  if (link !== undefined) { updates.push("link = ?"); params.push(link || null); }
  if (isActive !== undefined) { updates.push("is_active = ?"); params.push(isActive ? 1 : 0); }
  if (displayOrder !== undefined) { updates.push("display_order = ?"); params.push(displayOrder); }

  if (!updates.length) throw badRequest("No fields to update.");
  params.push(req.params.id);

  const result = await query(`UPDATE banners SET ${updates.join(", ")} WHERE id = ?`, params);
  if (!result.affectedRows) throw notFound("Banner not found.");
  await logAdminAction(req.user.id, "banner_updated", "banner", req.params.id);
  return success(res, null, "Banner updated.");
}));

adminRoutes.delete("/banners/:id", asyncHandler(async (req, res) => {
  const result = await query("DELETE FROM banners WHERE id = ?", [req.params.id]);
  if (!result.affectedRows) throw notFound("Banner not found.");
  await logAdminAction(req.user.id, "banner_deleted", "banner", req.params.id);
  return success(res, null, "Banner deleted.");
}));

// ═══════════════════════════════════════════════════════════════════════════════
// REVIEWS (admin moderation)
// ═══════════════════════════════════════════════════════════════════════════════

adminRoutes.get("/reviews", asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const offset = (page - 1) * limit;

  const [rows, countRows] = await Promise.all([
    query(`SELECT id, product_id, user_id, name, rating, comment, status, created_at FROM reviews ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`),
    query("SELECT COUNT(*) AS total FROM reviews")
  ]);

  return paginated(res, { reviews: rows.map(mapReview) }, { page, limit, total: countRows[0]?.total || 0, totalPages: Math.ceil((countRows[0]?.total || 0) / limit) });
}));

adminRoutes.put("/reviews/:id/approve", asyncHandler(async (req, res) => {
  const result = await query("UPDATE reviews SET status = 'approved' WHERE id = ?", [req.params.id]);
  if (!result.affectedRows) throw notFound("Review not found.");
  await logAdminAction(req.user.id, "review_approved", "review", req.params.id);
  return success(res, null, "Review approved.");
}));

adminRoutes.put("/reviews/:id/reject", asyncHandler(async (req, res) => {
  const result = await query("UPDATE reviews SET status = 'rejected' WHERE id = ?", [req.params.id]);
  if (!result.affectedRows) throw notFound("Review not found.");
  await logAdminAction(req.user.id, "review_rejected", "review", req.params.id);
  return success(res, null, "Review rejected.");
}));

adminRoutes.delete("/reviews/:id", asyncHandler(async (req, res) => {
  const result = await query("DELETE FROM reviews WHERE id = ?", [req.params.id]);
  if (!result.affectedRows) throw notFound("Review not found.");
  await logAdminAction(req.user.id, "review_deleted", "review", req.params.id);
  return success(res, null, "Review deleted.");
}));

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMER EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

adminRoutes.get("/users/export", asyncHandler(async (req, res) => {
  const rows = await query(`
    SELECT u.id, u.name, u.email, u.phone, u.role, u.is_banned, u.created_at, COUNT(o.id) AS order_count, COALESCE(SUM(o.total), 0) AS total_spent
    FROM users u
    LEFT JOIN orders o ON o.user_id = u.id
    GROUP BY u.id, u.name, u.email, u.phone, u.role, u.is_banned, u.created_at
    ORDER BY u.created_at DESC
  `);

  // Return as CSV
  const header = "ID,Name,Email,Phone,Role,Banned,Registered,Orders,Total Spent (PKR)";
  const csvRows = rows.map((r) =>
    `${r.id},"${(r.name || "").replace(/"/g, '""')}","${r.email}","${r.phone || ""}",${r.role},${r.is_banned ? "Yes" : "No"},${r.created_at instanceof Date ? r.created_at.toISOString().slice(0, 10) : r.created_at},${r.order_count},${r.total_spent}`
  );
  const csv = [header, ...csvRows].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=customers-export.csv");
  res.send(csv);
}));

// ═══════════════════════════════════════════════════════════════════════════════
// INVENTORY OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════════

adminRoutes.get("/inventory", asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const offset = (page - 1) * limit;
  const sortBy = req.query.sort === "stock_asc" ? "p.stock ASC" : req.query.sort === "stock_desc" ? "p.stock DESC" : "p.stock ASC";

  const [rows, countRows] = await Promise.all([
    query(`
      SELECT p.id, p.name, p.image, p.stock, p.price, p.category_slug, p.is_active,
             (SELECT COALESCE(SUM(pc.stock), 0) FROM product_colors pc WHERE pc.product_id = p.id) AS variant_stock
      FROM products p
      WHERE p.deleted_at IS NULL
      ORDER BY ${sortBy}
      LIMIT ${limit} OFFSET ${offset}
    `),
    query("SELECT COUNT(*) AS total FROM products WHERE deleted_at IS NULL")
  ]);

  const totalValue = await query("SELECT COALESCE(SUM(price * stock), 0) AS value FROM products WHERE deleted_at IS NULL");

  return paginated(res, {
    products: rows.map((r) => ({
      id: r.id,
      name: r.name,
      image: r.image,
      stock: r.stock,
      variantStock: r.variant_stock || 0,
      price: r.price,
      category: r.category_slug,
      isActive: Boolean(r.is_active),
      stockValue: r.price * r.stock
    })),
    totalInventoryValue: totalValue[0]?.value || 0
  }, { page, limit, total: countRows[0]?.total || 0, totalPages: Math.ceil((countRows[0]?.total || 0) / limit) });
}));

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVITY LOG
// ═══════════════════════════════════════════════════════════════════════════════

adminRoutes.get("/activity-log", asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const offset = (page - 1) * limit;

  const [rows, countRows] = await Promise.all([
    query(`
      SELECT al.*, u.name AS admin_name
      FROM admin_activity_log al
      INNER JOIN users u ON u.id = al.admin_id
      ORDER BY al.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    query("SELECT COUNT(*) AS total FROM admin_activity_log")
  ]);

  return paginated(res, { logs: rows }, { page, limit, total: countRows[0]?.total || 0, totalPages: Math.ceil((countRows[0]?.total || 0) / limit) });
}));

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const replaceColors = async (productId, colors) => {
  await query("DELETE FROM product_colors WHERE product_id = ?", [productId]);
  for (const [index, color] of colors.entries()) {
    if (typeof color === "string") {
      await query("INSERT INTO product_colors (product_id, color, sort_order) VALUES (?, ?, ?)", [productId, color, index]);
    } else {
      await query("INSERT INTO product_colors (product_id, color, sku, stock, sort_order) VALUES (?, ?, ?, ?, ?)", [productId, color.color, color.sku || null, color.stock || 0, index]);
    }
  }
};

const validateProductPayload = (body) => {
  requireFields(body, ["id", "name", "category", "subcategory", "subtitle", "badge", "image", "created"]);
  const price = Number(body.price);
  const compareAt = Number(body.compareAt);
  const stock = Number(body.stock);
  if (!Number.isFinite(price) || price < 0) throw badRequest("Product price must be a valid number.");
  if (!Number.isFinite(compareAt) || compareAt < 0) throw badRequest("Compare price must be a valid number.");
  if (!Number.isInteger(stock) || stock < 0) throw badRequest("Stock must be a non-negative integer.");

  const name = cleanString(body.name);
  const slug = cleanString(body.slug) || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  return {
    id: cleanString(body.id),
    name,
    slug,
    category: cleanString(body.category),
    subcategory: cleanString(body.subcategory),
    subtitle: cleanString(body.subtitle),
    price,
    compareAt,
    badge: cleanString(body.badge),
    brand: cleanString(body.brand) || null,
    isNew: Boolean(body.isNew),
    isActive: body.isActive !== false,
    colors: Array.isArray(body.colors) ? body.colors : [],
    image: cleanString(body.image),
    created: cleanString(body.created),
    featured: Boolean(body.featured),
    stock
  };
};

const mapOrderListItem = (row) => ({
  id: row.id,
  orderNumber: row.order_number,
  customer: row.customer_name,
  email: row.customer_email,
  status: row.status,
  total: row.total,
  createdAt: row.created_at
});

const mapUserListItem = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role,
  isBanned: Boolean(row.is_banned),
  orderCount: row.orderCount,
  createdAt: row.created_at
});

const mapReview = (row) => ({
  id: row.id,
  productId: row.product_id,
  userId: row.user_id,
  name: row.name,
  rating: row.rating,
  comment: row.comment,
  status: row.status,
  date: row.created_at instanceof Date ? row.created_at.toISOString().slice(0, 10) : row.created_at
});

const mapCoupon = (row) => ({
  id: row.id,
  code: row.code,
  discountType: row.discount_type,
  discountValue: row.discount_value,
  minOrder: row.min_order,
  maxUses: row.max_uses,
  usedCount: row.used_count,
  expiresAt: row.expires_at,
  isActive: Boolean(row.is_active),
  createdAt: row.created_at
});

const mapBanner = (row) => ({
  id: row.id,
  title: row.title,
  image: row.image,
  link: row.link,
  isActive: Boolean(row.is_active),
  displayOrder: row.display_order,
  createdAt: row.created_at
});
