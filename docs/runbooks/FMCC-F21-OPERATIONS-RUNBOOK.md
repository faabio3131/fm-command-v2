# FMCC — F21 Operations Runbook

Status: F21 operational runbook.
Scope: Preview/Staging and release readiness. Production actions remain separately authorized.

## Operating principles

- Fail closed on identity, authorization, tenant scope, secrets and critical integrations.
- Never turn missing data into zero.
- Never expose runtime secrets in logs, screenshots, audit metadata or browser payloads.
- Preserve the exact commit SHA for every homologation claim.
- Code rollback does not imply database rollback.
- Production, paid-plan changes and destructive database actions require explicit authority.

## Deploy / Preview

SINTOMA: candidate not visible or wrong SHA in Preview.
DIAGNÓSTICO: inspect Render deploy source and /api/version; compare gitCommit to the candidate.
EVIDÊNCIA: deploy log, /api/version, CI run.
AÇÃO: deploy the exact approved commit; wait until live; run health/readiness/auth smoke.
ROLLBACK/MITIGAÇÃO: redeploy the last certified Preview SHA.
ESCALATION: DevOps/SRE if Render/configuration is unavailable.
STOP CONDITIONS: wrong SHA, failed migration, unhealthy/readiness failure, auth bypass.

## Health / Readiness

SINTOMA: /api/health or /api/ready is non-2xx or semantically unhealthy.
DIAGNÓSTICO: inspect structured logs, startup migration event, database connectivity and configuration.
EVIDÊNCIA: response body plus correlated log events.
AÇÃO: repair the failing dependency/configuration; do not mark the environment homologated.
ROLLBACK/MITIGAÇÃO: redeploy last certified SHA if regression is code-related.
ESCALATION: owner of the failing dependency.
STOP CONDITIONS: repeated readiness failure or data-integrity risk.

## Migration failure

SINTOMA: startup migration fails or schema verification diverges.
DIAGNÓSTICO: compare versioned migrations, Drizzle schema and migration journal; inspect DB error without exposing credentials.
EVIDÊNCIA: migration logs and CI schema gate.
AÇÃO: correct the migration in a new commit; rerun against non-production database.
ROLLBACK/MITIGAÇÃO: application rollback only when schema remains backward compatible; otherwise restore/forward-fix according to the migration.
ESCALATION: Data Engineer + Tech Lead.
STOP CONDITIONS: destructive unknown migration, corruption risk, incompatible schema.

## Database unavailable

SINTOMA: readiness fails, auth or repositories cannot access PostgreSQL.
DIAGNÓSTICO: confirm provider status, connection configuration, TLS/network and saturation signals.
EVIDÊNCIA: health/readiness plus provider/runtime logs.
AÇÃO: restore connectivity; keep critical operations fail-closed.
ROLLBACK/MITIGAÇÃO: no write fallback to local or alternate ungoverned database.
ESCALATION: DevOps/SRE and database provider.
STOP CONDITIONS: suspected data loss or cross-tenant integrity issue.

## Backup / Restore

SINTOMA: recovery proof required or backup validity uncertain.
DIAGNÓSTICO: identify provider backup capability and latest verifiable backup; do not infer retention/RPO/RTO.
EVIDÊNCIA: provider evidence and isolated restore test. CI additionally executes a real logical pg_dump to isolated pg_restore smoke against PostgreSQL 18.
AÇÃO: restore only into an isolated target first; verify FMCC core tables and application schema.
ROLLBACK/MITIGAÇÃO: never restore over the canonical database as a test.
ESCALATION: Data Engineer + DevOps/SRE.
STOP CONDITIONS: no recoverable backup for a destructive operation, restore mismatch, integrity failure.

## Rollback

SINTOMA: newly deployed candidate causes a regression.
DIAGNÓSTICO: determine whether the failure is code, configuration, provider or schema/data.
EVIDÊNCIA: exact failing SHA, logs, health/readiness, migration state.
AÇÃO: for code-only compatible changes redeploy last certified SHA; revert configuration using recorded prior values; disable optional integration/source when supported.
ROLLBACK/MITIGAÇÃO: migration/data rollback must be evaluated independently; prefer forward-fix when reversal is unsafe.
ESCALATION: Tech Lead + Data Engineer for schema/data.
STOP CONDITIONS: destructive rollback, unknown data compatibility, loss/corruption risk.

## Kordena unavailable / auth failure

SINTOMA: Kordena health/snapshot/command fails, times out or returns auth denial.
DIAGNÓSTICO: verify allowlisted origin, control tenant, secret reference and Kordena availability without printing token values.
EVIDÊNCIA: sanitized connector result, correlation ID and source health.
AÇÃO: keep source unavailable/degraded; preserve missing != zero; repair runtime configuration only from authorized secret stores.
ROLLBACK/MITIGAÇÃO: disable/unregister only through governed source controls if necessary; do not fabricate data.
ESCALATION: Integration Engineer + Kordena owner.
STOP CONDITIONS: secret exposure, authority mismatch, cross-tenant response.

## Scheduler / alert automation failure

SINTOMA: scheduled workflow skips because config is absent, receives auth denial, times out or reports failures.
DIAGNÓSTICO: verify FMCC_AUTOMATION_BASE_URL, scheduler secret presence, idempotency key, run lifecycle and audit events.
EVIDÊNCIA: GitHub Actions run plus sanitized FMCC audit/logs.
AÇÃO: correct runtime configuration; retry with a new governed run ID only when previous state permits it.
ROLLBACK/MITIGAÇÃO: scheduled automation may remain disabled; alert evaluation can remain explicit/manual.
ESCALATION: DevOps/SRE + Alert capability owner.
STOP CONDITIONS: scheduler auth bypass, replay causing unauthorized side effect, secret leak.

## Core / model provider failure

SINTOMA: cognitive provider is unavailable, invalid or returns unusable output.
DIAGNÓSTICO: distinguish provider failure from deterministic grounding/authority; inspect safe logs and evidence metadata.
EVIDÊNCIA: Core response contract, correlation ID, provider status.
AÇÃO: fail closed to insufficient/unavailable; deterministic services remain authoritative.
ROLLBACK/MITIGAÇÃO: switch provider only through an approved configuration/boundary decision.
ESCALATION: Cognitive Core owner.
STOP CONDITIONS: Core output bypasses deterministic authorization or invents governed facts.

## Incident response

SINTOMA: security, availability, data integrity or critical workflow incident.
DIAGNÓSTICO: preserve evidence; classify confirmed facts separately from hypotheses; determine blast radius and tenant impact.
EVIDÊNCIA: logs, audit ledger, commit/deploy SHA, provider evidence.
AÇÃO: protect users/data, stabilize, mitigate/rollback if safe, investigate, correct, test, document.
ROLLBACK/MITIGAÇÃO: use certified rollback path; isolate affected integration if needed.
ESCALATION: Security + QA + DevOps/SRE + competent domain owner.
STOP CONDITIONS: cross-tenant access, auth bypass, privilege escalation, secret leak, critical fraud/corruption/destructive behavior.

## Secret rotation

SINTOMA: scheduled rotation, suspected exposure or provider rotation requirement.
DIAGNÓSTICO: identify secret reference and consumers; never echo the secret.
EVIDÊNCIA: secret-store metadata/config version and post-rotation health, not secret value.
AÇÃO: rotate in authorized secret stores, update both ends when shared, validate health, revoke old credential.
ROLLBACK/MITIGAÇÃO: short controlled overlap only when provider policy permits.
ESCALATION: Security + integration owner.
STOP CONDITIONS: secret committed to Git, shown in logs/browser, or unknown consumers.

## Source sync failure

SINTOMA: sync execution failed, timed out or is retrying.
DIAGNÓSTICO: use tenant + source + execution + correlation IDs; inspect retryable classification and provider health.
EVIDÊNCIA: sync execution record and structured connector logs.
AÇÃO: retry only under idempotent contract; preserve failed state and error code.
ROLLBACK/MITIGAÇÃO: disable source if repeated unsafe failures; never copy another tenant/source state.
ESCALATION: Integration Engineer.
STOP CONDITIONS: cross-tenant evidence, duplicated financial facts, non-idempotent replay risk.

## Canonical fact reconciliation

SINTOMA: Metric Engine result conflicts with authoritative source/read model.
DIAGNÓSTICO: trace source to mapping version to canonical fact to provenance to metric definition/version to computed value.
EVIDÊNCIA: canonical facts, provenance refs, source timestamps and metric calculation metadata.
AÇÃO: fix mapping/contract only after authority and semantics are confirmed; recompute affected metrics.
ROLLBACK/MITIGAÇÃO: mark unavailable/insufficient when authority cannot be established.
ESCALATION: Data + Integration + domain authority.
STOP CONDITIONS: fabricated mapping, missing provenance, currency/semantic ambiguity affecting critical decisions.

## STOP CONDITIONS

Automatic progression stops on:
- cross-tenant access;
- authentication or authorization bypass;
- privilege escalation;
- exposed secret;
- relevant data leak;
- corruption or loss risk;
- critical fraud path;
- destructive operation without authority;
- CRITICAL or unresolved HIGH security finding;
- essential evidence missing for a high-risk transition.
