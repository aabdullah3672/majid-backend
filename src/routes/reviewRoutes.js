import { Router } from "express";
import { query } from "../config/db.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { optionalAuth, requireAuth, requireAdmin } from "../middleware/auth.js";
import { badRequest, forbidden, notFound } from "../utils/httpError.js";
import { success, created, paginated } from "../utils/response.js";
import { cleanString, requireFields } from "../utils/validation.js";

export const reviewRoutes = Router();

// ─── Get Reviews (public, paginated) ─────────────────────────────────────────
reviewRoutes.get("/", asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  const offset = (page - 1) * limit;
  const productId = req.query.productId || null;

  const whereClause = productId
    ? "WHERE status = 'approved' AND product_id = ?"
    : "WHERE status = 'approved'";
  const params = productId ? [productId] : [];

  const [rows, countRows] = await Promise.all([
    query(`SELECT id, product_id, user_id, name, rating, comment, status, created_at FROM reviews ${whereClause} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, params),
    query(`SELECT COUNT(*) AS total FROM reviews ${whereClause}`, params)
  ]);

  // Average rating
  const avgRows = await query(`SELECT AVG(rating) AS avg, COUNT(*) AS count FROM reviews ${whereClause}`, params);
  const total = countRows[0]?.total || 0;

  return paginated(res, {
    reviews: rows.map(mapReview),
    avgRating: avgRows[0]?.avg ? Number(Number(avgRows[0].avg).toFixed(1)) : 0,
    totalReviews: total
  }, { page, limit, total, totalPages: Math.ceil(total / limit) });
}));

// ─── Get product reviews ──────────────────────────────────────────────────────
reviewRoutes.get("/product/:productId", asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  const offset = (page - 1) * limit;

  const [rows, countRows, avgRows] = await Promise.all([
    query(`SELECT id, product_id, user_id, name, rating, comment, created_at FROM reviews WHERE product_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, [req.params.productId]),
    query("SELECT COUNT(*) AS total FROM reviews WHERE product_id = ? AND status = 'approved'", [req.params.productId]),
    query("SELECT AVG(rating) AS avg FROM reviews WHERE product_id = ? AND status = 'approved'", [req.params.productId])
  ]);

  const total = countRows[0]?.total || 0;
  return paginated(res, {
    reviews: rows.map(mapReview),
    avgRating: avgRows[0]?.avg ? Number(Number(avgRows[0].avg).toFixed(1)) : 0
  }, { page, limit, total, totalPages: Math.ceil(total / limit) });
}));

// ─── Submit Review (requires auth + purchase verification) ────────────────────
reviewRoutes.post("/", requireAuth, asyncHandler(async (req, res) => {
  requireFields(req.body, ["comment"]);
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw badRequest("Rating must be between 1 and 5.", { rating: "Choose a rating from 1 to 5." });
  }

  const productId = cleanString(req.body.productId) || null;

  if (productId) {
    // Verify product exists
    const products = await query("SELECT id FROM products WHERE id = ? AND deleted_at IS NULL LIMIT 1", [productId]);
    if (!products.length) throw badRequest("Selected product does not exist.");

    // Check one review per user per product
    const existingReview = await query(
      "SELECT id FROM reviews WHERE user_id = ? AND product_id = ?",
      [req.user.id, productId]
    );
    if (existingReview.length) throw badRequest("You have already reviewed this product.");

    // Verify purchase (user must have ordered this product in a delivered order)
    const purchased = await query(`
      SELECT oi.id FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      WHERE o.user_id = ? AND oi.product_id = ? AND o.status IN ('delivered', 'processing', 'shipped')
      LIMIT 1
    `, [req.user.id, productId]);
    if (!purchased.length) throw forbidden("You can only review products you have purchased.");
  }

  const result = await query(
    "INSERT INTO reviews (product_id, user_id, name, rating, comment, status) VALUES (?, ?, ?, ?, ?, 'pending')",
    [productId, req.user.id, req.user.name, rating, cleanString(req.body.comment)]
  );
  const rows = await query("SELECT id, product_id, user_id, name, rating, comment, status, created_at FROM reviews WHERE id = ?", [result.insertId]);

  return created(res, { review: mapReview(rows[0]) }, "Review submitted for moderation.");
}));

// ─── Admin: Approve/Reject (backward compat with old route) ──────────────────
reviewRoutes.patch("/:id/moderation", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const status = cleanString(req.body.status);
  if (!["pending", "approved", "rejected"].includes(status)) {
    throw badRequest("Status must be pending, approved, or rejected.");
  }

  const result = await query("UPDATE reviews SET status = ? WHERE id = ?", [status, req.params.id]);
  if (!result.affectedRows) throw notFound("Review not found.");

  const rows = await query("SELECT id, product_id, user_id, name, rating, comment, status, created_at FROM reviews WHERE id = ?", [req.params.id]);
  return success(res, { review: mapReview(rows[0]) }, `Review ${status}.`);
}));

const mapReview = (row) => ({
  id: row.id,
  productId: row.product_id,
  userId: row.user_id || null,
  name: row.name,
  rating: row.rating,
  comment: row.comment,
  status: row.status,
  date: row.created_at instanceof Date ? row.created_at.toISOString().slice(0, 10) : row.created_at
});
