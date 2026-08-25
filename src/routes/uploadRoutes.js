import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { badRequest } from "../utils/httpError.js";
import { success } from "../utils/response.js";
import { uploadFile } from "../services/uploadService.js";

export const uploadRoutes = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed."));
  }
});

/**
 * POST /api/v1/upload
 * Upload a single image. Returns the URL to use in product forms.
 * Requires admin auth.
 */
uploadRoutes.post("/", requireAuth, requireAdmin, upload.single("image"), asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest("No image file uploaded. Send as multipart/form-data with field name 'image'.");

  const result = await uploadFile(req.file.buffer, {
    folder: req.body.folder || "products",
    mimetype: req.file.mimetype,
    extension: req.file.originalname?.split(".").pop()
  });

  return success(res, { url: result.url, filename: result.filename }, "Image uploaded.");
}));

/**
 * POST /api/v1/upload/multiple
 * Upload multiple images at once.
 */
uploadRoutes.post("/multiple", requireAuth, requireAdmin, upload.array("images", 10), asyncHandler(async (req, res) => {
  if (!req.files?.length) throw badRequest("No images uploaded.");

  const results = [];
  for (const file of req.files) {
    const result = await uploadFile(file.buffer, {
      folder: req.body.folder || "products",
      mimetype: file.mimetype,
      extension: file.originalname?.split(".").pop()
    });
    results.push({ url: result.url, filename: result.filename });
  }

  return success(res, { images: results }, `${results.length} image(s) uploaded.`);
}));
