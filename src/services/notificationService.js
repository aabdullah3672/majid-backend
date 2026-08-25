import { env } from "../config/env.js";

/**
 * Send order notification to admin.
 * Uses Telegram Bot API — free, instant, no phone verification issues.
 * 
 * Setup (2 minutes):
 * 1. Search @BotFather on Telegram
 * 2. Send /newbot, follow prompts, get your bot token
 * 3. Start a chat with your bot, then visit:
 *    https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
 *    Find your chat_id in the response
 * 4. Set in .env:
 *    TELEGRAM_BOT_TOKEN=your-bot-token
 *    TELEGRAM_CHAT_ID=your-chat-id
 * 
 * That's it — instant notifications on your phone via Telegram.
 */
export const notifyAdminNewOrder = async (order) => {
  const token = env.telegram?.botToken;
  const chatId = env.telegram?.chatId;

  const itemsList = order.items
    .map((item) => `• ${item.productName} x${item.quantity} — Rs ${item.lineTotal.toLocaleString()}`)
    .join("\n");

  const message = `🛒 *New Order Received!*

📦 *Order:* \`${order.orderNumber}\`
👤 *Customer:* ${order.customer.name}
📞 *Phone:* ${order.customer.phone}
📧 *Email:* ${order.customer.email}
🏙️ *City:* ${order.customer.city}
📍 *Address:* ${order.customer.address}

*Items:*
${itemsList}

💰 *Subtotal:* Rs ${order.subtotal.toLocaleString()}
🚚 *Delivery:* Rs ${order.delivery.toLocaleString()}
🎟️ *Discount:* Rs ${(order.discount || 0).toLocaleString()}
✅ *Total:* Rs ${order.total.toLocaleString()}

💳 *Payment:* ${order.paymentMethod}`;

  // Send via Telegram if configured
  if (token && chatId) {
    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "Markdown"
        })
      });

      if (!response.ok) {
        const err = await response.text();
        console.error("[TELEGRAM] Failed:", err);
      } else {
        console.log(`[TELEGRAM] Order notification sent to admin`);
      }
    } catch (error) {
      console.error("[TELEGRAM] Error:", error.message);
    }
  } else {
    // Console fallback
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📱 Admin Notification:`);
    console.log(message);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  }
};
