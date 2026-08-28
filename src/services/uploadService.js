import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");

// Configure Cloudinary if credentials exist
const useCloudinary = !!(env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret);

if (useCloudinary) {
  cloudinary.config({
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret
  });
  console.log("Cloudinary configured for image uploads.");
} else {
  console.log("Cloudinary not configured — using local file storage.");
}

/**
 * Upload to Cloudinary. Returns { url, publicId }.
 */
const uploadToCloudinary = (buffer, options = {}) => {
  return new Promise((resolve, reject) => {
    const folder = options.folder || "products";
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `techdealz/${folder}`,
        resource_type: "image",
        transformation: [{ quality: "auto", fetch_format: "auto" }]
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ url: result.secure_url, publicId: result.public_id, filename: result.public_id });
      }
    );
    stream.end(buffer);
  });
};

/**
 * Save an uploaded file buffer to the local uploads folder.
 */
export const saveFileLocally = async (buffer, options = {}) => {
  const subfolder = options.folder || "products";
  const dir = path.join(UPLOADS_DIR, subfolder);
  await fs.mkdir(dir, { recursive: true });

  const ext = options.extension || getExtension(options.mimetype) || "jpg";
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, buffer);

  const url = `/uploads/${subfolder}/${filename}`;
  return { url, filename, filePath };
};

/**
 * Delete a file — Cloudinary or local.
 */
export const deleteFile = async (url, publicId) => {
  if (publicId && useCloudinary) {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch {
      // Ignore deletion errors
    }
    return;
  }
  if (url && url.startsWith("/uploads/")) {
    const filePath = path.join(UPLOADS_DIR, url.replace("/uploads/", ""));
    try {
      await fs.unlink(filePath);
    } catch {
      // File may not exist
    }
  }
};

/**
 * Upload handler — uses Cloudinary if configured, otherwise local storage.
 */
export const uploadFile = async (buffer, options = {}) => {
  if (useCloudinary) {
    return uploadToCloudinary(buffer, options);
  }
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
