import dotenv from "dotenv";

dotenv.config();

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const splitOrigins = (value) => {
  if (!value || value === "*") return true;
  return value.split(",").map((origin) => origin.trim()).filter(Boolean);
};

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: toNumber(process.env.PORT, 4000),
  clientOrigin: splitOrigins(process.env.CLIENT_ORIGIN || "http://127.0.0.1:5173"),
  db: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: toNumber(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_DATABASE || "voltxpress"
  },
  jwt: {
    secret: process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || "dev-only-change-this-secret",
    accessSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || "dev-only-change-this-secret",
    refreshSecret: process.env.JWT_REFRESH_SECRET || "dev-only-refresh-secret",
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "7d",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d"
  },
  seedAdmin: {
    name: process.env.SEED_ADMIN_NAME || "VoltXpress Admin",
    email: process.env.SEED_ADMIN_EMAIL || "admin@voltxpress.test",
    password: process.env.SEED_ADMIN_PASSWORD || "Admin123!"
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || "",
    whatsappFrom: process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886"
  },
  sms: {
    provider: process.env.SMS_PROVIDER || "console",
    apiUrl: process.env.SMS_API_URL || "",
    apiKey: process.env.SMS_API_KEY || "",
    apiSecret: process.env.SMS_API_SECRET || "",
    senderId: process.env.SMS_SENDER_ID || "VoltXpress"
  },
  whatsapp: {
    provider: process.env.WHATSAPP_PROVIDER || "console",
    token: process.env.WHATSAPP_TOKEN || "",
    phoneId: process.env.WHATSAPP_PHONE_ID || "",
    callmebotKey: process.env.CALLMEBOT_API_KEY || ""
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || ""
  },
  admin: {
    email: process.env.ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL || "admin@voltxpress.test",
    whatsapp: process.env.ADMIN_WHATSAPP || ""
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
    apiKey: process.env.CLOUDINARY_API_KEY || "",
    apiSecret: process.env.CLOUDINARY_API_SECRET || ""
  },
  smtp: {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: toNumber(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "VoltXpress <noreply@voltxpress.test>"
  },
  jazzcash: {
    merchantId: process.env.JAZZCASH_MERCHANT_ID || "",
    password: process.env.JAZZCASH_PASSWORD || "",
    integritySalt: process.env.JAZZCASH_INTEGRITY_SALT || "",
    endpoint: process.env.JAZZCASH_ENDPOINT || "https://sandbox.jazzcash.com.pk/ApplicationAPI/API/Payment/DoTransaction"
  },
  easypaisa: {
    storeId: process.env.EASYPAISA_STORE_ID || "",
    hashKey: process.env.EASYPAISA_HASH_KEY || "",
    endpoint: process.env.EASYPAISA_ENDPOINT || "https://easypay.easypaisa.com.pk/easypay/Index.jsf"
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || "",
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || ""
  }
};

if (env.nodeEnv === "production" && env.jwt.accessSecret === "dev-only-change-this-secret") {
  throw new Error("JWT_ACCESS_SECRET must be set in production.");
}
