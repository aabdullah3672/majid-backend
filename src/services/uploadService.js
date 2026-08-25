import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");

/**
 * Save an uploaded file buffer to the local uploads folder.
 * Returns { url, filename } where url is the public path accessible via Express static.
 */
export const saveFileLocally = async (buffer, options = {}) => {
  const subfolder = options.folder || "products";
  const dir = path.join(UPLOADS_DIR, subfolder);

  // Ensure directory exists
  await fs.mkdir(dir, { recursive: true });

  // Generate unique filename
  const ext = options.extension || getExtension(options.mimetype) || "jpg";
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  const filePath = path.join(dir, filename);

  await fs.writeFile(filePath, buffer);

  // Return the URL path relative to the static serve root
  const url = `/uploads/${subfolder}/${filename}`;
  return { url, filename, filePath };
};

/**
 * Delete a locally stored file by its URL path.
 */
export const deleteLocalFile = async (url) => {
  if (!url || !url.startsWith("/uploads/")) return;
  const filePath = path.join(UPLOADS_DIR, url.replace("/uploads/", ""));
  try {
    await fs.unlink(filePath);
  } catch {
    // File may not exist, that's okay
  }
};

/**
 * Upload handler — saves locally. If Cloudinary is configured, uses that instead.
 * For this project we default to local storage.
 */
export const uploadFile = async (buffer, options = {}) => {
  return saveFileLocally(buffer, options);
};

function getExtension(mimetype) {
  if (!mimetype) return "jpg";
  const map = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg"
  };
  return map[mimetype] || "jpg";
}
