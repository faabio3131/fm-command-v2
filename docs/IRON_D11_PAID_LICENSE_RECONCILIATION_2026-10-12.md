# D11 — IRON paid-license reconciliation (CURRENT)

Date: 2026-10-12. Scope: existing FM Command and IRON FIT CORE, no parallel billing system.

## Reconciled authoritative implementation

- FM Command is financial authority for **FM Tecnologia → academia** (billing); IRON remains operational authority for academia data and product entitlements.
- Command has canonical product billing tables (plan/price, product-to-gateway route, customer binding, subscription, invoice, provider payment); `main` SHA before D11: `7d2dbfee16ddd7681b7134ae041f9357d8caaca4` (#70).
- IRON has service-to-service `control-plane/fmcc/subscription/commands`, token guard, tenant subscription lifecycle, audit and durable idempotency; IRON backend `main` SHA: `c74567727f98ed018126194bb695dedba0c3a5d0`.
- IRON connector in Command already supports snapshot + subscription commands, HTTPS origin allowlist, source tenant isolation and secret reference.

## Increment implemented on D11 branch

`POST /api/billing/products/:productId/iron-license/reconcile` is deliberately **OFF** unless `FMCC_IRON_PAID_LICENSE_RECONCILIATION_ENABLED=YES`.

Only authorized Command OWNER/ADMIN with `billing:write` and password step-up can call it. The browser supplies only invoice ID and step-up password; it may not supply the payment state, gateway route, amount, destination gym, target entitlement or IRON subscription.

Command independently verifies the canonical invoice/payment in its PostgreSQL using exact tenant+product+invoice+customer-binding+subscription+gateway+active route, `invoice=paid`, `payment=received`, gateway `production`, amount >0 and product slug `iron-fit-core`. It then reads the IRON canonical snapshot over the existing connector, enforces unique gym-subscription and **exact plan-code** identity, and sends an idempotent `subscription.status.sync` command to the existing server-side IRON control plane. Mismatched/unmapped plan fails closed.

An audit event is recorded; failures are redacted. No gateway webhook grants licenses. No secrets are stored in frontend.

## Limitations / remaining launch gates

This is a **controlled internal manual reconciliation path**, not full autonomous paid subscription activation and not a production homologation.

1. Verify/version the mapping between Command commercial plan code and IRON canonical plan code/version. Until mapped, mismatch must fail closed.
2. Add certified durable outbox for provider-confirmed payment/cancellation/refund and replay-safe Command→IRON activation/withdrawal, with reconciliation after retries.
3. Audit financial lifecycle (grace, delinquency, suspension, upgrade/downgrade, cancellation, refund), race between reversal and activation, tenant rebind and replay.
4. Validate migrations on operational database (never infer schema applied from CI alone).
5. Perform credential-bound real gateway/Command/IRON integration E2E and negative tests. Only then consider enabling the feature flag in a controlled environment.
6. Review D11 under Macro O; final Visual Premium PR merge still needs explicit approval.

## Certification

Automated tests: `tests/iron-paid-license-reconciliation.unit.test.ts`, Command CI (Foundation + F21 + Isolated PostgreSQL). Track evidence in PR #71 and its latest CI run. **No PASS is claimed until runs finish**.

## Checkpoint

- Macro O, D11 incremental.
- Repo `faabio3131/FM-CONTROL-CENTER`
- Branch `feat/d11-iron-paid-license-reconciliation`; PR #71 Draft until certified.
- Backend IRON `main` SHA `c74567727f98ed018126194bb695dedba0c3a5d0`.
- No merge, no release, no external payment claim.
- Next gate: CI, diff review, resolve any failures; auxiliary merge only if green and safe; D11 external certification stays pending.
