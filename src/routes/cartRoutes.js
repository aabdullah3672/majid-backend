import { Router } from "express";
import { query } from "../config/db.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { optionalAuth } from "../middleware/auth.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { success } from "../utils/response.js";

export const cartRoutes = Router();
cartRoutes.use(optionalAuth);

const getCartOwner = (req) => {
  if (req.user) return { userId: req.user.id, deviceId: null };
  const deviceId = req.headers["x-device-id"];
  if (!deviceId) return { userId: null, deviceId: null };
  return { userId: null, deviceId };
};

const getCartWhere = (owner) => {
  if (owner.userId) return { clause: "user_id = ?", param: owner.userId };
  if (owner.deviceId) return { clause: "device_id = ? AND user_id IS NULL", param: owner.deviceId };
  return null;
};

// ─── Get Cart ────────────────────────────────────────────────────────────────
cartRoutes.get("/", asyncHandler(async (req, res) => {
  const owner = getCartOwner(req);
  const where = getCartWhere(owner);
  if (!where) return success(res, buildCartResponse([]), "Cart is empty.");

  const rows = await query(`
    SELECT ci.id, ci.product_id, ci.quantity, p.name, p.price, p.compare_at, p.image, p.stock
    FROM cart_items ci
    INNER JOIN products p ON p.id = ci.product_id AND p.deleted_at IS NULL
    WHERE ci.${where.clause}
  `, [where.param]);

  // Check for applied coupon in session (stored in query param or header for simplicity)
  return success(res, buildCartResponse(rows), "Cart retrieved.");
}));

// ─── Add to Cart ─────────────────────────────────────────────────────────────
cartRoutes.post("/add", asyncHandler(async (req, res) => {
  const { productId, quantity = 1 } = req.body;
  if (!productId) throw badRequest("productId is required.");
  const qty = Math.max(Number(quantity) || 1, 1);

  const owner = getCartOwner(req);
  if (!owner.userId && !owner.deviceId) throw badRequest("Login or provide x-device-id header.");

  // Verify product exists and has stock
  const products = await query("SELECT id, stock FROM products WHERE id = ? AND deleted_at IS NULL", [productId]);
  if (!products.length) throw notFound("Product not found.");
  if (products[0].stock < qty) throw badRequest("Insufficient stock.");

  // Check if already in cart
  const where = getCartWhere(owner);
  const existing = await query(
    `SELECT id, quantity FROM cart_items WHERE product_id = ? AND ${where.clause}`,
    [productId, where.param]
  );

  if (existing.length) {
    const newQty = existing[0].quantity + qty;
    if (newQty > products[0].stock) throw badRequest("Cannot exceed available stock.");
    await query("UPDATE cart_items SET quantity = ? WHERE id = ?", [newQty, existing[0].id]);
  } else {
    await query(
      "INSERT INTO cart_items (user_id, device_id, product_id, quantity) VALUES (?, ?, ?, ?)",
      [owner.userId, owner.deviceId, productId, qty]
    );
  }

  return success(res, null, "Item added to cart.");
}));

// ─── Update Cart Item ────────────────────────────────────────────────────────
cartRoutes.put("/update/:itemId", asyncHandler(async (req, res) => {
  const { quantity } = req.body;
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) throw badRequest("Quantity must be at least 1.");

  const owner = getCartOwner(req);
  const where = getCartWhere(owner);
  if (!where) throw badRequest("Login or provide x-device-id header.");

  const rows = await query(
    `SELECT ci.id, ci.product_id, p.stock FROM cart_items ci INNER JOIN products p ON p.id = ci.product_id WHERE ci.id = ? AND ci.${where.clause}`,
    [req.params.itemId, where.param]
  );
  if (!rows.length) throw notFound("Cart item not found.");
  if (qty > rows[0].stock) throw badRequest("Cannot exceed available stock.");

  await query("UPDATE cart_items SET quantity = ? WHERE id = ?", [qty, req.params.itemId]);
  return success(res, null, "Cart updated.");
}));

// ─── Remove Cart Item ────────────────────────────────────────────────────────
cartRoutes.delete("/remove/:itemId", asyncHandler(async (req, res) => {
  const owner = getCartOwner(req);
  const where = getCartWhere(owner);
  if (!where) throw badRequest("Login or provide x-device-id header.");

  const result = await query(
    `DELETE FROM cart_items WHERE id = ? AND ${where.clause}`,
    [req.params.itemId, where.param]
  );
  if (!result.affectedRows) throw notFound("Cart item not found.");

  return success(res, null, "Item removed from cart.");
}));

// ─── Apply Coupon ────────────────────────────────────────────────────────────
cartRoutes.post("/apply-coupon", asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) throw badRequest("Coupon code is required.");

  const coupons = await query(
    "SELECT * FROM coupons WHERE code = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > NOW())",
    [code.toUpperCase().trim()]
  );
  if (!coupons.length) throw badRequest("Invalid or expired coupon code.");

  const coupon = coupons[0];
  if (coupon.max_uses && coupon.used_count >= coupon.max_uses) {
    throw badRequest("This coupon has reached its usage limit.");
  }

  // Get current cart subtotal
  const owner = getCartOwner(req);
  const where = getCartWhere(owner);
  if (!where) throw badRequest("Cart is empty.");

  const rows = await query(`
    SELECT ci.quantity, p.price
    FROM cart_items ci
    INNER JOIN products p ON p.id = ci.product_id
    WHERE ci.${where.clause}
  `, [where.param]);

  const subtotal = rows.reduce((sum, r) => sum + r.price * r.quantity, 0);
  if (subtotal < coupon.min_order) {
    throw badRequest(`Minimum order of Rs ${coupon.min_order.toLocaleString()} required for this coupon.`);
  }

  let discount = 0;
  if (coupon.discount_type === "flat") {
    discount = coupon.discount_value;
  } else {
    discount = Math.round(subtotal * coupon.discount_value / 100);
  }

  return success(res, {
    coupon: { code: coupon.code, discountType: coupon.discount_type, discountValue: coupon.discount_value },
    discount,
    subtotal,
    total: Math.max(0, subtotal - discount)
  }, "Coupon applied.");
}));

// ─── Merge guest cart to user on login ───────────────────────────────────────
export const mergeGuestCart = async (userId, deviceId) => {
  if (!deviceId) return;

  const guestItems = await query(
    "SELECT product_id, quantity FROM cart_items WHERE device_id = ? AND user_id IS NULL",
    [deviceId]
  );

  for (const item of guestItems) {
    const existing = await query(
      "SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ?",
      [userId, item.product_id]
    );
    if (existing.length) {
      await query("UPDATE cart_items SET quantity = quantity + ? WHERE id = ?", [item.quantity, existing[0].id]);
    } else {
      await query(
        "INSERT INTO cart_items (user_id, device_id, product_id, quantity) VALUES (?, NULL, ?, ?)",
        [userId, item.product_id, item.quantity]
      );
    }
  }

  await query("DELETE FROM cart_items WHERE device_id = ? AND user_id IS NULL", [deviceId]);
};

const buildCartResponse = (rows) => {
  const items = rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    name: row.name,
    price: row.price,
    compareAt: row.compare_at,
    image: row.image,
    quantity: row.quantity,
    stock: row.stock,
    lineTotal: row.price * row.quantity
  }));

  const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
  const shippingEstimate = subtotal >= 5000 ? 0 : 350;

  return {
    items,
    subtotal,
    discount: 0,
    shippingEstimate,
    total: subtotal + shippingEstimate
  };
};
