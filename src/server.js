import { app } from "./app.js";
import { env } from "./config/env.js";
import { runMigrations } from "./database/migrate.js";

const start = async () => {
  try {
    console.log("Running database migrations...");
    await runMigrations();
    console.log("Migrations complete.");
  } catch (error) {
    console.error("Migration error (server will start anyway):", error.message);
  }

  app.listen(env.port, () => {
    console.log(`VoltXpress API running on port ${env.port}`);
  });
};

start();
