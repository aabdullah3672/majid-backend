import { app } from "./app.js";
import { env } from "./config/env.js";
import { runSetup } from "./database/setup.js";
import { runMigrations } from "./database/migrate.js";

const start = async () => {
  try {
    console.log("Running database setup (tables + seed data)...");
    await runSetup();
    console.log("Setup complete.");
  } catch (error) {
    console.error("Setup error:", error.message);
  }

  try {
    console.log("Running database migrations...");
    await runMigrations();
    console.log("Migrations complete.");
  } catch (error) {
    console.error("Migration error:", error.message);
  }

  app.listen(env.port, () => {
    console.log(`VoltXpress API running on port ${env.port}`);
  });
};

start();
