import { query } from "../config/db.js";
import { notFound } from "../utils/httpError.js";

export const getCategories = async () => {
  const rows = await query(`
    SELECT c.id, c.name, c.slug, c.image, c.icon, c.parent_id, s.name AS subcategory
    FROM categories c
    LEFT JOIN subcategories s ON s.category_id = c.id
    ORDER BY c.sort_order ASC, c.name ASC, s.sort_order ASC, s.name ASC
  `);

  const categories = new Map();
  rows.forEach((row) => {
    if (!categories.has(row.slug)) {
      categories.set(row.slug, {
        id: row.id,
        name: row.name,
        slug: row.slug,
        image: row.image,
        icon: row.icon || null,
        parentId: row.parent_id || null,
        subcategories: []
      });
    }
    if (row.subcategory) {
      categories.get(row.slug).subcategories.push(row.subcategory);
    }
  });

  return [...categories.values()];
};

export const getProducts = async (filters = {}) => {
  const clauses = ["p.deleted_at IS NULL"];
  const params = [];

  // Only show active products for non-admin queries
  if (filters.includeInactive !== "true") {
    clauses.push("p.is_active = 1");
  }

  if (filters.category) {
    clauses.push("p.category_slug = ?");
    params.push(filters.category);
  }

  if (filters.subcategory) {
    clauses.push("p.subcategory = ?");
    params.push(filters.subcategory);
  }

  if (filters.featured === "true") {
    clauses.push("p.featured = 1");
  }

  if (filters.brand) {
    clauses.push("p.brand = ?");
    params.push(filters.brand);
  }

  if (filters.minPrice) {
    const min = Number(filters.minPrice);
    if (Number.isFinite(min)) {
      clauses.push("p.price >= ?");
      params.push(min);
    }
  }

  if (filters.maxPrice) {
    const max = Number(filters.maxPrice);
    if (Number.isFinite(max)) {
      clauses.push("p.price <= ?");
      params.push(max);
    }
  }

  if (filters.color) {
    clauses.push("EXISTS (SELECT 1 FROM product_colors pc WHERE pc.product_id = p.id AND pc.color = ?)");
    params.push(filters.color);
  }

  if (filters.rating) {
    const minRating = Number(filters.rating);
    if (Number.isFinite(minRating)) {
      clauses.push(`(SELECT AVG(r.rating) FROM reviews r WHERE r.product_id = p.id AND r.status = 'approved') >= ?`);
      params.push(minRating);
    }
  }

  if (filters.q) {
    clauses.push("(p.name LIKE ? OR p.subtitle LIKE ? OR p.subcategory LIKE ? OR c.name LIKE ? OR p.brand LIKE ?)");
    const pattern = `%${filters.q}%`;
    params.push(pattern, pattern, pattern, pattern, pattern);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const orderBy = getProductOrderBy(filters.sort);
  const page = Math.max(Number(filters.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(filters.pageSize || filters.limit) || 20, 1), 100);
  const offset = (page - 1) * pageSize;

  const rows = await query(`
    SELECT p.id, p.name, p.slug, p.category_slug, p.subcategory, p.subtitle, p.price, p.compare_at,
      p.badge, p.image, p.brand, p.is_new, p.is_active, p.created, p.featured, p.stock, c.name AS category_name
    FROM products p
    INNER JOIN categories c ON c.slug = p.category_slug
    ${where}
    ${orderBy}
    LIMIT ${pageSize} OFFSET ${offset}
  `, params);

  const totalRows = await query(`
    SELECT COUNT(*) AS total
    FROM products p
    INNER JOIN categories c ON c.slug = p.category_slug
    ${where}
  `, params);

  const products = await attachProductColors(rows);
  return {
    products,
    meta: {
      page,
      pageSize,
      total: totalRows[0]?.total || 0,
      totalPages: Math.max(1, Math.ceil((totalRows[0]?.total || 0) / pageSize))
    }
  };
};

export const getProductById = async (id) => {
  const rows = await query(`
    SELECT p.id, p.name, p.slug, p.category_slug, p.subcategory, p.subtitle, p.description, p.price, p.compare_at,
      p.badge, p.image, p.brand, p.is_new, p.is_active, p.created, p.featured, p.stock, c.name AS category_name
    FROM products p
    INNER JOIN categories c ON c.slug = p.category_slug
    WHERE p.id = ? AND p.deleted_at IS NULL
    LIMIT 1
  `, [id]);

  if (!rows.length) throw notFound("Product not found.");
  const products = await attachProductColors(rows);
  return products[0];
};

export const attachProductColors = async (rows) => {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(",");
  const colors = await query(
    `SELECT product_id, color, sku, stock FROM product_colors WHERE product_id IN (${placeholders}) ORDER BY sort_order ASC`,
    ids
  );
  const byProduct = new Map();
  colors.forEach((row) => {
    if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, []);
    byProduct.get(row.product_id).push({ color: row.color, sku: row.sku, stock: row.stock });
  });
  return rows.map((row) => mapProduct(row, byProduct.get(row.id) || []));
};

export const mapProduct = (row, colorVariants = []) => ({
  id: row.id,
  name: row.name,
  slug: row.slug || null,
  category: row.category_slug,
  categoryName: row.category_name,
  subcategory: row.subcategory,
  subtitle: row.subtitle,
  description: row.description || null,
  price: row.price,
  compareAt: row.compare_at,
  badge: row.badge,
  brand: row.brand || null,
  isNew: Boolean(row.is_new),
  isActive: Boolean(row.is_active),
  colors: colorVariants.map((c) => c.color),
  colorVariants,
  image: row.image,
  created: row.created instanceof Date ? row.created.toISOString().slice(0, 10) : row.created,
  featured: Boolean(row.featured),
  stock: row.stock
});

const getProductOrderBy = (sort) => {
  switch (sort) {
    case "newest": return "ORDER BY p.created DESC, p.name ASC";
    case "price_asc":
    case "price-asc": return "ORDER BY p.price ASC, p.name ASC";
    case "price_desc":
    case "price-desc": return "ORDER BY p.price DESC, p.name ASC";
    case "popular": return "ORDER BY p.featured DESC, p.stock DESC, p.name ASC";
    default: return "ORDER BY p.featured DESC, p.created DESC, p.name ASC";
  }
};
