# FM Command Billing — Preview migration GO/NO-GO (2026-10-08)

## Observed environment (read-only verification)
- Render Postgres `fmcc-preview-postgres`, database `fmcc_preview`, PostgreSQL 18.6, free plan; no high availability and no read replicas. Render reports expiry on 2026-10-19.
- Existing database size ~9 MB; `fmcc_product_definition` has 39 rows.
- `drizzle.__drizzle_migrations` has four entries, mapping to migrations 0000 through 0003.
- Billing tables do not yet exist. PR #63 adds 0004 (new billing tables) and 0005 (invoice uniqueness constraint).
- Render service `fmcc-preview-web` tracks `main`, auto-deploy disabled, and has PR previews disabled. Deploying it from main will not deploy PR #63; merging PR #63 into main would affect the existing preview service.

## Release gate: NO-GO
- Do not apply migrations 0004 or 0005 directly to the existing database before a restorable, verified backup exists.
- Do not merge PR #63 or deploy it to the currently functional preview as a substitute for an isolated certification environment.
- Use an isolated temporary service and separate database (or a restorable clone), never the current preview DB for destructive integration tests.
- Confirm exact migration hashes, transaction behavior, foreign keys and schema state using an isolated PostgreSQL 18 database.
- Verify rollback by restoring backup or rebuilding isolated database from baseline and replaying migrations; 0004/0005 do not have automatic safe DOWN migrations.
- Verify concurrency, recovery after provider timeouts, tenant/SaaS segregation and idempotent reconciliation using actual PostgreSQL transactions.
- Create a dedicated administrative execution flow and certification evidence prior to enabling sandbox payment creation. No real production payments or withdrawals.

## Next operator actions
1. Establish an isolated PostgreSQL 18 homologation instance or restorable snapshot with a confirmed backup/export path.
2. Provision isolated preview service on PR branch and nonproduction secret variable with minimal access.
3. Apply 0004/0005 against the isolated instance, test full matrix, collect redacted evidence.
4. Only after green checks, authorize bounded Asaas Sandbox Pix 19.90 flow.

Status: `MIGRATION_BLOCKED_BACKUP_AND_ISOLATION_REQUIRED`. This is a governance gate, not a claim that the migration was applied.
