# FMCC — F21 Homologação e Readiness Operacional — 2026-09-23

Status: CLOSED / CERTIFIED — PRE-PREMIUM FINAL READINESS CERTIFIED WITH EXTERNAL BLOCKERS

## Baseline

Repository: `faabio3131/FM-CONTROL-CENTER`
Baseline: `main@e6d6e9b33f126d210651a4adbb3ed14ed12b0492`
Branch: `feat/fmcc-f21-readiness-pre-premium-final`
PR: `#23`

F20: APPROVED/CLOSED.
PR #22: MERGED/CLOSED.
Production: NOT AUTHORIZED.
Final Visual Premium: explicitly excluded from F21.

## Atualização pós-fechamento — 24/09/2026

A exigência de recertificação do HEAD final e de Preview no SHA exato foi satisfeita após o snapshot histórico abaixo.

Evidência de fechamento F21:
- PR #23: MERGED/CLOSED;
- merge/main: `edb5b872587c02ee41824dc9f593d9cf0d7c4ea2`;
- Foundation Gate pós-merge #442 — SUCCESS;
- F21 Operational Readiness Gate pós-merge #8 — SUCCESS;
- Preview Deployment Gate #4, attempt 2 — SUCCESS no SHA exato;
- health — PASS;
- readiness — PASS;
- dashboard sem autenticação permaneceu protegido — PASS.

A nomenclatura comercial posterior (**FM Command**) foi integrada sem alterar a decisão de F21. O histórico pré-fechamento permanece abaixo para rastreabilidade.

## Scope closed in this tranche

F21 closes all technically solvable pre-premium readiness work available without inventing external authority:
- functional/security readiness;
- isolated PostgreSQL backup/restore proof;
- rollback/recovery procedures;
- observability/runbooks;
- CI/CD readiness;
- configuration/secrets contracts;
- source/semantic blocker reconciliation;
- exact-head Preview/Staging gate preparation.

## Initial gaps and resolution

1. Consolidated F21 operational runbook absent → RESOLVED.
2. Repository-level backup→restore proof absent → RESOLVED with real isolated PostgreSQL 18 pg_dump/pg_restore smoke.
3. Dedicated F21 readiness workflow absent → RESOLVED.
4. Kordena runtime credentials/source real → EXTERNAL_BLOCKER / CREDENTIAL_REQUIRED.
5. Governed scheduler runtime variable/secret → EXTERNAL_BLOCKER / RUNTIME_SECRET_REQUIRED.
6. Several executive providers remain undecided → EXTERNAL_BLOCKER / PROVIDER_DECISION_REQUIRED.
7. Several executive metric semantics remain undefined → EXTERNAL_BLOCKER / BUSINESS_SEMANTICS_REQUIRED.
8. Provider-specific backup retention/RPO/RTO and deeper observability SLO/vendor → EXTERNAL POLICY/PLAN DECISION; not fabricated.
9. Internal `job.failure.count` / `integration.failure.count` adapters were investigated. CURRENT has no approved internal source authority/registration contract that would permit silently creating canonical telemetry authority; therefore no fictitious adapter was introduced.

## Technical implementation

Added:
- `.github/workflows/fmcc-f21-readiness-gate.yml`;
- `scripts/postgres-backup-restore-smoke.sh`;
- `scripts/f21-readiness-contract.mjs`;
- `docs/runbooks/FMCC-F21-OPERATIONS-RUNBOOK.md`;
- `FMCC-F21-READINESS-MATRIX-v0.1.md`.

The backup/restore smoke:
1. backs up the isolated CI PostgreSQL database with `pg_dump`;
2. creates a separate restore database;
3. restores with `pg_restore`;
4. verifies key FMCC tables;
5. destroys only the isolated restore target.

It never restores over Preview or production.

## Evidence on pre-document candidate

Candidate:
`9f7a59072e75d9d3a5d3824e6a3ec12d2d9cc859`

### Foundation Gate #436 — SUCCESS
- npm ci — PASS;
- lint — PASS;
- TypeScript — PASS;
- schema/migration verify — PASS;
- migrations — PASS;
- 51 test files / 200 tests — PASS;
- secret scan — PASS / 247 tracked files;
- build — PASS;
- Browser E2E — 6/6 PASS;
- runtime smoke — PASS;
- Docker build — PASS;
- runtime dependency audit HIGH threshold — PASS.

### Cognitive Governed Intelligence Gate #111 — SUCCESS
- 8 targeted files — PASS;
- 53 targeted tests — PASS;
- complete regression 51 files / 200 tests — PASS;
- build — PASS;
- whitespace gate — PASS;
- runtime dependency audit HIGH threshold — PASS.

### F21 Operational Readiness Gate #2 — SUCCESS
- reproducible install — PASS;
- migrations — PASS;
- readiness contract — PASS;
- final security/tenant adversarial subset — 6 files / 20 tests PASS;
- secret scan — PASS / 247 tracked files;
- real isolated PostgreSQL backup/restore smoke — PASS;
- runtime dependency audit HIGH threshold — PASS.

## Supply-chain risk

Four known transitive MODERATE tooling vulnerabilities remain in the development/tooling chain around old esbuild dependencies.

Treatment:
- no HIGH/CRITICAL runtime vulnerability is open;
- runtime audit high threshold is green;
- exact dependency tree is frozen by lockfile;
- `npm audit fix --force` is intentionally forbidden because it proposes an unjustified breaking tooling change.

Classification: ACCEPTED / NON-BLOCKING, carried forward for a safe dependency window.

## Second-pass audit

Current open findings:
- BLOCKER: 0
- CRITICAL: 0
- HIGH: 0
- MEDIUM blocking: 0
- accepted non-blocking tooling risk: 1 class / 4 transitive MODERATE advisories
- external blockers: explicitly classified below

No auth bypass, authorization bypass, cross-tenant leak, privilege escalation, secret exposure, destructive behavior, corruption path or unresolved HIGH was found by the final targeted gate.

## External blockers carried honestly

### Kordena real runtime
Required, when authorized values are available:
- `FMCC_KORDENA_CONTROL_TENANT_ID`;
- `FMCC_KORDENA_ALLOWED_ORIGINS`;
- `FMCC_KORDENA_CONTROL_PLANE_TOKEN`;
- real source registration;
- health/sync;
- canonical facts/provenance;
- compatible metric recompute.

Until then: READY_TO_CONNECT / CREDENTIAL_REQUIRED, never CONNECTED.

### Alert scheduler real runtime
Required:
- `FMCC_AUTOMATION_BASE_URL`;
- `FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET`.

Until then: READY_TO_CONFIGURE / RUNTIME_SECRET_REQUIRED.

### Provider/business decisions
Still not invented for:
- billing invoices;
- monetary delinquency;
- infrastructure FinOps;
- operating costs;
- CRM/leads;
- incident authority;
- service-error authority;
- usage/engagement;
- support.

### Pending semantics
Still explicit for executive metrics whose cohort/window/denominator/accounting definition is not canonically approved.

## Preview / Staging — critério histórico de fechamento

O commit documental final alterava o PR HEAD e, para fechamento, precisava receber:
1. Foundation Gate green;
2. Cognitive Gate green;
3. F21 Readiness Gate green;
4. exact final SHA in Render Preview;
5. health PASS;
6. readiness PASS;
7. unauthenticated dashboard protection PASS;
8. functional smoke on the same candidate.

Nenhum SHA de Preview anterior poderia ser reutilizado como prova do candidate final. Esse requisito foi posteriormente satisfeito pelo Preview Deployment Gate #4, attempt 2, no merge SHA de F21.

## Final state rule

Com a recertificação exact-head e a evidência de Preview concluídas, o veredito antes do Final Visual Premium é:

**FMCC — PRE-PREMIUM FINAL READINESS CERTIFIED WITH EXTERNAL BLOCKERS**

The external blockers above do not justify fabricated values and do not authorize production.

Production/cutover/F22 and Final Visual Premium remain outside this tranche.
