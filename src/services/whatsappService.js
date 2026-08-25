import { env } from "../config/env.js";

/**
 * Send WhatsApp message to admin when order is placed.
 * 
 * Providers (set WHATSAPP_PROVIDER in .env):
 * - "twilio"  — Twilio WhatsApp Sandbox or Business API
 * - "meta"    — Meta WhatsApp Cloud API  
 * - "console" — Just logs to terminal (development)
 */
export const sendWhatsAppMessage = async (to, message) => {
  const provider = env.whatsapp?.provider || "console";

  if (provider === "twilio") {
    return sendViaTwilio(to, message);
  }

  if (provider === "meta") {
    return sendViaMeta(to, message);
  }

  // Console fallback
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📱 WhatsApp to Admin (${to}):`);
  console.log(message);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  return null;
};

/**
 * Twilio WhatsApp API
 * Works with both Sandbox (free testing) and Business numbers.
 * 
 * .env needed:
 *   WHATSAPP_PROVIDER=twilio
 *   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *   TWILIO_AUTH_TOKEN=your-auth-token
 *   TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
 *   ADMIN_WHATSAPP=+923XXXXXXXXX
 */
async function sendViaTwilio(to, message) {
  const accountSid = env.twilio.accountSid;
  const authToken = env.twilio.authToken;
  const from = env.twilio.whatsappFrom;

  if (!accountSid || !authToken || !from) {
    console.log("[WHATSAPP] Twilio not configured. Need TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM");
    return null;
  }

  const toNumber = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const body = new URLSearchParams({
      To: toNumber,
      From: from,
      Body: message
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[WHATSAPP] Twilio error:", errorText);
      return null;
    }

    const result = await response.json();
    console.log(`[WHATSAPP] Sent to ${to} via Twilio, SID: ${result.sid}`);
    return result;
  } catch (error) {
    console.error("[WHATSAPP] Twilio failed:", error.message);
    return null;
  }
}

/**
 * Meta WhatsApp Business Cloud API
 */
async function sendViaMeta(to, message) {
  const token = env.whatsapp?.token;
  const phoneId = env.whatsapp?.phoneId;

  if (!token || !phoneId) {
    console.log("[WHATSAPP] Meta API not configured (missing WHATSAPP_TOKEN or WHATSAPP_PHONE_ID)");
    return null;
  }

  const cleanNumber = to.replace(/[^0-9]/g, "");

  try {
    const response = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: cleanNumber,
        type: "text",
        text: { body: message }
      })
    });

    if (!response.ok) {
      console.error("[WHATSAPP] Meta API error:", await response.text());
      return null;
    }

    const result = await response.json();
    console.log(`[WHATSAPP] Sent to ${to} via Meta API`);
    return result;
  } catch (error) {
    console.error("[WHATSAPP] Meta API failed:", error.message);
    return null;
  }
}

/**
 * Send order notification to admin on WhatsApp.
 */
export const sendAdminOrderWhatsApp = async (order) => {
  const adminPhone = env.admin?.whatsapp;
  if (!adminPhone) {
    console.log("[WHATSAPP] No ADMIN_WHATSAPP configured in .env — skipping.");
    return null;
  }

  const itemsList = order.items
    .map((item) => `• ${item.productName} x${item.quantity} — Rs ${item.lineTotal.toLocaleString()}`)
    .join("\n");

  const message = `🛒 *New Order!*

*Order:* ${order.orderNumber}
*Customer:* ${order.customer.name}
*Phone:* ${order.customer.phone}
*City:* ${order.customer.city}

*Items:*
${itemsList}

*Total:* Rs ${order.total.toLocaleString()}
*Payment:* ${order.paymentMethod}`;

  return sendWhatsAppMessage(adminPhone, message);
};
