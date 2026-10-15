import { startupMigrationsEnabled } from "@/config/startup-migrations";

function ironRuntimeBootstrapEnabled(): boolean {
  return process.env.FMCC_IRON_RUNTIME_BOOTSTRAP?.trim().toLowerCase() === "true";
}

function kordenaRuntimeBootstrapEnabled(): boolean {
  return process.env.FMCC_KORDENA_RUNTIME_BOOTSTRAP?.trim().toLowerCase() === "true";
}

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

  if (ironRuntimeBootstrapEnabled()) {
    const { bootstrapIronCommercialRuntime } = await import(
      "@/application/integration/iron-runtime-bootstrap"
    );
    await bootstrapIronCommercialRuntime();
  }

  if (kordenaRuntimeBootstrapEnabled()) {
    const { bootstrapKordenaCommercialRuntime } = await import(
      "@/application/integration/kordena-runtime-bootstrap"
    );
    await bootstrapKordenaCommercialRuntime();
  }
}
