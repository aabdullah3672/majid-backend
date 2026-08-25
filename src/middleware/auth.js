import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { query } from "../config/db.js";
import { forbidden, unauthorized } from "../utils/httpError.js";

export const signAccessToken = (user) => {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessExpiresIn }
  );
};

export const signRefreshToken = (user) => {
  return jwt.sign(
    { sub: user.id, type: "refresh" },
    env.jwt.refreshSecret,
    { expiresIn: env.jwt.refreshExpiresIn }
  );
};

/** Backward compat — returns access token */
export const signToken = (user) => signAccessToken(user);

export const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, env.jwt.accessSecret);
  } catch (err) {
    // Fallback: try the legacy secret if different
    if (env.jwt.secret !== env.jwt.accessSecret) {
      return jwt.verify(token, env.jwt.secret);
    }
    throw err;
  }
};

export const verifyRefreshToken = (token) => {
  return jwt.verify(token, env.jwt.refreshSecret);
};

export const requireAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const [, token] = header.split(" ");
    if (!token) throw unauthorized();

    const payload = verifyAccessToken(token);
    const users = await query(
      "SELECT id, name, email, role, phone, gender, dob, avatar, is_banned, created_at FROM users WHERE id = ? LIMIT 1",
      [payload.sub]
    );
    if (!users.length) throw unauthorized("User session is no longer valid.");
    if (users[0].is_banned) throw forbidden("Your account has been suspended.");

    req.user = mapUser(users[0]);
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      next(unauthorized("Invalid or expired token."));
      return;
    }
    next(error);
  }
};

/** Optional auth — attaches user if token present, otherwise continues */
export const optionalAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const [, token] = header.split(" ");
    if (!token) { next(); return; }

    const payload = verifyAccessToken(token);
    const users = await query(
      "SELECT id, name, email, role, phone, gender, dob, avatar, is_banned, created_at FROM users WHERE id = ? LIMIT 1",
      [payload.sub]
    );
    if (users.length && !users[0].is_banned) {
      req.user = mapUser(users[0]);
    }
  } catch {
    // Token invalid — continue as guest
  }
  next();
};

export const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    next(forbidden("Admin access is required."));
    return;
  }
  next();
};

export const mapUser = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  phone: row.phone || null,
  gender: row.gender || null,
  dob: row.dob || null,
  avatar: row.avatar || null,
  role: row.role,
  isBanned: Boolean(row.is_banned),
  createdAt: row.created_at
});
