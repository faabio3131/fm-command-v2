# D11 — Asaas verified read-only payment/refund → atomic IRON entitlement outbox

Date: 2026-10-13. FM Command is the FM→gym billing authority; IRON remains the only owner of SaaS entitlements.

## Current technical reconciliation

- After #71/#72/#75/#76, FM Command owns product-specific invoices, subscription plans, provider payment ledger, versioned IRON plan mapping, durable outbox, and a **disabled-by-default** manual IRON dispatcher.
- The existing real Asaas payment **issuance** is a special controlled low-value Kordena Pix pilot, not a generic IRON payment issuer. The generic FM Command `prepare` flow creates internal invoices and placeholder customer identities but does **not** create a corresponding Asaas payment.
- Therefore, no production IRON invoice/payment is assumed to exist. New code cannot manufacture a provider payment or infer that a test result means production homologation.

## D11 delta — verified, atomic reconciliation

New read-only Asaas adapter `AsaasIronPaymentReadOnlyClient`:
- Authenticated `GET https://api.asaas.com/v3/payments/{paymentId}` only; allowlisted production secret reference `env://FMCC_ASAAS_PRODUCTION_API_KEY`; no provider POST, no webhook-body trust.
- Compares all fields against canonical FM Command billing evidence: `payment.id`, `payment.customer`, amount in minor BRL units, `payment.externalReference = fmcc-iron-<invoice UUID>` and supported billing type.
- Only `RECEIVED` is eligible for paid activation; `CONFIRMED` is not accepted. Full `REFUNDED` is eligible for controlled suspension. Partial refunds, chargebacks, disputes, overdue and other states are rejected for policy review instead of inventing a lifecycle policy.

`PostgresIronAsaasAtomicReconciliation`:
- Reads a **preexisting** provider payment binding and stable customer ID from Command. Validates FM tenant, IRON product, production Asaas gateway and canonical source/versioned plan mapping. No user/webhook-selected tenant or amount.
- Rechecks all scope fields **under invoice, payment and subscription row locks** in one PostgreSQL transaction. This prevents in-DB stale updates or cross-tenant reassignment.
- For RECEIVED, atomically updates provider payment→`received`, invoice→`paid`, subscription→`active`, creates a deduplicated `LICENSE_ACTIVATE` outbox event and writes an FM billing audit event.
- For REFUNDED after paid+received+active, atomically marks payment/invoice `refunded`, subscription `past_due`, creates a `LICENSE_SUSPEND` event and audits. It does **not** automatically cancel/delete the gym or change IRON entitlements. Refund duplicate is idempotent. A stale RECEIVED can never reactivate the already-refunded invoice.
- If outbox insert or audit fails, the **whole financial state update rolls back**. No provider-initiated reversal is created by this code.

**Gated endpoint:** `POST /api/billing/products/:productId/iron-license/asaas-reconcile` with `{ "password": "...", "invoiceId": "<UUID>" }`. Owner/admin with `billing:write`, current password step-up, and canonical FM control tenant only. Requires `FMCC_IRON_ASAAS_ATOMIC_RECONCILIATION_ENABLED=YES`, default OFF.

## Current limits and next operational blockers

- The generic IRON issuer must be built or reconciled with an existing canonical issuer; it must **persist the real `pay_...` and `cus_...` IDs** and set the new deterministic Asaas `externalReference` when issuing. Pending placeholder customer records are intentionally rejected. Without this work, this controlled route will refuse IRON invoices.
- This delta is **operator-triggered**. A future Asaas webhook inbox must verify `asaas-access-token` with a separate webhook `authToken`, persist event IDs, and use GET to validate current payment before reconciling; webhook data alone is not payment evidence.
- Transactional outbox delivery is a separate step and remains gated by manual+delivery+paid-reconciliation flags. No automatic event worker, payment issuance, or live license mutation is enabled.
- Race window between a verified provider GET and a later provider reversal cannot be eliminated with a single database transaction across services; a final provider check, webhook subscription and reversal reconciliation are required before go-live.
- Charging, applying real migrations, enabling flags, creating production webhook tokens, and certified provider-bound Command→IRON E2E require separate operational evidence and gates.
- Macro O Visual Premium PR #22 in IRON app is not part of this merge and continues awaiting explicit visual approval.

## Official Asaas documentation checked
- https://docs.asaas.com/reference/recuperar-uma-unica-cobranca
- https://docs.asaas.com/docs/webhook-para-cobrancas
- https://docs.asaas.com/docs/faq-de-webhooks

## Checkpoint
- Repositories: `faabio3131/FM-CONTROL-CENTER` and read-only IRON `faabio3131/iron-fit-backend`.
- Branch: `feat/d11-asaas-verified-atomic-iron-reconciliation`.
- CI: Vitest unit tests, isolated PostgreSQL transaction certification, Foundation lint/typecheck/build/E2E, F21/security and Cognitive Gate to verify on the exact final SHA.
- No automatic billing, no external payment POST, no LIVE integration claimed.

## D11 delta — inbox autenticado de webhook Asaas (14/10/2026)

Implementação candidata adiciona `POST /api/billing/webhooks/asaas/iron`, default OFF por `FMCC_IRON_ASAAS_WEBHOOK_INBOX_ENABLED`. Exige `asaas-access-token` idêntico ao segredo dedicado `FMCC_IRON_ASAAS_WEBHOOK_AUTH_TOKEN` (32–255 caracteres; **nunca** a API key REST), valida JSON limitado a 16 KiB e permite `PAYMENT_RECEIVED` e `PAYMENT_REFUNDED`. Ignora eventos de outros produtos. Resolva o invoice/gateway/tenant **somente** pelo PostgreSQL do Command e pelo identificador de fatura, jamais aceitando tenant/gym do payload.

A migration aditiva `0009_foundation` acrescenta metadados mínimos ao `fmcc_billing_gateway_event`: tipo do evento, payment ID, referência e hash sem PII. A unicidade existente protege o eventId e uma repetição semanticamente conflitante falha de modo seguro. O HTTP 200 significa unicamente *notificação recebida/deduplicada/ignorada*. **Não executa** liquidação, mutação financeira, webhook-to-license ou `subscription.status.sync`.

Antes de habilitar: conferir migrations no banco específico do runtime, cadastrar o authToken separado em cofre/env, configurar o webhook na conta correta, testar duplicidade e replay no ambiente autorizado, implementar worker idempotente que usa **GET autenticado** ao Asaas e a reconciliação atômica canônica, e validar falhas/cancelamento/estorno na matriz E2E. Sem esses gates a capacidade permanece `IMPLEMENTED / EXTERNAL BLOCKER` e **não homologada**.

Referências Asaas: https://docs.asaas.com/docs/sobre-os-webhooks ; https://docs.asaas.com/docs/como-implementar-idempotencia-em-webhooks .

## WP D11 — consumidor governado de eventos com GET Asaas (14/10/2026)

O inbox da PR #82 recebe e persiste o aviso com `eventId`, `paymentId`, referência e fingerprint, sem confiar no estado monetário recebido. Este WP adiciona uma fila PostgreSQL no mesmo domínio canônico (`0010_foundation`), com `SKIP LOCKED`, lease de 90 s, claimToken fencing, no máximo 12 tentativas, backoff e bloqueio para revisão de divergências. Só eventos do produto IRON, do tenant FM de controle e vinculados a faturas/gateways production Asaas canônicos são elegíveis.

O `VerifiedIronAsaasWebhookProcessor` compara o identificador financeiro persistido e faz GET de pagamento pelo `AsaasIronPaymentReadOnlyClient` já existente. Somente `RECEIVED` ou `REFUNDED` exatamente correspondente ao evento pode seguir para `PostgresIronAsaasAtomicReconciliation.commitVerified`, que registra estado financeiro, auditoria e outbox numa única transação. **Não chama diretamente a API de entitlement do IRON; outbox delivery permanece gate independente.** Eventos antigos, invoice trocada, divergência de status e paymentId incorreto falham sem conceder licença.

Endpoint interno: `POST /api/internal/billing/iron/asaas-webhook/process-one` com Bearer separado `FMCC_IRON_ASAAS_WEBHOOK_WORKER_SECRET` (mín. 32 caracteres), tenant resolvido do ambiente; a execução exige, simultaneamente, `FMCC_IRON_ASAAS_WEBHOOK_PROCESSOR_ENABLED=YES`, `FMCC_IRON_ASAAS_ATOMIC_RECONCILIATION_ENABLED=YES` e `FMCC_IRON_ASAAS_WEBHOOK_INBOX_ENABLED=YES`. Todas as flags permanecem OFF por padrão.

Agendamento configurável em `.github/workflows/fmcc-iron-asaas-webhook-reconciliation.yml` roda a cada 15 minutos e processa no máximo um evento por chamada. Sem a variável GitHub `FMCC_IRON_ASAAS_RECONCILER_BASE_URL` e o segredo específico do worker, apenas informa que não está configurado e não chama a API. Esse workflow **não comprova** existência de credenciais Asaas, migração operacional, homologação externa nem entrega real ao IRON.

**Gates operacionais obrigatórios antes de ativar:** migrações 0009/0010 verificadas no banco exato do runtime; token webhook separado do REST e do worker; webhook Asaas real cadastrado; conciliação de cliente/pagamento/planos verificada no banco; ensaio negativo e positivo em ambiente homologado; políticas de charges/refund/chargeback revisadas; alertas de retry/blocked e fila pausada. Sem isso, classificar `IMPLEMENTED / EXTERNAL BLOCKER`. Não habilitar flags ou fazer POST financeiro por CI.
