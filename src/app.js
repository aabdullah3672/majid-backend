import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./config/db.js";
import { env } from "./config/env.js";
import { generalLimiter } from "./middleware/rateLimiter.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

// Route imports
import { adminRoutes } from "./routes/adminRoutes.js";
import { authRoutes } from "./routes/authRoutes.js";
import { cartRoutes } from "./routes/cartRoutes.js";
import { catalogRoutes } from "./routes/catalogRoutes.js";
import { contactRoutes } from "./routes/contactRoutes.js";
import { orderRoutes } from "./routes/orderRoutes.js";
import { paymentRoutes } from "./routes/paymentRoutes.js";
import { reviewRoutes } from "./routes/reviewRoutes.js";
import { searchRoutes } from "./routes/searchRoutes.js";
import { uploadRoutes } from "./routes/uploadRoutes.js";
import { userRoutes } from "./routes/userRoutes.js";
import { wishlistRoutes } from "./routes/wishlistRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();

app.set("env", env.nodeEnv);

// ─── Global Middleware ───────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin: env.clientOrigin,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Stripe webhook needs raw body for signature verification — must be before express.json()
app.use("/api/v1/payments/stripe/webhook", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "1mb" }));
app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
app.use(generalLimiter);

// ─── Serve uploaded images statically ────────────────────────────────────────
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// ─── Health Check ────────────────────────────────────────────────────────────
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ success: true, message: "OK", data: { status: "ok", database: "connected" }, errors: null });
  } catch (error) {
    res.status(503).json({
      success: false,
      message: "Database connection failed",
      data: { error: error.message, code: error.code },
      errors: null
    });
  }
});

// ─── API v1 Routes ───────────────────────────────────────────────────────────
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/upload", uploadRoutes);
app.use("/api/v1/user", userRoutes);
app.use("/api/v1/products", catalogRoutes);  // catalog includes /products, /categories, /products/:id/images
app.use("/api/v1/categories", catalogRoutes); // alias for category-first access
app.use("/api/v1/cart", cartRoutes);
app.use("/api/v1/orders", orderRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/reviews", reviewRoutes);
app.use("/api/v1/wishlist", wishlistRoutes);
app.use("/api/v1/search", searchRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/contact", contactRoutes);

// ─── Backward Compatible Routes (no /v1 prefix) ─────────────────────────────
app.use("/api/catalog", catalogRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/admin", adminRoutes);

// ─── 404 & Error Handling ────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);
