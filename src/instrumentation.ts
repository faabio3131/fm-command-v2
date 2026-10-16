import { startupMigrationsEnabled } from "@/config/startup-migrations";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (startupMigrationsEnabled()) {
    const { runStartupMigrations } = await import("@/infrastructure/db/migrate");
    await runStartupMigrations();
  }

  const { coreWorkerEnabled } = await import("@/config/process-role");
  if (coreWorkerEnabled()) {
    const { startCoreWorkers } = await import("@/application/core/core-runtime");
    startCoreWorkers();
  }
}
