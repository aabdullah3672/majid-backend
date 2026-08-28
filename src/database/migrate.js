import mysql from "mysql2/promise";
import { env } from "../config/env.js";

/**
 * Migration script to add all missing columns to the existing database.
 * Safe to run multiple times — uses IF NOT EXISTS / checks before ALTER.
 */
const run = async () => {
  const connectionOptions = {
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
    multipleStatements: true
  };

  if (env.nodeEnv === "production") {
    connectionOptions.ssl = { rejectUnauthorized: true };
  }

  const connection = await mysql.createConnection(connectionOptions);

  console.log(`Connected to database: ${env.db.database}`);

  try {
    // ─── PRODUCTS table: add missing columns ───────────────────────────────
    await addColumnIfNotExists(connection, "products", "slug", "VARCHAR(200) NULL AFTER name");
    await addColumnIfNotExists(connection, "products", "brand", "VARCHAR(120) NULL AFTER image");
    await addColumnIfNotExists(connection, "products", "is_new", "TINYINT(1) NOT NULL DEFAULT 0 AFTER brand");
    await addColumnIfNotExists(connection, "products", "is_active", "TINYINT(1) NOT NULL DEFAULT 1 AFTER is_new");
    await addColumnIfNotExists(connection, "products", "deleted_at", "TIMESTAMP NULL DEFAULT NULL AFTER stock");

    // Add indexes for new product columns
    await addIndexIfNotExists(connection, "products", "products_slug_unique", "UNIQUE (slug)");
    await addIndexIfNotExists(connection, "products", "products_deleted_idx", "(deleted_at)");
    await addIndexIfNotExists(connection, "products", "products_active_idx", "(is_active)");

    // ─── CATEGORIES table: add parent_id ───────────────────────────────────
    await addColumnIfNotExists(connection, "categories", "parent_id", "INT UNSIGNED NULL AFTER image");
    await addColumnIfNotExists(connection, "categories", "description", "TEXT NULL AFTER parent_id");
    await addColumnIfNotExists(connection, "categories", "icon", "VARCHAR(600) NULL AFTER image");
    await addIndexIfNotExists(connection, "categories", "categories_parent_idx", "(parent_id)");

    // ─── USERS table: add missing columns ──────────────────────────────────
    await addColumnIfNotExists(connection, "users", "phone", "VARCHAR(40) NULL AFTER password_hash");
    await addColumnIfNotExists(connection, "users", "gender", "ENUM('male', 'female', 'other') NULL AFTER phone");
    await addColumnIfNotExists(connection, "users", "dob", "DATE NULL AFTER gender");
    await addColumnIfNotExists(connection, "users", "avatar", "VARCHAR(600) NULL AFTER dob");
    await addColumnIfNotExists(connection, "users", "is_banned", "TINYINT(1) NOT NULL DEFAULT 0 AFTER role");

    // ─── REVIEWS table: add user_id ────────────────────────────────────────
    await addColumnIfNotExists(connection, "reviews", "user_id", "INT UNSIGNED NULL AFTER product_id");
    await addIndexIfNotExists(connection, "reviews", "reviews_user_idx", "(user_id)");

    // ─── ORDERS table: add missing columns ─────────────────────────────────
    await addColumnIfNotExists(connection, "orders", "discount", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER delivery");
    await addColumnIfNotExists(connection, "orders", "coupon_code", "VARCHAR(60) NULL AFTER discount");
    await addColumnIfNotExists(connection, "orders", "tracking_number", "VARCHAR(120) NULL AFTER coupon_code");
    await addColumnIfNotExists(connection, "orders", "admin_notes", "TEXT NULL AFTER tracking_number");
    await addIndexIfNotExists(connection, "orders", "orders_status_idx", "(status)");

    // Alter orders status enum to include 'pending' and 'returned'
    try {
      await connection.query(`
        ALTER TABLE orders MODIFY COLUMN status 
        ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled', 'returned') 
        NOT NULL DEFAULT 'pending'
      `);
      console.log("  ✓ orders.status enum updated (added 'pending', 'returned')");
    } catch (e) {
      if (!e.message.includes("Duplicate")) {
        console.log(`  ⚠ orders.status: ${e.message}`);
      }
    }

    // ─── PRODUCT_COLORS table: add sku and stock ───────────────────────────
    await addColumnIfNotExists(connection, "product_colors", "sku", "VARCHAR(80) NULL AFTER color");
    await addColumnIfNotExists(connection, "product_colors", "stock", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER sku");

    // ─── Create new tables if they don't exist ─────────────────────────────
    console.log("\nCreating new tables (if not exist)...");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NOT NULL,
        token VARCHAR(500) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY refresh_tokens_user_idx (user_id),
        KEY refresh_tokens_token_idx (token(255))
      )
    `);
    console.log("  ✓ refresh_tokens");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS otp_codes (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        phone VARCHAR(40) NOT NULL,
        code VARCHAR(10) NOT NULL,
        purpose ENUM('verify', 'reset') NOT NULL DEFAULT 'verify',
        expires_at TIMESTAMP NOT NULL,
        used TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY otp_codes_phone_idx (phone),
        KEY otp_codes_expires_idx (expires_at)
      )
    `);
    console.log("  ✓ otp_codes");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NOT NULL,
        token VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY password_resets_user_idx (user_id),
        KEY password_resets_token_idx (token)
      )
    `);
    console.log("  ✓ password_resets");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_addresses (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NOT NULL,
        label VARCHAR(60) NOT NULL DEFAULT 'Home',
        address VARCHAR(255) NOT NULL,
        city VARCHAR(100) NOT NULL,
        postal_code VARCHAR(40) NULL,
        phone VARCHAR(40) NULL,
        is_default TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY user_addresses_user_idx (user_id)
      )
    `);
    console.log("  ✓ user_addresses");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS product_images (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        product_id VARCHAR(90) NOT NULL,
        url VARCHAR(600) NOT NULL,
        public_id VARCHAR(300) NULL,
        is_primary TINYINT(1) NOT NULL DEFAULT 0,
        sort_order INT UNSIGNED NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY product_images_product_idx (product_id)
      )
    `);
    console.log("  ✓ product_images");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS order_status_history (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        order_id INT UNSIGNED NOT NULL,
        status VARCHAR(40) NOT NULL,
        note VARCHAR(255) NULL,
        changed_by INT UNSIGNED NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY order_status_history_order_idx (order_id)
      )
    `);
    console.log("  ✓ order_status_history");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS cart_items (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NULL,
        device_id VARCHAR(100) NULL,
        product_id VARCHAR(90) NOT NULL,
        quantity INT UNSIGNED NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY cart_items_user_idx (user_id),
        KEY cart_items_device_idx (device_id)
      )
    `);
    console.log("  ✓ cart_items");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        code VARCHAR(60) NOT NULL,
        discount_type ENUM('flat', 'percent') NOT NULL DEFAULT 'flat',
        discount_value INT UNSIGNED NOT NULL,
        min_order INT UNSIGNED NOT NULL DEFAULT 0,
        max_uses INT UNSIGNED NULL,
        used_count INT UNSIGNED NOT NULL DEFAULT 0,
        expires_at TIMESTAMP NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY coupons_code_unique (code)
      )
    `);
    console.log("  ✓ coupons");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS wishlist (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NOT NULL,
        product_id VARCHAR(90) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY wishlist_user_product_unique (user_id, product_id)
      )
    `);
    console.log("  ✓ wishlist");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        order_id INT UNSIGNED NOT NULL,
        transaction_id VARCHAR(120) NULL,
        gateway VARCHAR(60) NOT NULL,
        status ENUM('pending', 'paid', 'failed', 'refunded') NOT NULL DEFAULT 'pending',
        amount_pkr INT UNSIGNED NOT NULL,
        raw_response JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY payments_order_idx (order_id),
        KEY payments_transaction_idx (transaction_id)
      )
    `);
    console.log("  ✓ payments");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS banners (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        title VARCHAR(180) NOT NULL,
        image VARCHAR(600) NOT NULL,
        link VARCHAR(600) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        display_order INT UNSIGNED NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      )
    `);
    console.log("  ✓ banners");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS admin_activity_log (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        admin_id INT UNSIGNED NOT NULL,
        action VARCHAR(120) NOT NULL,
        entity_type VARCHAR(60) NULL,
        entity_id VARCHAR(90) NULL,
        details JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY admin_activity_log_admin_idx (admin_id)
      )
    `);
    console.log("  ✓ admin_activity_log");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS search_history (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NULL,
        query_text VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY search_history_user_idx (user_id)
      )
    `);
    console.log("  ✓ search_history");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS stock_adjustments (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        product_id VARCHAR(90) NOT NULL,
        adjusted_by INT UNSIGNED NOT NULL,
        previous_stock INT NOT NULL,
        new_stock INT NOT NULL,
        reason VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY stock_adjustments_product_idx (product_id),
        KEY stock_adjustments_admin_idx (adjusted_by)
      )
    `);
    console.log("  ✓ stock_adjustments");

    // ─── Generate slugs for products that don't have one ───────────────────
    console.log("\nGenerating slugs for products without one...");
    const [products] = await connection.query("SELECT id, name FROM products WHERE slug IS NULL OR slug = ''");
    for (const product of products) {
      const slug = product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      try {
        await connection.execute("UPDATE products SET slug = ? WHERE id = ?", [slug, product.id]);
      } catch {
        // If slug collision, append ID
        await connection.execute("UPDATE products SET slug = ? WHERE id = ?", [`${slug}-${product.id}`, product.id]);
      }
    }
    console.log(`  ✓ Generated slugs for ${products.length} products`);

    console.log("\n✅ Migration complete! All columns and tables are up to date.");
  } finally {
    await connection.end();
  }
};

/**
 * Add a column to a table if it doesn't exist.
 */
async function addColumnIfNotExists(connection, table, column, definition) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [env.db.database, table, column]
  );

  if (rows.length === 0) {
    await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`  ✓ Added ${table}.${column}`);
  } else {
    console.log(`  · ${table}.${column} already exists`);
  }
}

/**
 * Add an index if it doesn't exist.
 */
async function addIndexIfNotExists(connection, table, indexName, definition) {
  const [rows] = await connection.query(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [env.db.database, table, indexName]
  );

  if (rows.length === 0) {
    try {
      if (indexName.includes("unique")) {
        await connection.query(`ALTER TABLE \`${table}\` ADD UNIQUE INDEX \`${indexName}\` ${definition}`);
      } else {
        await connection.query(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` ${definition}`);
      }
      console.log(`  ✓ Added index ${indexName}`);
    } catch (e) {
      console.log(`  ⚠ Index ${indexName}: ${e.message}`);
    }
  }
}

export const runMigrations = run;

// Run directly when called as a script (npm run db:migrate)
const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isDirectRun) {
  run().catch((error) => {
    console.error("Migration failed:", error.message);
    process.exit(1);
  });
}
