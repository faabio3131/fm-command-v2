# D11 — Durable IRON entitlement outbox (controlled infrastructure)

Date: 2026-10-13

## Current reconciliation
- FM Command is authoritative for `FM Tecnologia → academia` billing (invoices, gateway route, payments, commercial subscriptions); IRON's API is authoritative for `TenantProductSubscription` and entitlements.
- The Command D11 manual verified-payment gate already validates `paid + received + production + correct product/gym` and versioned plan mapping. It is disabled by default.
- Current live provider reconciliation is specifically the controlled Asaas Pix pilot (fixed low-value fixture), **not** a certified generic gateway-event ingress for all IRON subscribers. Do not extrapolate.
- IRON control-plane has server-to-server authentication and durable idempotency but terminal `FAILED` events are not silently replayable; uncertain outcomes require reconciliation.

## This delta
Canonical `fmcc_billing_iron_entitlement_outbox` PostgreSQL table plus additive migration `0007_foundation`. It is an outbound delivery ledger, not a new payment authority.

- Each event requires tenant + product + invoice + subscription + event type.
- Only known events `LICENSE_ACTIVATE`, `LICENSE_SUSPEND`, `LICENSE_CANCEL`. Each is bound to canonical billing subscription status: `active`, `past_due`, `cancelled`, respectively. Activation requires invoice `paid` AND provider payment `received` AND a production-enabled gateway route. Unverified or mismatched state fails closed.
- Transactional enqueue validates with locked canonical invoice/subscription, and uses a unique deduplication key scoped by tenant/product/creator invoice.
- Claim uses `FOR UPDATE SKIP LOCKED`, lease and attempt bounds (12), plus per-subscription ordering guard.
- Acknowledgement/failure require the active claim token and unexpired lease; stale workers cannot confirm another worker's work.
- Retries use bounded exponential backoff, terminal `blocked` state and safe error codes; no tokens or payment credentials in payload.
- PostgreSQL isolated certification covers the migration, index, deduplication, constrained event type, tenant fence, competing claims, crash/lease recovery and stale-token fencing. The normal unit suite covers negative cases.

## Deliberately not active
This delta only implements **durable enqueue + claim + acknowledge/fail primitives**. It does not invoke IRON, expose unguarded worker execution, automatically process gateway events, claim a real refund/cancellation proof or enable a production flag. Existing controlled payment reconciliation stays disabled. A dispatcher must revalidate **current** canonical state (including reversal and plan version) before every external call and enforce tenant + subscription order, especially after timeout. Existing IRON idempotency semantics require handling ambiguous results.

## Next gates
1. Implement gated dispatcher and verified gateway-event ingest with transactional outbox insertion in the *same transaction* as financial state change; never treat webhook JSON as proof.
2. Implement verified reversal, cancellation and dunning state transitions; map grace/late/suspended/revoked safely, with new anti-stale tests.
3. Perform credential-bound E2E Command ↔ real IRON and gateway (production or explicitly sandbox), rollback/recovery, tenant isolation and no false provider certification.
4. Apply additive migration to operational DB only after controlled backup/migration gate; green disposable-PostgreSQL CI is not proof production DB migrated.
5. IRON Macro O Visual Premium PR #22 still requires explicit visual approval before merge.

## Work checkpoint
- Macro O — D11 internal outbox infrastructure.
- Command repo `faabio3131/FM-CONTROL-CENTER` branch `feat/d11-durable-iron-entitlement-outbox`.
- No live provider action, secrets, external entitlement mutation or production deployment.
- Track PR, CI, exact SHA, migrations and blockers after execution; do not declare end-to-end license delivery certified.
