import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { Router } from "express";
import { query } from "../config/db.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { mapUser, requireAuth, signAccessToken, signRefreshToken, verifyRefreshToken } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimiter.js";
import { badRequest, unauthorized } from "../utils/httpError.js";
import { success, created } from "../utils/response.js";
import { cleanString, requireFields, validateEmail, validatePassword } from "../utils/validation.js";
import { sendOtp, verifyOtp } from "../services/smsService.js";
import { sendPasswordReset } from "../services/emailService.js";

export const authRoutes = Router();

// Rate limit auth endpoints
authRoutes.use(authLimiter);

// ─── Register ──────────────────────────────────────────────────────────────
authRoutes.post("/register", asyncHandler(async (req, res) => {
  requireFields(req.body, ["name", "email", "password"]);
  const name = cleanString(req.body.name);
  const email = cleanString(req.body.email).toLowerCase();
  const password = String(req.body.password || "");

  validateEmail(email);
  validatePassword(password);

  const existing = await query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
  if (existing.length) {
    throw badRequest("An account with this email already exists.", { email: "Email is already registered." });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await query(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'customer')",
    [name, email, passwordHash]
  );
  const users = await query(
    "SELECT id, name, email, role, phone, gender, dob, avatar, is_banned, created_at FROM users WHERE id = ? LIMIT 1",
    [result.insertId]
  );
  const user = mapUser(users[0]);

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  // Store refresh token
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await query(
    "INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
    [user.id, refreshToken, expiresAt]
  );

  return created(res, { user, accessToken, refreshToken }, "Registration successful.");
}));

// ─── Login ──────────────────────────────────────────────────────────────────
authRoutes.post("/login", asyncHandler(async (req, res) => {
  requireFields(req.body, ["email", "password"]);
  const email = cleanString(req.body.email).toLowerCase();
  const password = String(req.body.password || "");

  const users = await query(
    "SELECT id, name, email, password_hash, role, phone, gender, dob, avatar, is_banned, created_at FROM users WHERE email = ? LIMIT 1",
    [email]
  );

  if (!users.length || !(await bcrypt.compare(password, users[0].password_hash))) {
    throw unauthorized("Invalid email or password.");
  }

  if (users[0].is_banned) {
    throw unauthorized("Your account has been suspended. Contact support.");
  }

  const user = mapUser(users[0]);
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await query(
    "INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
    [user.id, refreshToken, expiresAt]
  );

  return success(res, { user, accessToken, refreshToken }, "Login successful.");
}));

// ─── Refresh Token ───────────────────────────────────────────────────────────
authRoutes.post("/refresh", asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw badRequest("Refresh token is required.");

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw unauthorized("Invalid or expired refresh token.");
  }

  // Check if token exists in DB and is not expired
  const tokens = await query(
    "SELECT id FROM refresh_tokens WHERE user_id = ? AND token = ? AND expires_at > NOW() LIMIT 1",
    [payload.sub, refreshToken]
  );
  if (!tokens.length) throw unauthorized("Refresh token has been revoked.");

  // Delete old token (rotation)
  await query("DELETE FROM refresh_tokens WHERE id = ?", [tokens[0].id]);

  const users = await query(
    "SELECT id, name, email, role, phone, gender, dob, avatar, is_banned, created_at FROM users WHERE id = ? LIMIT 1",
    [payload.sub]
  );
  if (!users.length || users[0].is_banned) throw unauthorized("User not found or suspended.");

  const user = mapUser(users[0]);
  const newAccessToken = signAccessToken(user);
  const newRefreshToken = signRefreshToken(user);

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await query(
    "INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
    [user.id, newRefreshToken, expiresAt]
  );

  return success(res, { accessToken: newAccessToken, refreshToken: newRefreshToken }, "Token refreshed.");
}));

// ─── Send OTP ────────────────────────────────────────────────────────────────
// ─── Send OTP (email or phone) ───────────────────────────────────────────────
authRoutes.post("/send-otp", asyncHandler(async (req, res) => {
  const { email, phone } = req.body;

  // Accept either email or phone
  const identifier = email || phone;

  if (!identifier) {
    throw badRequest("Provide an email or phone number.");
  }

  // If it's a phone, validate Pakistani format
  if (phone && !/^\+92[0-9]{10}$/.test(phone)) {
    throw badRequest("Provide a valid Pakistani phone number in format: +923XXXXXXXXX");
  }

  // If it's an email, validate format
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest("Provide a valid email address.");
  }

  const result = await sendOtp(identifier, "verify");
  return success(res, result.code ? { code: result.code } : null, `OTP sent to ${email ? "your email" : "your phone"}.`);
}));

// ─── Verify OTP ──────────────────────────────────────────────────────────────
authRoutes.post("/verify-otp", asyncHandler(async (req, res) => {
  const { email, phone, code } = req.body;
  const identifier = email || phone;
  if (!identifier || !code) throw badRequest("Email/phone and code are required.");

  const valid = await verifyOtp(identifier, code, "verify");
  if (!valid) throw badRequest("Invalid or expired OTP.");

  return success(res, { verified: true }, "Verified successfully.");
}));

// ─── Forgot Password ─────────────────────────────────────────────────────────
authRoutes.post("/forgot-password", asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw badRequest("Email is required.");
  validateEmail(email);

  const users = await query("SELECT id, email FROM users WHERE email = ? LIMIT 1", [cleanString(email).toLowerCase()]);

  // Always return success to avoid email enumeration
  if (!users.length) {
    return success(res, null, "If an account exists, a password reset link has been sent.");
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // Invalidate previous tokens
  await query("UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0", [users[0].id]);

  await query(
    "INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)",
    [users[0].id, token, expiresAt]
  );

  await sendPasswordReset(users[0].email, token);

  return success(res, null, "If an account exists, a password reset link has been sent.");
}));

// ─── Reset Password ──────────────────────────────────────────────────────────
authRoutes.post("/reset-password", asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) throw badRequest("Token and new password are required.");
  validatePassword(password);

  const resets = await query(
    "SELECT id, user_id FROM password_resets WHERE token = ? AND used = 0 AND expires_at > NOW() LIMIT 1",
    [token]
  );
  if (!resets.length) throw badRequest("Invalid or expired reset token.");

  const passwordHash = await bcrypt.hash(password, 12);
  await query("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, resets[0].user_id]);
  await query("UPDATE password_resets SET used = 1 WHERE id = ?", [resets[0].id]);

  // Invalidate all refresh tokens for this user
  await query("DELETE FROM refresh_tokens WHERE user_id = ?", [resets[0].user_id]);

  return success(res, null, "Password reset successful. Please login with your new password.");
}));

// ─── Get Current User ────────────────────────────────────────────────────────
authRoutes.get("/me", requireAuth, (req, res) => {
  return success(res, { user: req.user }, "User profile retrieved.");
});
