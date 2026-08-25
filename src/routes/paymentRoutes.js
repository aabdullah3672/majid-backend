import crypto from "node:crypto";
import { Router } from "express";
import Stripe from "stripe";
import { query } from "../config/db.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { optionalAuth } from "../middleware/auth.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { success } from "../utils/response.js";
import { env } from "../config/env.js";

export const paymentRoutes = Router();

// Initialize Stripe (only if key is configured)
const stripe = env.stripe.secretKey ? new Stripe(env.stripe.secretKey) : null;

const PAYMENT_METHODS = [
  { id: "cod", name: "Cash on Delivery", gateway: "cod", description: "Pay when you receive your order" },
  { id: "card", name: "Credit/Debit Card", gateway: "stripe", description: "Pay securely with Visa, Mastercard, or other cards" },
  { id: "jazzcash", name: "JazzCash", gateway: "jazzcash", description: "Pay via JazzCash mobile wallet" },
  { id: "easypaisa", name: "Easypaisa", gateway: "easypaisa", description: "Pay via Easypaisa mobile wallet" },
  { id: "1link", name: "1LINK", gateway: "bank", description: "Online bank transfer via 1LINK" },
  { id: "hbl", name: "HBL", gateway: "bank", description: "Habib Bank Limited online payment" },
  { id: "meezan", name: "Meezan Bank", gateway: "bank", description: "Meezan Bank online payment" },
  { id: "ubl", name: "UBL", gateway: "bank", description: "United Bank Limited online payment" }
];

// ─── Get Payment Methods ─────────────────────────────────────────────────────
paymentRoutes.get("/methods", (req, res) => {
  // Only include card method if Stripe is configured
  const methods = stripe
    ? PAYMENT_METHODS
    : PAYMENT_METHODS.filter((m) => m.id !== "card");
  return success(res, { methods, stripePublishableKey: env.stripe.publishableKey || null }, "Payment methods retrieved.");
});

// ─── Initiate Payment ────────────────────────────────────────────────────────
paymentRoutes.post("/initiate", optionalAuth, asyncHandler(async (req, res) => {
  const { orderId, method } = req.body;
  if (!orderId || !method) throw badRequest("orderId and method are required.");

  const orders = await query("SELECT * FROM orders WHERE id = ?", [orderId]);
  if (!orders.length) throw notFound("Order not found.");
  const order = orders[0];

  const selectedMethod = PAYMENT_METHODS.find((m) => m.id === method);
  if (!selectedMethod) throw badRequest("Invalid payment method.");

  // ─── COD ─────────────────────────────────────────────────────────────────
  if (method === "cod") {
    await query("UPDATE orders SET status = 'pending', payment_method = 'Cash on Delivery' WHERE id = ?", [orderId]);
    await query(
      "INSERT INTO payments (order_id, gateway, status, amount_pkr) VALUES (?, 'cod', 'paid', ?)",
      [orderId, order.total]
    );
    return success(res, { status: "confirmed", redirectUrl: null }, "COD order confirmed.");
  }

  // ─── Card (Stripe) ──────────────────────────────────────────────────────
  if (method === "card") {
    if (!stripe) throw badRequest("Card payments are not configured. Please contact support.");

    // Check if there's already a pending payment intent for this order
    const existingPayments = await query(
      "SELECT transaction_id FROM payments WHERE order_id = ? AND gateway = 'stripe' AND status = 'pending'",
      [orderId]
    );

    if (existingPayments.length && existingPayments[0].transaction_id) {
      // Retrieve existing payment intent instead of creating a new one
      try {
        const existingIntent = await stripe.paymentIntents.retrieve(existingPayments[0].transaction_id);
        if (existingIntent.status === "requires_payment_method" || existingIntent.status === "requires_confirmation") {
          return success(res, {
            status: "requires_payment",
            gateway: "stripe",
            clientSecret: existingIntent.client_secret,
            paymentIntentId: existingIntent.id,
            amount: order.total,
            currency: "pkr"
          }, "Use client secret to complete card payment.");
        }
      } catch {
        // If retrieval fails, create a new one
      }
    }

    // Create a Stripe Payment Intent
    // Amount is in smallest currency unit (paisa for PKR — 1 PKR = 100 paisa)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: order.total * 100,
      currency: "pkr",
      metadata: {
        orderId: String(order.id),
        orderNumber: order.order_number
      },
      description: `VoltXpress Order ${order.order_number}`,
      automatic_payment_methods: { enabled: true }
    });

    // Store pending payment record
    await query(
      "INSERT INTO payments (order_id, transaction_id, gateway, status, amount_pkr) VALUES (?, ?, 'stripe', 'pending', ?)",
      [orderId, paymentIntent.id, order.total]
    );

    await query("UPDATE orders SET payment_method = 'Credit/Debit Card' WHERE id = ?", [orderId]);

    return success(res, {
      status: "requires_payment",
      gateway: "stripe",
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: order.total,
      currency: "pkr"
    }, "Use client secret to complete card payment.");
  }

  // ─── JazzCash ────────────────────────────────────────────────────────────
  if (method === "jazzcash") {
    const txnId = `VX${Date.now()}`;
    const dateTime = formatJazzDate(new Date());
    const expiryDateTime = formatJazzDate(new Date(Date.now() + 30 * 60 * 1000));

    await query(
      "INSERT INTO payments (order_id, transaction_id, gateway, status, amount_pkr) VALUES (?, ?, 'jazzcash', 'pending', ?)",
      [orderId, txnId, order.total]
    );

    const params = {
      pp_MerchantID: env.jazzcash.merchantId,
      pp_Password: env.jazzcash.password,
      pp_TxnRefNo: txnId,
      pp_Amount: String(order.total * 100),
      pp_TxnDateTime: dateTime,
      pp_TxnExpiryDateTime: expiryDateTime,
      pp_BillReference: order.order_number,
      pp_Description: `VoltXpress Order ${order.order_number}`,
      pp_TxnCurrency: "PKR"
    };

    const sortedKeys = Object.keys(params).sort();
    const hashString = env.jazzcash.integritySalt + "&" + sortedKeys.map((k) => params[k]).join("&");
    const secureHash = crypto.createHmac("sha256", env.jazzcash.integritySalt).update(hashString).digest("hex");

    return success(res, {
      status: "redirect",
      gateway: "jazzcash",
      redirectUrl: env.jazzcash.endpoint,
      params: { ...params, pp_SecureHash: secureHash }
    }, "Redirect to JazzCash.");
  }

  // ─── Easypaisa ──────────────────────────────────────────────────────────
  if (method === "easypaisa") {
    const txnId = `VX${Date.now()}`;

    await query(
      "INSERT INTO payments (order_id, transaction_id, gateway, status, amount_pkr) VALUES (?, ?, 'easypaisa', 'pending', ?)",
      [orderId, txnId, order.total]
    );

    return success(res, {
      status: "redirect",
      gateway: "easypaisa",
      redirectUrl: env.easypaisa.endpoint,
      params: {
        storeId: env.easypaisa.storeId,
        amount: order.total,
        orderRefNum: txnId,
        transactionType: "MA"
      }
    }, "Redirect to Easypaisa.");
  }

  // ─── Bank transfers ──────────────────────────────────────────────────────
  const txnId = `VX${Date.now()}`;
  await query(
    "INSERT INTO payments (order_id, transaction_id, gateway, status, amount_pkr) VALUES (?, ?, ?, 'pending', ?)",
    [orderId, txnId, selectedMethod.gateway, order.total]
  );

  return success(res, {
    status: "pending",
    gateway: selectedMethod.gateway,
    transactionId: txnId,
    amount: order.total,
    instructions: `Transfer Rs ${order.total.toLocaleString()} to VoltXpress via ${selectedMethod.name}. Reference: ${txnId}`
  }, "Payment initiated. Complete the transfer.");
}));

// ─── Stripe Confirm (frontend calls after card payment succeeds) ─────────────
paymentRoutes.post("/stripe/confirm", optionalAuth, asyncHandler(async (req, res) => {
  const { paymentIntentId } = req.body;
  if (!paymentIntentId) throw badRequest("paymentIntentId is required.");
  if (!stripe) throw badRequest("Card payments are not configured.");

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

  const payments = await query("SELECT * FROM payments WHERE transaction_id = ?", [paymentIntentId]);
  if (!payments.length) throw notFound("Payment record not found.");

  const payment = payments[0];

  if (paymentIntent.status === "succeeded") {
    await query("UPDATE payments SET status = 'paid', raw_response = ? WHERE id = ?", [
      JSON.stringify({ id: paymentIntent.id, status: paymentIntent.status, amount: paymentIntent.amount }),
      payment.id
    ]);
    await query("UPDATE orders SET status = 'processing' WHERE id = ?", [payment.order_id]);

    return success(res, { status: "paid", orderStatus: "processing" }, "Payment confirmed. Order is being processed.");
  }

  if (paymentIntent.status === "requires_payment_method") {
    await query("UPDATE payments SET status = 'failed', raw_response = ? WHERE id = ?", [
      JSON.stringify({ id: paymentIntent.id, status: paymentIntent.status, last_error: paymentIntent.last_payment_error?.message }),
      payment.id
    ]);
    return success(res, { status: "failed", error: paymentIntent.last_payment_error?.message || "Payment failed." }, "Payment failed.");
  }

  return success(res, { status: paymentIntent.status }, `Payment status: ${paymentIntent.status}`);
}));

// ─── Stripe Webhook (automated payment confirmation) ─────────────────────────
paymentRoutes.post("/stripe/webhook", asyncHandler(async (req, res) => {
  if (!stripe) return res.status(400).json({ error: "Stripe not configured." });

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, env.stripe.webhookSecret);
  } catch (err) {
    console.error("[STRIPE WEBHOOK] Signature verification failed:", err.message);
    return res.status(400).json({ error: "Invalid signature." });
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object;
    const payments = await query("SELECT * FROM payments WHERE transaction_id = ?", [paymentIntent.id]);

    if (payments.length) {
      const payment = payments[0];
      await query("UPDATE payments SET status = 'paid', raw_response = ? WHERE id = ?", [
        JSON.stringify(paymentIntent),
        payment.id
      ]);
      await query("UPDATE orders SET status = 'processing' WHERE id = ?", [payment.order_id]);
      await query(
        "INSERT INTO order_status_history (order_id, status, note) VALUES (?, 'processing', 'Payment confirmed via Stripe')",
        [payment.order_id]
      );
    }
  }

  if (event.type === "payment_intent.payment_failed") {
    const paymentIntent = event.data.object;
    const payments = await query("SELECT * FROM payments WHERE transaction_id = ?", [paymentIntent.id]);

    if (payments.length) {
      await query("UPDATE payments SET status = 'failed', raw_response = ? WHERE id = ?", [
        JSON.stringify(paymentIntent),
        payments[0].id
      ]);
    }
  }

  res.json({ received: true });
}));

// ─── JazzCash/Easypaisa Callback ─────────────────────────────────────────────
paymentRoutes.post("/callback", asyncHandler(async (req, res) => {
  const { pp_TxnRefNo, pp_ResponseCode, pp_ResponseMessage, pp_SecureHash } = req.body;

  if (!pp_TxnRefNo) throw badRequest("Invalid callback data.");

  if (pp_SecureHash && env.jazzcash.integritySalt) {
    const sortedKeys = Object.keys(req.body).filter((k) => k !== "pp_SecureHash" && req.body[k]).sort();
    const hashString = env.jazzcash.integritySalt + "&" + sortedKeys.map((k) => req.body[k]).join("&");
    const computed = crypto.createHmac("sha256", env.jazzcash.integritySalt).update(hashString).digest("hex");
    if (computed !== pp_SecureHash) throw badRequest("Invalid signature.");
  }

  const payments = await query("SELECT * FROM payments WHERE transaction_id = ?", [pp_TxnRefNo]);
  if (!payments.length) throw notFound("Payment not found.");

  const newStatus = pp_ResponseCode === "000" ? "paid" : "failed";
  await query("UPDATE payments SET status = ?, raw_response = ? WHERE id = ?", [
    newStatus,
    JSON.stringify(req.body),
    payments[0].id
  ]);

  if (newStatus === "paid") {
    await query("UPDATE orders SET status = 'processing' WHERE id = ?", [payments[0].order_id]);
  }

  return success(res, { status: newStatus }, `Payment ${newStatus}.`);
}));

function formatJazzDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
