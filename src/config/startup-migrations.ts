export function startupMigrationsEnabled(value = process.env.RUN_MIGRATIONS_ON_STARTUP): boolean {
  return value === "true";
}
