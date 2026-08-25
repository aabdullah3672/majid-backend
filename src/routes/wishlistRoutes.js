import { Router } from "express";
import { query } from "../config/db.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { success } from "../utils/response.js";

export const wishlistRoutes = Router();
wishlistRoutes.use(requireAuth);

// ─── Get Wishlist ────────────────────────────────────────────────────────────
wishlistRoutes.get("/", asyncHandler(async (req, res) => {
  const rows = await query(`
    SELECT w.id, w.product_id, w.created_at, p.name, p.price, p.compare_at, p.image, p.stock, p.badge
    FROM wishlist w
    INNER JOIN products p ON p.id = w.product_id AND p.deleted_at IS NULL
    WHERE w.user_id = ?
    ORDER BY w.created_at DESC
  `, [req.user.id]);

  const items = rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    name: row.name,
    price: row.price,
    compareAt: row.compare_at,
    image: row.image,
    stock: row.stock,
    badge: row.badge,
    addedAt: row.created_at
  }));

  return success(res, { items }, "Wishlist retrieved.");
}));

// ─── Add to Wishlist ─────────────────────────────────────────────────────────
wishlistRoutes.post("/add", asyncHandler(async (req, res) => {
  const { productId } = req.body;
  if (!productId) throw badRequest("productId is required.");

  const products = await query("SELECT id FROM products WHERE id = ? AND deleted_at IS NULL", [productId]);
  if (!products.length) throw notFound("Product not found.");

  // Check if already in wishlist
  const existing = await query(
    "SELECT id FROM wishlist WHERE user_id = ? AND product_id = ?",
    [req.user.id, productId]
  );
  if (existing.length) throw badRequest("Product is already in your wishlist.");

  await query(
    "INSERT INTO wishlist (user_id, product_id) VALUES (?, ?)",
    [req.user.id, productId]
  );

  return success(res, null, "Added to wishlist.");
}));

// ─── Remove from Wishlist ────────────────────────────────────────────────────
wishlistRoutes.delete("/remove/:productId", asyncHandler(async (req, res) => {
  const result = await query(
    "DELETE FROM wishlist WHERE user_id = ? AND product_id = ?",
    [req.user.id, req.params.productId]
  );
  if (!result.affectedRows) throw notFound("Item not found in wishlist.");

  return success(res, null, "Removed from wishlist.");
}));
