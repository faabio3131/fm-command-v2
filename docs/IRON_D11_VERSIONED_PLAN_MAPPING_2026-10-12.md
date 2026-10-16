# D11 — Versioned Command → IRON entitlement plan mapping

Checkpoint: 2026-10-12. Repository: `faabio3131/FM-CONTROL-CENTER`.

## Verified CURRENT

FM Command `main@6d971e51cda56c32cb5003914f7d3c913620d41a` already owns FM→academia billing with product-scoped commercial plan code, invoice, gateway and payment evidence. IRON backend `main@c74567727f98ed018126194bb695dedba0c3a5d0` owns `ProductPlan + ProductPlanVersion` and publishes versioned subscription snapshots (`plan_code`, `plan_version`), with service-to-service `subscription.status.sync` behind idempotency/audit.

## D11 increment

No new billing authority or schema is added. Mappings are persisted under the **existing** `fmcc_source_definition.config` tenant/product-scoped Integration Fabric authority, for the canonical IRON commercial source.

The versioned mapping contract `iron.commercial-plan-mappings.v1` is a strictly validated, append-only list of:

- revision (monotonically increasing);
- commercial plan code (unique for the entire lifecycle);
- IRON canonical plan code;
- IRON canonical version (positive integer);
- effectiveFrom timestamp (time binding for invoice issuance).

FM Command administrative owner/admin must have `billing:write` **and password step-up** to register a mapping at `POST /api/billing/products/:productId/iron-plan-mappings`. `GET` is permission-scoped to authorized administrators. Registration requires an active FM-owned commercial plan and an existing canonical IRON integration source; mapping is guarded with PostgreSQL row lock and scope lock. Mapping for a given commercial code cannot be changed; a new IRON entitlement version **requires a new FM commercial plan code**. No invented plan pricing/entitlements.

For IRON, invoice preparation now rejects an unmapped plan **before the invoice is created**. The invoice transaction and mapping registration both use the same PostgreSQL advisory lock, preventing a race around mapping activation. A previously issued invoice remains ineligible if its creation timestamp precedes the mapping's `effectiveFrom`.

At the gated, manual paid-invoice reconciliation stage (default feature flag **OFF**), the Command validates its own paid+received+production evidence and uses the existing IRON snapshot to verify **exact** plan code and plan version. Mismatch, missing source, missing mapping, invalid mapping or pre-mapping invoice fails closed. The Command never grants feature keys; the IRON backend remains the entitlement authority.

## Current restrictions

- No automatic payment-webhook entitlement grant.
- No gateway payment/customer credentials stored in plan mapping.
- No UI/admin page claimed beyond the implemented protected API.
- No implicit upgrade or downgrade; the controlled path only syncs status against the existing matching IRON subscription.
- Registration validates format and FM commercial plan existence; the **actual IRON plan/version** is validated against the canonical subscription on reconcile. External-plan publication or new-plan provisioning is not claimed.
- Refund/chargeback/cancellation outbox, version transitions, real provider credential-bound E2E and production flag enablement remain separate mandatory D11 gates.
- Visual Premium Macro O PR #22 cannot merge without explicit user visual approval.

## Certification / next

Tests: `tests/iron-versioned-plan-mapping.unit.test.ts`, `tests/iron-paid-license-reconciliation.unit.test.ts`, generic product billing regressions; gated GitHub workflows and PostgreSQL CI. Record actual SHA, PR, CI outcome and deploy only after execution. No production claims from mock tests or CI alone.
