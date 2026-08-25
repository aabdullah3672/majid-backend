import nodemailer from "nodemailer";
import { env } from "../config/env.js";

let transporter = null;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: {
        user: env.smtp.user,
        pass: env.smtp.pass
      }
    });
  }
  return transporter;
};

export const sendEmail = async ({ to, subject, html, text }) => {
  if (!env.smtp.user || !env.smtp.pass) {
    console.log(`[EMAIL SKIPPED] To: ${to}, Subject: ${subject}`);
    return null;
  }

  const info = await getTransporter().sendMail({
    from: env.smtp.from,
    to,
    subject,
    html,
    text
  });
  return info;
};

/**
 * Send order notification email to admin.
 */
export const sendAdminOrderEmail = async (order) => {
  const adminEmail = env.admin?.email;
  if (!adminEmail) {
    console.log("[EMAIL] No admin email configured. Skipping admin notification.");
    return null;
  }

  const itemsHtml = order.items.map((item) =>
    `<tr><td>${item.productName}</td><td>${item.quantity}</td><td>Rs ${item.unitPrice.toLocaleString()}</td><td>Rs ${item.lineTotal.toLocaleString()}</td></tr>`
  ).join("");

  const html = `
    <h2>🛒 New Order — ${order.orderNumber}</h2>
    <p><strong>Customer:</strong> ${order.customer.name}</p>
    <p><strong>Phone:</strong> ${order.customer.phone}</p>
    <p><strong>Email:</strong> ${order.customer.email}</p>
    <p><strong>Address:</strong> ${order.customer.address}, ${order.customer.city} ${order.customer.postal}</p>
    <hr/>
    <table border="1" cellpadding="8" cellspacing="0">
      <tr><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr>
      ${itemsHtml}
    </table>
    <p><strong>Subtotal:</strong> Rs ${order.subtotal.toLocaleString()}</p>
    <p><strong>Discount:</strong> Rs ${order.discount.toLocaleString()}</p>
    <p><strong>Delivery:</strong> Rs ${order.delivery.toLocaleString()}</p>
    <p><strong>Total:</strong> Rs ${order.total.toLocaleString()}</p>
    <p><strong>Payment:</strong> ${order.paymentMethod}</p>
  `;

  return sendEmail({
    to: adminEmail,
    subject: `⚡ New Order ${order.orderNumber} — Rs ${order.total.toLocaleString()}`,
    html,
    text: `New order ${order.orderNumber} from ${order.customer.name}. Total: Rs ${order.total}. Payment: ${order.paymentMethod}.`
  });
};

export const sendOrderConfirmation = async (order) => {
  const itemsHtml = order.items.map((item) =>
    `<tr><td>${item.productName}</td><td>${item.quantity}</td><td>Rs ${item.unitPrice.toLocaleString()}</td><td>Rs ${item.lineTotal.toLocaleString()}</td></tr>`
  ).join("");

  const html = `
    <h2>Order Confirmed — ${order.orderNumber}</h2>
    <p>Thank you, ${order.customer.name}! Your order has been placed.</p>
    <table border="1" cellpadding="8" cellspacing="0">
      <tr><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr>
      ${itemsHtml}
    </table>
    <p><strong>Subtotal:</strong> Rs ${order.subtotal.toLocaleString()}</p>
    <p><strong>Delivery:</strong> Rs ${order.delivery.toLocaleString()}</p>
    <p><strong>Total:</strong> Rs ${order.total.toLocaleString()}</p>
    <p>Payment: ${order.paymentMethod}</p>
    <p>We'll notify you when your order ships.</p>
  `;

  return sendEmail({
    to: order.customer.email,
    subject: `VoltXpress — Order ${order.orderNumber} Confirmed`,
    html,
    text: `Order ${order.orderNumber} confirmed. Total: Rs ${order.total}. Thank you!`
  });
};

export const sendPasswordReset = async (email, resetToken) => {
  const resetUrl = `${env.clientOrigin === true ? "http://127.0.0.1:5173" : (Array.isArray(env.clientOrigin) ? env.clientOrigin[0] : env.clientOrigin)}/auth?reset=${resetToken}`;

  return sendEmail({
    to: email,
    subject: "VoltXpress — Password Reset",
    html: `
      <h2>Password Reset Request</h2>
      <p>Click the link below to reset your password. This link expires in 1 hour.</p>
      <a href="${resetUrl}">${resetUrl}</a>
      <p>If you didn't request this, ignore this email.</p>
    `,
    text: `Reset your password: ${resetUrl}`
  });
};
