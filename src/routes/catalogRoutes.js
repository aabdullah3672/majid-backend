import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { getCategories, getProductById, getProducts } from "../services/catalogService.js";
import { query } from "../config/db.js";
import { notFound } from "../utils/httpError.js";
import { success, paginated } from "../utils/response.js";
import { productImageRoutes } from "./productImageRoutes.js";

export const catalogRoutes = Router();

// ─── Full catalog (homepage) ─────────────────────────────────────────────────
catalogRoutes.get("/", asyncHandler(async (req, res) => {
  const [categories, productResult, reviewRows] = await Promise.all([
    getCategories(),
    getProducts({ sort: "featured", pageSize: 100 }),
    query(`
      SELECT id, product_id, name, rating, comment, status, created_at
      FROM reviews
      WHERE status = 'approved'
      ORDER BY created_at DESC
      LIMIT 20
    `)
  ]);

  return success(res, {
    categories,
    products: productResult.products,
    reviews: reviewRows.map(mapReview)
  }, "Catalog loaded.");
}));

// ─── Categories ──────────────────────────────────────────────────────────────
catalogRoutes.get("/categories", asyncHandler(async (req, res) => {
  const categories = await getCategories();

  // Attach product counts
  const counts = await query(`
    SELECT category_slug, COUNT(*) AS product_count 
    FROM products 
    WHERE deleted_at IS NULL AND is_active = 1 
    GROUP BY category_slug
  `);
  const countMap = new Map(counts.map((r) => [r.category_slug, r.product_count]));

  const enriched = categories.map((cat) => ({
    ...cat,
    productCount: countMap.get(cat.slug) || 0
  }));

  return success(res, { categories: enriched }, "Categories retrieved.");
}));

// ─── Category products by slug ───────────────────────────────────────────────
catalogRoutes.get("/categories/:slug/products", asyncHandler(async (req, res) => {
  // Verify category exists
  const cats = await query("SELECT id, slug FROM categories WHERE slug = ?", [req.params.slug]);
  if (!cats.length) throw notFound("Category not found.");

  const result = await getProducts({ ...req.query, category: req.params.slug });
  return paginated(res, { products: result.products }, result.meta, "Products retrieved.");
}));

// ─── Products with full filtering ────────────────────────────────────────────
catalogRoutes.get("/products", asyncHandler(async (req, res) => {
  const result = await getProducts(req.query);
  return paginated(res, { products: result.products }, result.meta, "Products retrieved.");
}));

// ─── Single Product ──────────────────────────────────────────────────────────
catalogRoutes.get("/products/:id", asyncHandler(async (req, res) => {
  const product = await getProductById(req.params.id);

  // Attach images
  const images = await query(
    "SELECT id, url, is_primary, sort_order FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, sort_order ASC",
    [req.params.id]
  );

  // Attach reviews summary
  const reviewStats = await query(
    "SELECT COUNT(*) AS count, AVG(rating) AS avgRating FROM reviews WHERE product_id = ? AND status = 'approved'",
    [req.params.id]
  );

  return success(res, {
    product: {
      ...product,
      images: images.map((i) => ({ id: i.id, url: i.url, isPrimary: Boolean(i.is_primary) })),
      reviewCount: reviewStats[0]?.count || 0,
      avgRating: reviewStats[0]?.avgRating ? Number(reviewStats[0].avgRating.toFixed(1)) : 0
    }
  }, "Product retrieved.");
}));

// ─── Product Images (sub-router) ─────────────────────────────────────────────
catalogRoutes.use("/products/:id/images", productImageRoutes);

const mapReview = (row) => ({
  id: row.id,
  productId: row.product_id,
  name: row.name,
  rating: row.rating,
  comment: row.comment,
  status: row.status,
  date: row.created_at instanceof Date ? row.created_at.toISOString().slice(0, 10) : row.created_at
});
