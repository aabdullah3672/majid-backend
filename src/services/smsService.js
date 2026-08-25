import { env } from "../config/env.js";
import { query } from "../config/db.js";
import crypto from "node:crypto";

/**
 * Generate a 6-digit OTP, store it in DB, and send via SMS.
 * 
 * In development: logs OTP to console (no actual SMS sent).
 * In production: sends via configured SMS gateway (generic HTTP API).
 * 
 * Supported providers (set SMS_PROVIDER in .env):
 * - "console" (default in dev) — just logs it
 * - "generic" — sends POST to SMS_API_URL with the message
 */
export const sendOtp = async (phone, purpose = "verify") => {
  const code = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  // Invalidate previous unused codes for this phone
  await query(
    "UPDATE otp_codes SET used = 1 WHERE phone = ? AND purpose = ? AND used = 0",
    [phone, purpose]
  );

  await query(
    "INSERT INTO otp_codes (phone, code, purpose, expires_at) VALUES (?, ?, ?, ?)",
    [phone, code, purpose, expiresAt]
  );

  const message = `Your VoltXpress code is: ${code}. Valid for 10 minutes.`;

  const provider = env.sms?.provider || "console";

  if (provider === "generic" && env.sms?.apiUrl) {
    // Generic HTTP SMS gateway (works with Pakistani providers)
    try {
      const response = await fetch(env.sms.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(env.sms.apiKey ? { "Authorization": `Bearer ${env.sms.apiKey}` } : {})
        },
        body: JSON.stringify({
          to: phone,
          message,
          // Common fields various Pakistani SMS APIs expect
          sender: env.sms.senderId || "VoltXpress",
          api_key: env.sms.apiKey || "",
          api_secret: env.sms.apiSecret || ""
        })
      });

      if (!response.ok) {
        console.error("[SMS] Gateway error:", await response.text());
      } else {
        console.log(`[SMS] Sent to ${phone}`);
      }
    } catch (error) {
      console.error("[SMS] Failed:", error.message);
    }
  } else {
    // Console mode — just log it (for development/testing)
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📱 OTP for ${phone}: ${code}`);
    console.log(`   Purpose: ${purpose}`);
    console.log(`   Expires: ${expiresAt.toLocaleTimeString()}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  }

  // In development, return the code in the response for easy testing
  const isDev = env.nodeEnv !== "production";
  return { sent: true, ...(isDev ? { code } : {}) };
};

export const verifyOtp = async (phone, code, purpose = "verify") => {
  const rows = await query(
    "SELECT id FROM otp_codes WHERE phone = ? AND code = ? AND purpose = ? AND used = 0 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1",
    [phone, code, purpose]
  );

  if (!rows.length) return false;

  await query("UPDATE otp_codes SET used = 1 WHERE id = ?", [rows[0].id]);
  return true;
};
