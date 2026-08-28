import mysql from "mysql2/promise";
import { env } from "./env.js";

const poolOptions = {
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true
};

// Enable SSL for production (required by Aiven, PlanetScale, etc.)
if (env.nodeEnv === "production") {
  poolOptions.ssl = { rejectUnauthorized: false };
}

export const pool = mysql.createPool(poolOptions);

export const query = async (sql, params = []) => {
  const [rows] = await pool.execute(sql, params);
  return rows;
};

export const withTransaction = async (work) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
