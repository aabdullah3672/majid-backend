import { Router } from "express";
import { query, withTransaction } from "../config/db.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { badRequest, forbidden, notFound } from "../utils/httpError.js";
import { success, created } from "../utils/response.js";
import { cleanString, requireFields, validateEmail } from "../utils/validation.js";
import { sendOrderConfirmation, sendAdminOrderEmail } from "../services/emailService.js";
import { sendAdminOrderWhatsApp } from "../services/whatsappService.js";
import { notifyAdminNewOrder } from "../services/notificationService.js";

export const orderRoutes = Router();

// ─── Checkout / Create Order ─────────────────────────────────────────────────
orderRoutes.post("/", optionalAuth, asyncHandler(async (req, res) => {
  const customer = req.body?.customer || {};
  requireFields(customer, ["name", "phone", "email", "address", "city", "postal"]);
  validateEmail(customer.email);

  const items = normalizeItems(req.body?.items);
  const paymentMethod = cleanString(req.body?.paymentMethod || "Cash on Delivery");
  const couponCode = cleanString(req.body?.couponCode) || null;

  const order = await withTransaction(async (connection) => {
    const productIds = items.map((item) => item.id);
    const placeholders = productIds.map(() => "?").join(",");
    const [products] = await connection.execute(
      `SELECT id, name, price, stock FROM products WHERE id IN (${placeholders}) AND deleted_at IS NULL FOR UPDATE`,
      productIds
    );
    const byId = new Map(products.map((product) => [product.id, product]));

    const orderItems = items.map((item) => {
      const product = byId.get(item.id);
      if (!product) throw badRequest(`Product ${item.id} is not available.`);
      if (product.stock < item.quantity) {
        throw badRequest(`${product.name} has only ${product.stock} items in stock.`);
      }
      return {
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: product.price,
        lineTotal: product.price * item.quantity
      };
    });

    const subtotal = orderItems.reduce((sum, item) => sum + item.lineTotal, 0);

    // Apply coupon
    let discount = 0;
    if (couponCode) {
      const [coupons] = await connection.execute(
        "SELECT * FROM coupons WHERE code = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > NOW())",
        [couponCode.toUpperCase()]
      );
      if (coupons.length) {
        const coupon = coupons[0];
        if (subtotal >= coupon.min_order && (!coupon.max_uses || coupon.used_count < coupon.max_uses)) {
          discount = coupon.discount_type === "flat"
            ? coupon.discount_value
            : Math.round(subtotal * coupon.discount_value / 100);
          await connection.execute("UPDATE coupons SET used_count = used_count + 1 WHERE id = ?", [coupon.id]);
        }
      }
    }

    const tax = Math.round((subtotal - discount) * 0.05);
    const delivery = subtotal === 0 || subtotal >= 5000 ? 0 : 350;
    const total = Math.max(0, subtotal - discount) + tax + delivery;
    const orderNumber = `VX-${Date.now()}`;
    const status = paymentMethod === "Cash on Delivery" ? "pending" : "pending";

    const [orderResult] = await connection.execute(`
      INSERT INTO orders (
        order_number, user_id, customer_name, customer_phone, customer_email, shipping_address,
        city, postal_code, payment_method, status, subtotal, tax, delivery, discount, coupon_code, total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      orderNumber,
      req.user?.id || null,
      cleanString(customer.name),
      cleanString(customer.phone),
      cleanString(customer.email).toLowerCase(),
      cleanString(customer.address),
      cleanString(customer.city),
      cleanString(customer.postal),
      paymentMethod,
      status,
      subtotal,
      tax,
      delivery,
      discount,
      couponCode,
      total
    ]);

    for (const item of orderItems) {
      await connection.execute(`
        INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [orderResult.insertId, item.productId, item.productName, item.unitPrice, item.quantity, item.lineTotal]);
      // Deduct stock
      await connection.execute("UPDATE products SET stock = stock - ? WHERE id = ?", [item.quantity, item.productId]);
    }

    // Add initial status history
    await connection.execute(
      "INSERT INTO order_status_history (order_id, status, note) VALUES (?, ?, ?)",
      [orderResult.insertId, status, "Order placed"]
    );

    return {
      id: orderResult.insertId,
      orderNumber,
      customer: {
        name: cleanString(customer.name),
        phone: cleanString(customer.phone),
        email: cleanString(customer.email).toLowerCase(),
        address: cleanString(customer.address),
        city: cleanString(customer.city),
        postal: cleanString(customer.postal)
      },
      paymentMethod,
      items: orderItems,
      subtotal,
      discount,
      couponCode,
      tax,
      delivery,
      total,
      status
    };
  });

  // Send confirmation email to customer (non-blocking)
  sendOrderConfirmation(order).catch((err) => console.error("[EMAIL]", err.message));

  // Admin notifications (non-blocking)
  sendAdminOrderEmail(order).catch((err) => console.error("[ADMIN EMAIL]", err.message));
  sendAdminOrderWhatsApp(order).catch((err) => console.error("[WHATSAPP]", err.message));
  notifyAdminNewOrder(order).catch((err) => console.error("[TELEGRAM]", err.message));

  return created(res, { order }, "Order placed successfully.");
}));

// ─── Get Order Detail + Status Timeline ──────────────────────────────────────
orderRoutes.get("/:orderNumber", asyncHandler(async (req, res) => {
  const orders = await query("SELECT * FROM orders WHERE order_number = ? LIMIT 1", [req.params.orderNumber]);
  if (!orders.length) throw notFound("Order not found.");

  const [items, history] = await Promise.all([
    query("SELECT product_id, product_name, unit_price, quantity, line_total FROM order_items WHERE order_id = ?", [orders[0].id]),
    query("SELECT status, note, created_at FROM order_status_history WHERE order_id = ? ORDER BY created_at ASC", [orders[0].id])
  ]);

  return success(res, {
    order: mapOrder(orders[0], items),
    timeline: history.map((h) => ({ status: h.status, note: h.note, date: h.created_at }))
  }, "Order retrieved.");
}));

// ─── Cancel Order ────────────────────────────────────────────────────────────
orderRoutes.post("/:id/cancel", requireAuth, asyncHandler(async (req, res) => {
  const orders = await query("SELECT * FROM orders WHERE id = ? LIMIT 1", [req.params.id]);
  if (!orders.length) throw notFound("Order not found.");

  const order = orders[0];

  // Only owner or admin can cancel
  if (order.user_id !== req.user.id && req.user.role !== "admin") {
    throw forbidden("You can only cancel your own orders.");
  }

  // Only cancel if pending or processing
  if (!["pending", "processing"].includes(order.status)) {
    throw badRequest(`Cannot cancel an order with status "${order.status}". Only pending or processing orders can be cancelled.`);
  }

  await query("UPDATE orders SET status = 'cancelled' WHERE id = ?", [order.id]);

  // Restore stock
  const items = await query("SELECT product_id, quantity FROM order_items WHERE order_id = ?", [order.id]);
  for (const item of items) {
    if (item.product_id) {
      await query("UPDATE products SET stock = stock + ? WHERE id = ?", [item.quantity, item.product_id]);
    }
  }

  // Log status change
  await query(
    "INSERT INTO order_status_history (order_id, status, note, changed_by) VALUES (?, 'cancelled', 'Cancelled by user', ?)",
    [order.id, req.user.id]
  );

  return success(res, null, "Order cancelled. Stock restored.");
}));

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const normalizeItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw badRequest("Add at least one item before placing an order.");
  }

  return items.map((item) => {
    const quantity = Number(item.quantity);
    if (!item.id || !Number.isInteger(quantity) || quantity < 1) {
      throw badRequest("Each order item needs a product id and quantity of at least 1.");
    }
    return { id: String(item.id), quantity };
  });
};

const mapOrder = (row, items = []) => ({
  id: row.id,
  orderNumber: row.order_number,
  customer: {
    name: row.customer_name,
    phone: row.customer_phone,
    email: row.customer_email,
    address: row.shipping_address,
    city: row.city,
    postal: row.postal_code
  },
  paymentMethod: row.payment_method,
  status: row.status,
  subtotal: row.subtotal,
  discount: row.discount || 0,
  couponCode: row.coupon_code || null,
  tax: row.tax,
  delivery: row.delivery,
  total: row.total,
  createdAt: row.created_at,
  items: items.map((item) => ({
    productId: item.product_id,
    productName: item.product_name,
    unitPrice: item.unit_price,
    quantity: item.quantity,
    lineTotal: item.line_total
  }))
});
