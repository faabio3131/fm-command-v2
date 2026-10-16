# FM Command — Central Billing / Asaas Sandbox

Status: **IMPLEMENTATION IN PROGRESS — NOT PRODUCTION APPROVED**.

## Commercial authority
FM Tecnologia sells all SaaS through FM Command. The product runtime never becomes the payment system of record. Each checkout is bound to the canonical tenant, FM customer, product, plan/subscription, invoice and gateway account **before** a payment provider is invoked.

## Attribution contract (first implementation)
`src/domain/billing/payment-attribution.ts` validates immutable commercial bindings and rejects unknown invoices, amount mismatches, environment mismatches and gateway-account mismatches. `tests/billing-payment-attribution.test.ts` covers those conditions. This is a domain guard, not a complete payment integration.

## Mandatory implementation gates
1. PostgreSQL tables and unique constraints for gateway accounts, customers, product plans, subscriptions, invoices, provider payments, provider event inbox and audit ledger. Scope uniquely by FM tenant and provider account; persist provider IDs and monetary minor units without floating point. Foreign-key product and customer bindings and immutable invoice identity.
2. Vault-backed `secretRef` resolver, encrypted persistence, least-privilege staff administration, credential creation/rotation/revocation, audit history; never persist API keys in regular configuration or logs.
3. Asaas Sandbox adapter: authenticated server-side API client, deterministic idempotency, bounded timeouts, no withdrawals, appropriate account-specific base URL; remote customer, checkout/payment and subscription lifecycle.
4. Verify Asaas webhook authentication using the provider-supported mechanism, maintain replay-resistant event inbox with account/environment/external event uniqueness, acknowledge only durable reception, re-fetch/check provider state before releasing licenses, and process safely with retries.
5. Reconciliation worker compares gateway charges/refunds against canonical invoices, records discrepancies, never reassigns product/customer attribution from untrusted webhook metadata.
6. Entitlements outbox and tenant/product-scoped license delivery only after confirmed payment, with retry, audit and revocation rules.
7. Governed Billing admin UX in pt-BR and complete gates: isolated tests for two SaaS, two customers, same customer in two SaaS, concurrency, replay, refunds, failed payments, secret rotation and sandbox/production isolation.

## Current access and safety
Asaas Sandbox key has been created by the account owner but **not** shared in chat, committed or installed. Render `fmcc-preview-web` is preview and must not be used as proof of production readiness. Gateway secrets are not configured until the vault/credential binding is verified. No real-money action or automatic funds withdrawal is authorized.
