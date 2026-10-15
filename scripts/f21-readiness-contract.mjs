import { readFileSync, existsSync } from "node:fs";

const requiredFiles = [
  "docs/runbooks/FMCC-F21-OPERATIONS-RUNBOOK.md",
  "FMCC-F21-READINESS-MATRIX-v0.1.md",
  "FMCC-F21-HOMOLOGACAO-E-READINESS-OPERACIONAL-2026-09-23.md",
];

for (const file of requiredFiles) {
  if (!existsSync(file)) throw new Error("f21.required_file_missing:" + file);
}

const env = readFileSync(".env.example", "utf8");
for (const name of [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "FMCC_KORDENA_CONTROL_TENANT_ID",
  "FMCC_KORDENA_ALLOWED_ORIGINS",
  "FMCC_KORDENA_CONTROL_PLANE_TOKEN",
  "FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET",
]) {
  if (!env.includes(name + "=")) throw new Error("f21.env_contract_missing:" + name);
}

const runbook = readFileSync("docs/runbooks/FMCC-F21-OPERATIONS-RUNBOOK.md", "utf8");
for (const heading of [
  "Deploy / Preview",
  "Health / Readiness",
  "Migration failure",
  "Database unavailable",
  "Backup / Restore",
  "Rollback",
  "Kordena unavailable / auth failure",
  "Scheduler / alert automation failure",
  "Core / model provider failure",
  "Incident response",
  "Secret rotation",
  "Source sync failure",
  "Canonical fact reconciliation",
  "STOP CONDITIONS",
]) {
  if (!runbook.includes(heading)) throw new Error("f21.runbook_section_missing:" + heading);
}

console.log("F21 readiness contract PASS.");
