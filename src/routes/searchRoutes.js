import { Router } from "express";
import { query } from "../config/db.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { optionalAuth } from "../middleware/auth.js";
import { badRequest } from "../utils/httpError.js";
import { success } from "../utils/response.js";

export const searchRoutes = Router();
searchRoutes.use(optionalAuth);

// ─── Search Products ─────────────────────────────────────────────────────────
searchRoutes.get("/", asyncHandler(async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) throw badRequest("Search query is required (?q=)");

  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  const offset = (page - 1) * limit;

  const pattern = `%${q}%`;

  const [rows, countRows, categoryRows] = await Promise.all([
    query(`
      SELECT p.id, p.name, p.price, p.compare_at, p.image, p.badge, p.category_slug, c.name AS category_name
      FROM products p
      INNER JOIN categories c ON c.slug = p.category_slug
      WHERE p.deleted_at IS NULL AND p.is_active = 1
        AND (p.name LIKE ? OR p.subtitle LIKE ? OR p.subcategory LIKE ? OR c.name LIKE ?)
      ORDER BY p.featured DESC, p.created DESC
      LIMIT ${limit} OFFSET ${offset}
    `, [pattern, pattern, pattern, pattern]),
    query(`
      SELECT COUNT(*) AS total
      FROM products p
      INNER JOIN categories c ON c.slug = p.category_slug
      WHERE p.deleted_at IS NULL AND p.is_active = 1
        AND (p.name LIKE ? OR p.subtitle LIKE ? OR p.subcategory LIKE ? OR c.name LIKE ?)
    `, [pattern, pattern, pattern, pattern]),
    query(`
      SELECT DISTINCT c.name, c.slug
      FROM products p
      INNER JOIN categories c ON c.slug = p.category_slug
      WHERE p.deleted_at IS NULL AND p.is_active = 1
        AND (p.name LIKE ? OR p.subtitle LIKE ? OR p.subcategory LIKE ? OR c.name LIKE ?)
      LIMIT 5
    `, [pattern, pattern, pattern, pattern])
  ]);

  // Store search history
  if (req.user) {
    try {
      await query("INSERT INTO search_history (user_id, query_text) VALUES (?, ?)", [req.user.id, q]);
    } catch { /* non-critical */ }
  }

  const products = rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: row.price,
    compareAt: row.compare_at,
    image: row.image,
    badge: row.badge,
    category: row.category_slug,
    categoryName: row.category_name
  }));

  const suggestedCategories = categoryRows.map((row) => ({ name: row.name, slug: row.slug }));
  const total = countRows[0]?.total || 0;

  return success(res, {
    products,
    suggestedCategories,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) }
  }, `Found ${total} results.`);
}));
