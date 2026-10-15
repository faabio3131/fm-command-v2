# FMCC — F21 Readiness Matrix v0.1

Baseline: main@e6d6e9b33f126d210651a4adbb3ed14ed12b0492
Working branch: feat/fmcc-f21-readiness-pre-premium-final
Status: CLOSED / CERTIFIED — PRE-PREMIUM FINAL READINESS CERTIFIED WITH EXTERNAL BLOCKERS

| Item | CURRENT | TARGET | Evidence / gap | Severity | External blocker | Status |
|---|---|---|---|---|---|---|
| Authentication | Better Auth + server-side protection certified in F20 | preserve | F20 + tests | — | no | verified |
| Authorization/RBAC | server-side permissions + step-up paths | preserve | F20/security tests | — | no | verified |
| Tenant isolation | tenant-first repositories + adversarial coverage | preserve | integration/adversarial tests | — | no | verified |
| Sessions | protected dashboard/auth flows | preserve | Preview + E2E | — | no | verified |
| Secrets | env/secretRef + sanitizer + scan | preserve/operationalize rotation | runbook + F21 secret scan 247 files PASS | — | no | verified |
| APIs | protected contracts | preserve | F20 | — | no | verified |
| Cognitive Core | product-owned, grounded, fail-closed | preserve | cognitive gate/F20 | — | provider runtime may vary | verified |
| Core × deterministic authority | separated | preserve | ADRs/tests | — | no | verified |
| Integration Fabric | retries/idempotency/timeout/provenance | preserve | F20 | — | no | verified |
| Kordena runtime | contract certified, real FMCC runtime not proven connected | real runtime evidence when secrets exist | credentials/source/health/sync absent | external | CREDENTIAL_REQUIRED | blocked externally |
| Source Registry | governed and tenant-scoped | preserve | tests | — | no | verified |
| Canonical facts | governed ingestion/provenance | preserve | tests | — | source availability varies | verified |
| Provenance | persisted/required in governed flows | preserve | tests | — | no | verified |
| Metric Registry | 24 executive targets, some pending semantics | no invented semantics | registry/discovery | external | BUSINESS_SEMANTICS_REQUIRED | explicit |
| Metric Engine | deterministic supported metrics | preserve | tests | — | no | verified |
| Alerts | deterministic, idempotent, auditable | preserve | F20 | — | no | verified |
| Automation scheduler | workflow exists; runtime vars not proven configured | real scheduled evidence when vars exist | env runtime evidence absent | external | RUNTIME_SECRET_REQUIRED | blocked externally |
| Audit Ledger | append-only logical + sanitizer | preserve | ADR/F20 | info | retention decision external | accepted |
| Migrations | versioned + schema gate | preserve | Foundation Gate | — | no | verified |
| DB constraints | explicit schema/indexes | preserve | schema/tests | — | no | verified |
| Logging | structured JSON + redaction | operational runbook | consolidated runbook + existing logger | — | no | verified |
| Health | endpoint certified | preserve | Preview gate | — | no | verified |
| Readiness | endpoint certified | preserve | Preview gate | — | no | verified |
| Correlation | integration/core/audit coverage | preserve | implementation/tests | — | no | verified |
| Observability | logs + health/readiness; no approved SLO/vendor | honest operational readiness | no uptime/SLO fabrication | external | provider/SLO decision for deeper layer | partial/explicit |
| Backup | provider plan retention unknown | real non-prod restore proof | F21 Gate #2 pg_dump PASS | — | provider retention/RPO/RTO unknown | verified technically |
| Restore | isolated restore gate added | isolated restore smoke | F21 Gate #2 pg_restore + schema verification PASS | — | no for CI | verified |
| Rollback | explicit code/config/schema/data procedure documented | preserve/test proportionally | consolidated F21 runbook | — | destructive data rollback still authority-gated | verified procedure |
| Incident handling | consolidated procedure exists | executable runbook | F21 runbook | — | no | verified |
| CI | Foundation + cognitive + F21 gates | preserve | pre-document #436/#111/#2 SUCCESS; final candidate recertified; pós-merge Foundation #442 e F21 #8 SUCCESS | — | no | verified |
| Docker | certified | preserve | F20/Foundation | — | no | verified |
| Supply chain | lockfile/npm ci/SHA-pinned Actions; 4 MODERATE dev tooling | preserve and re-audit | accepted F20 risk | accepted | safe upgrade not established | accepted |
| Preview/Staging | exact SHA/health/ready/auth gate | preserve | Preview Deployment #4 attempt 2 SUCCESS em `edb5b872587c02ee41824dc9f593d9cf0d7c4ea2` | — | no | verified |
| Runbooks | consolidated F21 operations runbook | preserve | required sections contract PASS | — | no | verified |
| Config contracts | env example + runtime validation | preserve and validate | readiness contract PASS | — | runtime values external | verified |
| Operational documentation | F21 matrix/report/runbook reconciled | preserve | second pass documented | — | no | verified |

## Explicit external blockers

- Kordena real runtime credentials/source: CREDENTIAL_REQUIRED.
- Alert scheduler real runtime configuration: RUNTIME_SECRET_REQUIRED.
- Provider decisions for billing invoices, monetary delinquency, infra FinOps, operating costs, CRM/leads, incident authority, service-error authority, usage/engagement and support: PROVIDER_DECISION_REQUIRED unless newer CURRENT proves otherwise.
- Pending executive metric semantics: BUSINESS_SEMANTICS_REQUIRED.
- Provider-specific backup retention/RPO/RTO and deeper observability/SLO policy: do not invent.

External blockers do not authorize fake data, fake providers or a false CONNECTED state.


## Internal adapter investigation

`job.failure.count` and `integration.failure.count` remain candidates for an internal governed adapter, but the CURRENT does not define an approved canonical internal source authority/registration contract for those facts. Creating one merely to turn the metrics green would invent authority. Their implementation is therefore deferred until an architectural/domain authority explicitly defines that source boundary.

## Green evidence before final documentation commit — snapshot histórico

- Foundation Gate #436 — SUCCESS.
- Cognitive Governed Intelligence Gate #111 — SUCCESS.
- F21 Operational Readiness Gate #2 — SUCCESS.
- Full regression: 51 files / 200 tests PASS.
- Browser E2E: 6/6 PASS.
- F21 security/tenant subset: 6 files / 20 tests PASS.
- Secret scan: 247 tracked files PASS.
- Isolated PostgreSQL backup/restore: PASS.
- Runtime smoke/Docker/dependency HIGH threshold: PASS.

O requisito acima foi satisfeito no fechamento: PR #23 MERGED/CLOSED em `edb5b872587c02ee41824dc9f593d9cf0d7c4ea2`, Foundation #442 SUCCESS, F21 Readiness #8 SUCCESS e Preview Deployment #4 attempt 2 SUCCESS no SHA exato, com health/readiness e proteção anônima do dashboard verdes.
