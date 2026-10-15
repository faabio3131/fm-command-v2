# FM CONTROL CENTER — F09 ADDENDUM
# KORDENA GOVERNED COMMERCIAL READ CAPABILITY

**Status:** FINAL RECONCILIATION CANDIDATE — F16-F19 + KCA-12 + cognitive evidence reconciled
**Version:** 0.1
**Date:** 2026-09-23
**Parent architecture:** F09 — FM Cognitive Vertical Core
**Canonical decision:** ADR-013 — Product-Owned FM Cognitive Vertical Core
**Cognitive PR:** #17
**Dependency:** FMCC KCA-12 PR #16

## 1. Purpose

Extend the existing FMCC Cognitive Vertical Core so it can answer product-scoped
executive questions about the current Kordena commercial state using the
canonical KCA-12 read contract.

This addendum is **not KCA-13** and does not expand Observability, Antiabuse or
FinOps.

## 2. CURRENT discovery

The current canonical FMCC already contains:

- product-owned `FmccVerticalCognitiveCore`;
- Cognitive Model Port and OpenAI-compatible adapter;
- `CoreGateway`;
- Metric Registry + Metric Engine;
- tenant/user-scoped operational context from the Audit Ledger;
- product-scoped intelligence;
- source/provenance evidence;
- safe degradation when the cognitive provider fails.

Therefore this block did **not** create a second Core.

### Historical assets classified

#### CURRENT CANONICAL

In `faabio3131/FM-CONTROL-CENTER`:

- `FMCC-00-ADDENDUM-CORE-VERTICAL-PROPRIO-v0.2.md`;
- `docs/architecture/adr/ADR-013-product-owned-vertical-core.md`;
- `FMCC-09-COGNITIVE-CORE-GATEWAY-v0.1.md`;
- current Core/Metric/Integration/Product Intelligence implementation on the
  FMCC line.

#### HISTORICAL / CONFLICTING

In `faabio3131/fm-ai-platform`:

- `feat/shared-core-fmcc-context-intelligence`;
- `feat/shared-core-fmcc-runtime`;
- `feat/shared-core-fmcc-service`.

These branches belong to the superseded interpretation in which FMCC cognitive
runtime lived inside another SaaS.

#### HISTORICAL CORRECTION / ARCHITECTURAL EVIDENCE

- `fix/remove-fmcc-cross-product-core`.

Its history explicitly removes the cross-product FMCC artifact. It is evidence
of the correction, not a branch to promote.

#### HISTORICAL IMPLEMENTATION LINES ALREADY RECONCILED

In the FMCC repository:

- `feat/fmcc-f07-f10-intelligence-stack`;
- `feat/fmcc-f11-product-intelligence`;
- `feat/fmcc-f12-f15-business-operations`;
- `feat/fmcc-f16-f19-advanced-intelligence-readiness`.

The current FMCC line contains the reconciled architecture. These branches are
not used as a new base.

## 3. KCA-12 dependency

Kordena KCA-12 is integrated in
`staging/kordena-premium` at merge/head:

`9c52fd998e04c4d723171917f3776c9da7295858`

The Kordena side exposes:

`kordena.fmcc.commercial.v1`

The FMCC KCA-12 control-plane implementation remains in PR #16:

- branch: `feat/fmcc-kordena-commercial-control-plane`;
- documentary HEAD used as cognitive base:
  `f53ad1c449565feee665687b993aed532ff468e7`;
- PR #16 remains OPEN/DRAFT and unmerged.

PR #17 is intentionally stacked on PR #16. It does not modify FMCC `main`.

## 4. Resulting cognitive architecture

```text
User question
   |
   v
FMCC Cognitive Vertical Core planner
   |
   +--> Governed Metric IDs ----------> Metric Engine / deterministic services
   |
   +--> Governed Read Capability IDs -> capability boundary
                                          |
                                          v
                             KordenaCommercialControlService
                                          |
                                          v
                              KCA-12 canonical snapshot
                                          |
                                          v
                              Kordena commercial authority

facts/evidence from authorized sources
   |
   v
Cognitive synthesis
   |
   v
answer + provenance + factual status
```

No LLM call writes Kordena data.

## 5. New capability contract

A generic read-only cognitive contract was introduced:

- `CoreReadCapabilityDescriptor`;
- `CoreReadCapabilityResult`;
- `CoreReadCapability`;
- `CoreReadCapabilityContractError`.

The first registered capability is:

`commercial.kordena.summary`

It is product-scoped to:

`kordena`

It consumes the existing
`KordenaCommercialControlService.snapshot(...)`.

It does not call the command/write boundary.

## 6. Authority model

The authority chain remains:

```text
Core
→ selects allowlisted metric/capability
→ tenant/RBAC scope
→ governed read service
→ canonical deterministic authority
→ source fact/evidence
→ synthesis
```

Authorities are unchanged:

- metrics: Metric Engine / deterministic domain services;
- Kordena current commercial state: KCA-12 canonical commercial snapshot;
- product scope: Product Registry;
- source scope: Source Registry;
- tenant/RBAC: FMCC security context;
- Kordena commercial mutation: existing canonical Kordena catalog authority;
- cognition: interpretation/synthesis only.

The Core does not become an authority for billing, entitlement, subscriptions,
pricing, tenant, identity, RBAC or payments.

## 7. Planner guardrails

The cognitive model can select only IDs supplied in server-side allowlists:

- `metricIds`;
- `capabilityIds`;
- `productSlugs`.

Limits:

- up to 8 metrics;
- up to 4 read capabilities;
- up to 4 products;
- at least one authorized metric or capability.

An invented capability such as `database.raw_query` is rejected.

A Kordena-specific capability cannot be used as if it represented an unrelated
product.

A Kordena-only summary is also **not accepted as a company-global total**.
The Kordena capability requires explicit product scope.

## 8. Kordena commercial capability

The capability returns only a minimized current-state fact:

- capability id;
- product id/slug/name;
- snapshot `as_of`;
- schema version;
- mapping version;
- governed summary;
- coverage/dependency declarations.

It intentionally does not send to the model:

- service token;
- secret reference;
- source base URL;
- source private configuration;
- raw credentials;
- direct database handles.

## 9. Provenance

Available capability data is rejected unless evidence contains:

- source reference;
- source authority;
- freshness status;
- quality status;
- non-empty provenance references.

Kordena provenance includes:

- `source:<sourceId>`;
- `mapping:<mappingVersion>`;
- `schema:kordena.fmcc.commercial.v1`;
- `asOf`.

The LLM cannot replace this evidence.

## 10. Freshness

The Kordena commercial snapshot is treated as current-state data.

Freshness is fail-closed:

- source-specific `freshnessSeconds` is used when defined;
- otherwise default maximum age is 300 seconds;
- an `as_of` more than 60 seconds in the future is rejected;
- stale data becomes `unavailable` for cognitive use.

Stale state is not silently presented as current.

## 11. Missing data and metric semantics

The Core does not convert absence to zero.

Kordena KCA-12 coverage still marks dependencies such as MRR, ARR, churn,
monetary delinquency, health/cost/support sources when those semantics are not
available.

This block does **not** fabricate those metrics.

In particular, `subscription.active.count` is not synthesized from a naive
append-only `subscription.active` fact because a later cancellation could
leave a false active count. Current Kordena subscription/trial state is read
from the canonical snapshot until a stateful/as-of metric semantic is formally
implemented.

## 12. Security

Certified controls include:

- tenant-scoped product lookup;
- tenant-scoped source lookup;
- existing KCA-12 internal control-tenant protection;
- existing KCA-12 dedicated secret reference and origin allowlist;
- `commercial:read` required by the Kordena capability;
- no `commercial:write` in cognitive capability composition;
- no Kordena command capability exposed to the planner;
- no direct database import from the Kordena cognitive capability;
- no insert/update/delete path;
- source failure sanitized to unavailable evidence;
- authorization/cross-tenant errors preserved and returned fail-closed;
- incompatible tool result rejected as contract error;
- available source data without provenance rejected.

The first cognitive Kordena capability is strictly read-only. Therefore no
cognitive step-up bypass is introduced. Any future mutational capability must
use the existing governed command path with RBAC + step-up + deterministic
authority + audit and requires a separate review.

## 13. Executive query coverage

The current Core can ground:

- faturamento through governed metrics;
- Kordena active trials/current subscriptions/past due/payments through the
  KCA-12 current-state capability;
- delinquency when the governed
  `receivable.delinquent_amount` metric exists;
- operational health when governed health/incident metrics exist.

MRR/ARR and other unavailable metrics remain unavailable until their governed
definitions and source values exist.

## 14. Functional candidate

Cognitive functional candidate:

`362595ea3c93f389d01b7e1d374c3fdb997c2c9c`

PR:

`#17 — feat(core): connect governed Kordena commercial read capability`

Base:

`feat/fmcc-kordena-commercial-control-plane` @
`f53ad1c449565feee665687b993aed532ff468e7`

No migration or schema change was introduced by the cognitive block.

## 15. Functional certification

Workflow:

`FMCC Cognitive Governed Intelligence Gate`

Result on the functional candidate: **SUCCESS**.

### Targeted

- 8 test files PASS;
- 50 tests PASS.

Specific suites include:

- Core Gateway: 14 tests;
- Cognitive model adapter: 8 tests;
- Kordena commercial cognitive capability: 7 tests;
- Core governed capability architecture: 4 tests;
- Core Audit + tenant isolation: 3 tests;
- KCA-12 Kordena connector: 6 tests;
- KCA-12 commercial security: 3 tests;
- Core ownership architecture: 5 tests.

### Full regression

- 35 test files PASS;
- 138 tests PASS.

### Other gates

- lint: PASS;
- TypeScript typecheck: PASS;
- schema generation/no drift: PASS;
- migrations: PASS;
- production build: PASS;
- strict diff whitespace: PASS;
- runtime dependency audit at HIGH threshold: PASS.

NPM reports 4 moderate transitive advisories related to esbuild tooling. No
HIGH/CRITICAL finding failed the configured gate.

## 16. Corrections made during certification

Two real certification issues were found and corrected:

1. after provenance became mandatory, an older test fixture still represented a
   capability as valid without `provenanceRefs`; the fixture was corrected,
   preserving the stricter runtime contract;
2. the first cognitive workflow used a shallow checkout, so strict diff
   validation could not resolve the stacked PR base SHA. The workflow now uses
   full history (`fetch-depth: 0`) and keeps the diff gate enabled.

No test was weakened or skipped.

## 17. Limitations / future dependencies

Not part of this block:

- KCA-13 Observability / Antiabuse / FinOps;
- complete enterprise-global coverage across all Nova FM products;
- new MRR/ARR/churn semantics;
- mutational cognitive capabilities;
- provider/billing production homologation;
- public release.

Global company questions remain unavailable when only product-specific evidence
is available.

## 18. Technical gate

The functional candidate satisfies:

- Core consumes governed source data;
- no parallel commercial authority;
- provenance is mandatory;
- missing data is not invented;
- tenant and product scope are fail-closed;
- RBAC remains deterministic;
- only allowlisted read capabilities are available;
- adversarial tests are green;
- full regression is green;
- CI is green.

**Functional cognitive gate: PASS on
`362595ea3c93f389d01b7e1d374c3fdb997c2c9c`.**

## 19. Documentary recertification

The first documentary HEAD failed only strict whitespace validation because the
Markdown header contained trailing spaces. No functional gate failed.

The corrected documentary HEAD:

`4821d5bc6c08359c92e0fc1dae053c4d3f2a5206`

was recertified with **FMCC Cognitive Governed Intelligence Gate — SUCCESS**:

- lint: PASS;
- TypeScript: PASS;
- schema/no drift: PASS;
- migrations: PASS;
- 8 targeted files / 50 targeted tests: PASS;
- 35 test files / 138 full-regression tests: PASS;
- production build: PASS;
- strict diff whitespace: PASS;
- runtime dependency audit at HIGH threshold: PASS.

The present closure commit records that evidence and becomes the final candidate
HEAD. Per governance, this exact HEAD must itself be recertified before the
technical/documentary gate is considered finally closed. No further content
change is required after a green recertification; the PR check is the closing
evidence.


## 20. Reconciliation with FMCC F16-F19 CURRENT

After the first cognitive certification, FMCC `main` legitimately advanced to
the F16-F19 certified line:

`175f4847eba16b7361929d35a780dc22a39ff95b`

KCA-12 PR #16 was reconciled non-destructively and its final documentary HEAD is:

`8d420bcdfac9da82b730e183547eb2ae0fd18ca2`

with FMCC Foundation Gate **SUCCESS**.

The cognitive branch then absorbed that current KCA-12 base through a
non-destructive merge. Reconciled cognitive candidate:

`50214ad12564818d6d6de57e75c6723806580516`

The reconciliation explicitly preserved both cognitive lines:

- F16 reasoning guardrails:
  - separate fact / inference / recommendation / forecast;
  - no causal claim from correlation without causal evidence;
  - no classified anomaly/risk/numeric forecast without deterministic signal;
  - evidence insufficiency must remain explicit;
- Kordena governed capability planner:
  - server-side metric/capability/product allowlists;
  - product-specific capability cannot represent a global company total;
  - read-only Kordena snapshot capability;
  - provenance/freshness fail-closed.

No F16-F19 alert, executive intelligence or security surface was removed.

### Exact-head certification on the reconciled cognitive candidate

FMCC Cognitive Governed Intelligence Gate on
`50214ad12564818d6d6de57e75c6723806580516`: **SUCCESS**.

- lint: PASS;
- TypeScript: PASS;
- schema/no drift: PASS;
- migrations: PASS;
- targeted: 8 test files / 51 tests PASS;
- cognitive model adapter: 9 tests PASS;
- Core Gateway: 14 tests PASS;
- Kordena cognitive capability: 7 tests PASS;
- full regression: 44 test files / 174 tests PASS;
- F19 adversarial and tenant-isolation suites remain green;
- production build: PASS;
- strict diff whitespace: PASS;
- runtime dependency audit at HIGH threshold: PASS;
- 4 moderate transitive advisories remain reported; no HIGH/CRITICAL gate
  failure exists.

This final documentation reconciliation creates a new HEAD. That exact HEAD must
pass the cognitive governed gate. The PR check on that SHA is the closing
technical/documentary evidence and does not require another content-only commit.
