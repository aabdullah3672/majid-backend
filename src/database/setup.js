import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import { categories, defaultReviews, products } from "../data/catalog.js";
import { env } from "../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const assertSafeDatabaseName = (database) => {
  if (!/^[a-zA-Z0-9_]+$/.test(database)) {
    throw new Error("DB_DATABASE may only contain letters, numbers, and underscores.");
  }
};

const run = async () => {
  assertSafeDatabaseName(env.db.database);

  const connectionOptions = {
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true
  };

  if (env.nodeEnv === "production") {
    connectionOptions.ssl = { rejectUnauthorized: false };
  }

  const connection = await mysql.createConnection(connectionOptions);

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${env.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`USE \`${env.db.database}\``);

    const schema = await fs.readFile(path.join(__dirname, "schema.sql"), "utf8");
    await connection.query(schema);

    await seedCategories(connection);
    await seedProducts(connection);
    await seedReviews(connection);
    await seedAdmin(connection);

    console.log(`Database "${env.db.database}" is ready.`);
  } finally {
    await connection.end();
  }
};

const seedCategories = async (connection) => {
  for (const [categoryIndex, category] of categories.entries()) {
    await connection.execute(`
      INSERT INTO categories (name, slug, image, sort_order)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE name = VALUES(name), image = VALUES(image), sort_order = VALUES(sort_order)
    `, [category.name, category.slug, category.image, categoryIndex]);

    const [rows] = await connection.execute("SELECT id FROM categories WHERE slug = ? LIMIT 1", [category.slug]);
    const categoryId = rows[0].id;

    for (const [subcategoryIndex, subcategory] of category.subcategories.entries()) {
      await connection.execute(`
        INSERT INTO subcategories (category_id, name, sort_order)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)
      `, [categoryId, subcategory, subcategoryIndex]);
    }
  }
};

const seedProducts = async (connection) => {
  for (const product of products) {
    await connection.execute(`
      INSERT INTO products (
        id, name, category_slug, subcategory, subtitle, price, compare_at,
        badge, image, created, featured, stock
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        category_slug = VALUES(category_slug),
        subcategory = VALUES(subcategory),
        subtitle = VALUES(subtitle),
        price = VALUES(price),
        compare_at = VALUES(compare_at),
        badge = VALUES(badge),
        image = VALUES(image),
        created = VALUES(created),
        featured = VALUES(featured),
        stock = VALUES(stock)
    `, [
      product.id,
      product.name,
      product.category,
      product.subcategory,
      product.subtitle,
      product.price,
      product.compareAt,
      product.badge,
      product.image,
      product.created,
      product.featured ? 1 : 0,
      product.stock
    ]);

    await connection.execute("DELETE FROM product_colors WHERE product_id = ?", [product.id]);
    for (const [index, color] of product.colors.entries()) {
      await connection.execute(
        "INSERT INTO product_colors (product_id, color, sort_order) VALUES (?, ?, ?)",
        [product.id, color, index]
      );
    }
  }
};

const seedReviews = async (connection) => {
  const [rows] = await connection.execute("SELECT COUNT(*) AS total FROM reviews");
  if (rows[0].total > 0) return;

  for (const review of defaultReviews) {
    await connection.execute(`
      INSERT INTO reviews (name, rating, comment, status, created_at)
      VALUES (?, ?, ?, 'approved', ?)
    `, [review.name, review.rating, review.comment, `${review.date} 10:00:00`]);
  }
};

const seedAdmin = async (connection) => {
  const email = env.seedAdmin.email.toLowerCase();
  const [rows] = await connection.execute("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
  if (rows.length) return;

  const passwordHash = await bcrypt.hash(env.seedAdmin.password, 12);
  await connection.execute(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')",
    [env.seedAdmin.name, email, passwordHash]
  );
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
