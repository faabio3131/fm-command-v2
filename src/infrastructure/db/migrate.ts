import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@/infrastructure/db/client";
import { logEvent } from "@/infrastructure/observability/logger";

let migrationPromise: Promise<void> | undefined;

export function runStartupMigrations(): Promise<void> {
  if (!migrationPromise) {
    const migrationsFolder = path.join(process.cwd(), "drizzle");
    logEvent("info", "database_migration_started", { migrationsFolder });
    migrationPromise = migrate(db, { migrationsFolder })
      .then(() => {
        logEvent("info", "database_migration_completed");
      })
      .catch((error: unknown) => {
        logEvent("error", "database_migration_failed", {
          errorType: error instanceof Error ? error.name : "unknown",
        });
        throw error;
      });
  }
  return migrationPromise;
}
