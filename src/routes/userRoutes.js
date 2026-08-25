import { Router } from "express";
import multer from "multer";
import { query } from "../config/db.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { success, created, paginated } from "../utils/response.js";
import { cleanString } from "../utils/validation.js";
import { uploadFile } from "../services/uploadService.js";

export const userRoutes = Router();
userRoutes.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ─── Get Profile ─────────────────────────────────────────────────────────────
userRoutes.get("/profile", asyncHandler(async (req, res) => {
  return success(res, { user: req.user }, "Profile retrieved.");
}));

// ─── Update Profile ──────────────────────────────────────────────────────────
userRoutes.put("/profile", asyncHandler(async (req, res) => {
  const { name, phone, gender, dob } = req.body;
  const updates = [];
  const params = [];

  if (name) { updates.push("name = ?"); params.push(cleanString(name)); }
  if (phone !== undefined) { updates.push("phone = ?"); params.push(cleanString(phone) || null); }
  if (gender !== undefined) {
    if (gender && !["male", "female", "other"].includes(gender)) {
      throw badRequest("Gender must be male, female, or other.");
    }
    updates.push("gender = ?");
    params.push(gender || null);
  }
  if (dob !== undefined) { updates.push("dob = ?"); params.push(dob || null); }

  if (!updates.length) throw badRequest("No fields to update.");

  params.push(req.user.id);
  await query(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, params);

  const users = await query(
    "SELECT id, name, email, role, phone, gender, dob, avatar, is_banned, created_at FROM users WHERE id = ?",
    [req.user.id]
  );

  return success(res, { user: mapUserProfile(users[0]) }, "Profile updated.");
}));

// ─── Upload Avatar ───────────────────────────────────────────────────────────
userRoutes.post("/avatar", upload.single("avatar"), asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest("No file uploaded.");

  const result = await uploadFile(req.file.buffer, {
    folder: "avatars",
    mimetype: req.file.mimetype
  });

  await query("UPDATE users SET avatar = ? WHERE id = ?", [result.url, req.user.id]);

  return success(res, { avatar: result.url }, "Avatar uploaded.");
}));

// ─── Addresses ───────────────────────────────────────────────────────────────
userRoutes.get("/addresses", asyncHandler(async (req, res) => {
  const rows = await query(
    "SELECT * FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC",
    [req.user.id]
  );
  return success(res, { addresses: rows.map(mapAddress) }, "Addresses retrieved.");
}));

userRoutes.post("/addresses", asyncHandler(async (req, res) => {
  const { label, address, city, postalCode, phone, isDefault } = req.body;
  if (!address || !city) throw badRequest("Address and city are required.");

  if (isDefault) {
    await query("UPDATE user_addresses SET is_default = 0 WHERE user_id = ?", [req.user.id]);
  }

  const result = await query(
    "INSERT INTO user_addresses (user_id, label, address, city, postal_code, phone, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [req.user.id, cleanString(label) || "Home", cleanString(address), cleanString(city), cleanString(postalCode) || null, cleanString(phone) || null, isDefault ? 1 : 0]
  );

  const rows = await query("SELECT * FROM user_addresses WHERE id = ?", [result.insertId]);
  return created(res, { address: mapAddress(rows[0]) }, "Address added.");
}));

userRoutes.put("/addresses/:id", asyncHandler(async (req, res) => {
  const existing = await query(
    "SELECT id FROM user_addresses WHERE id = ? AND user_id = ?",
    [req.params.id, req.user.id]
  );
  if (!existing.length) throw notFound("Address not found.");

  const { label, address, city, postalCode, phone, isDefault } = req.body;
  const updates = [];
  const params = [];

  if (label !== undefined) { updates.push("label = ?"); params.push(cleanString(label)); }
  if (address !== undefined) { updates.push("address = ?"); params.push(cleanString(address)); }
  if (city !== undefined) { updates.push("city = ?"); params.push(cleanString(city)); }
  if (postalCode !== undefined) { updates.push("postal_code = ?"); params.push(cleanString(postalCode) || null); }
  if (phone !== undefined) { updates.push("phone = ?"); params.push(cleanString(phone) || null); }
  if (isDefault !== undefined) {
    if (isDefault) {
      await query("UPDATE user_addresses SET is_default = 0 WHERE user_id = ?", [req.user.id]);
    }
    updates.push("is_default = ?");
    params.push(isDefault ? 1 : 0);
  }

  if (!updates.length) throw badRequest("No fields to update.");

  params.push(req.params.id);
  await query(`UPDATE user_addresses SET ${updates.join(", ")} WHERE id = ?`, params);

  const rows = await query("SELECT * FROM user_addresses WHERE id = ?", [req.params.id]);
  return success(res, { address: mapAddress(rows[0]) }, "Address updated.");
}));

// ─── User Orders ─────────────────────────────────────────────────────────────
userRoutes.get("/orders", asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  const offset = (page - 1) * limit;

  const [rows, countRows] = await Promise.all([
    query(
      `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      [req.user.id]
    ),
    query("SELECT COUNT(*) AS total FROM orders WHERE user_id = ?", [req.user.id])
  ]);

  const total = countRows[0]?.total || 0;

  return paginated(res, { orders: rows.map(mapOrderSummary) }, { page, limit, total, totalPages: Math.ceil(total / limit) });
}));

const mapAddress = (row) => ({
  id: row.id,
  label: row.label,
  address: row.address,
  city: row.city,
  postalCode: row.postal_code,
  phone: row.phone,
  isDefault: Boolean(row.is_default)
});

const mapUserProfile = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  phone: row.phone || null,
  gender: row.gender || null,
  dob: row.dob || null,
  avatar: row.avatar || null,
  role: row.role,
  createdAt: row.created_at
});

const mapOrderSummary = (row) => ({
  id: row.id,
  orderNumber: row.order_number,
  status: row.status,
  total: row.total,
  createdAt: row.created_at
});
