import { Router } from "express";
import multer from "multer";
import { query } from "../config/db.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { success, created } from "../utils/response.js";
import { uploadFile, deleteLocalFile } from "../services/uploadService.js";

export const productImageRoutes = Router({ mergeParams: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed."));
  }
});

// ─── Get product images ──────────────────────────────────────────────────────
productImageRoutes.get("/", asyncHandler(async (req, res) => {
  const rows = await query(
    "SELECT * FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, sort_order ASC",
    [req.params.id]
  );
  return success(res, { images: rows.map(mapImage) }, "Images retrieved.");
}));

// ─── Upload images (admin only) ──────────────────────────────────────────────
productImageRoutes.post("/", requireAuth, requireAdmin, upload.array("images", 10), asyncHandler(async (req, res) => {
  const productId = req.params.id;

  const products = await query("SELECT id FROM products WHERE id = ? AND deleted_at IS NULL", [productId]);
  if (!products.length) throw notFound("Product not found.");

  if (!req.files || !req.files.length) throw badRequest("No images uploaded.");

  const isPrimary = req.body.is_primary === "true";
  const uploaded = [];

  for (const [index, file] of req.files.entries()) {
    const result = await uploadFile(file.buffer, {
      folder: `products/${productId}`,
      mimetype: file.mimetype,
      extension: file.originalname?.split(".").pop()
    });

    const markPrimary = isPrimary && index === 0;
    if (markPrimary) {
      await query("UPDATE product_images SET is_primary = 0 WHERE product_id = ?", [productId]);
    }

    const insertResult = await query(
      "INSERT INTO product_images (product_id, url, public_id, is_primary, sort_order) VALUES (?, ?, ?, ?, ?)",
      [productId, result.url, result.filename, markPrimary ? 1 : 0, index]
    );

    uploaded.push({
      id: insertResult.insertId,
      url: result.url,
      isPrimary: markPrimary
    });
  }

  return created(res, { images: uploaded }, `${uploaded.length} image(s) uploaded.`);
}));

// ─── Delete an image (admin only) ────────────────────────────────────────────
productImageRoutes.delete("/:imageId", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const rows = await query(
    "SELECT * FROM product_images WHERE id = ? AND product_id = ?",
    [req.params.imageId, req.params.id]
  );
  if (!rows.length) throw notFound("Image not found.");

  // Delete from disk
  await deleteLocalFile(rows[0].url);
  await query("DELETE FROM product_images WHERE id = ?", [req.params.imageId]);

  return success(res, null, "Image deleted.");
}));

const mapImage = (row) => ({
  id: row.id,
  url: row.url,
  isPrimary: Boolean(row.is_primary),
  sortOrder: row.sort_order
});
