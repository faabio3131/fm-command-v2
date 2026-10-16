# IRON D11 — Safe generic Asaas Pix issuance in FM Command

Date: 2026-10-13. Current baseline Command `f865e45b9994c8a564d07b158354bbf3c2a6ce6f`. IRON owns runtime entitlements; Command owns FM→academia billing.

## Scope

Adds generic guarded **IRON** Asaas hosted charge issuance from canonical FM Command invoices, without copying invoice/subscription rules into IRON and without using the old fixed-value Kordena pilot.

- The Command authoritative plan/invoice amount, academy binding, gateway account, active product route, immutable IRON plan code/version mapping and creation date are read from its PostgreSQL.
- The Asaas customer MUST already exist with an exact provider-side `externalReference=fmcc-iron-customer-<gymUUID>` and a verified `cus_...` ID. Do not trust a freely chosen customer ID or phone/email/CPF from the browser. Customer enrollment is a separately governed prerequisite and is not assumed complete.
- Authenticated `GET /customers/{id}` proves the canonical academy identity; input provides only invoiceId, Asaas customer ID and due date. Financial amount and reference cannot come from input.
- Exactly one persisted `fmcc_billing_iron_issue_claim` reserves the invoice **before contacting** the provider, with a unique invoice and `externalReference=fmcc-iron-<invoiceUUID>`. New Drizzle additive migration `0008_foundation`.
- The issuer always preflights `GET /payments?externalReference=...`. Zero candidates permits **one** `POST /payments` on the *new* reservation only. A nonempty, ambiguous or incomplete provider response cannot generate another POST.
- Timeout, network error or persistence failure is marked uncertain. Another attempt uses **GET-only recovery**, never automatic POST replay; missing payment after uncertainty is a human-review gate. Provider ID is persisted under the same local invoice + gateway binding with idempotent conflict checks.
- Provider confirmed receipt, refund, audit and IRON entitlement outbox are handled by the previously certified D11 reconciliation, not by issuance. Issuance itself cannot grant license.
- `POST /api/billing/products/:productId/iron-license/asaas-issue`: `{action:"issue",password,invoiceId,customerId,dueDate}` or `{action:"recover",password,invoiceId}`. Owner/admin, billing write permission, password step-up and **FM control tenant** only. Flag `FMCC_IRON_ASAAS_ISSUANCE_ENABLED=YES` default OFF.

## Operational limitations / gates

The provider customer enrollment and provider-account KYC need certified readiness; no claim that new IRON subscribers can already purchase or that the Asaas account is homologated for generic Pix. The migration is additive and must be checked against the specific runtime database before any flag is enabled. The real business calendar/tax/fiscal policy, provider webhook inbox, scheduled worker and tenant plan transitions remain separate gates. Production payment POST is never called by CI.

**Out of scope:** gym→student financial operations remain inside IRON and never pass through the FM Command SaaS billing issuer. The Command manages FM→gym invoices only.

## Data/API boundary of IRON-owned external APIs

Per the user-approved architecture, the API that feeds IRON's own business features must execute **in IRON**. Command may centrally provision managed configuration/secret references, quotas, cost allocation and read **governed usage reports**, but must not proxy every operation, become the IRON domain runtime, expose credentials to browsers, or claim ownership of its operational API. Specifically, IRON's current `src/modules/ai/` and `src/modules/integrations/` already own runtime abstractions, local authorization and secret resolution; the corresponding Command deployment interface and capability-specific metering still require explicit code-level reconciliation. A provider adapter is not proof of a live provider. No imaginary nutrition/data-ingestion endpoint has been introduced by this work.

## Evidence

Tests and GitHub CI provide evidence only once executed. No payment has been created by this feature during this internal implementation.


## Delta: three payment methods on one FM-to-gym invoice

Asaas `POST /v3/payments` with `billingType=UNDEFINED` creates one canonical IRON charge with a hosted `invoiceUrl`, allowing the gym payer to choose **Pix, credit card or boleto**, subject to provider/account enablement. This is **not three separate charges** and does not require the FM Command or IRON backend to receive or persist PAN, CVV or raw credit-card data. A URL is passed through only for allowlisted HTTPS Asaas hosts.

Provider `GET /payments/{id}` remains the payment-state authority; our verifier now explicitly recognizes `UNDEFINED` along with `PIX`, `BOLETO`, `CREDIT_CARD` but only accepts `RECEIVED` for entitlement activation, and `REFUNDED` for governed reversal. `CONFIRMED` alone is insufficient, including card/boleto events. Partial refunds, disputes and chargebacks still require separately governed policy. The previous one-shot reservation, strict invoice/tenant/customer binding, preflight GET and GET-only recovery stay unchanged.

**No automatic credit-card recurring charge, installment contract, provider webhook or operational UI has been certified by this change.** Hosted multi-method selection belongs to the invoice flow; separate automatic monthly renewal and dunning must be designed against the real canonical subscription lifecycle. The production issuer remains default disabled and no provider charge was created during CI.

Official Asaas API: https://docs.asaas.com/reference/criar-nova-cobranca

## D11 delta — descoberta segura do pagador por academia (14/10/2026)

O emissor aceita `customerId` opcional. Se omitido, resolve exclusivamente `fmcc-iron-customer-<gymUUID>` a partir do vínculo canônico no PostgreSQL do FM Command e consulta somente via GET `/customers?externalReference=...`. Exige **um único** pagador encontrado, rejeita páginas truncadas (`hasMore=true`), e executa GET adicional por ID para confirmar `id` e `externalReference` exatos antes de reservar a fatura e antes de qualquer POST de cobrança.

- Se o pagador não existe: `billing.iron_issuer_customer_enrollment_required`. Nenhum cadastro, reserva ou cobrança é criado.
- Duplicidade de pagadores: `billing.iron_issuer_customer_ambiguous`, bloqueio sem POST.
- ID opcional informado: é sempre validado contra o Asaas e a academia canônica, não prevalecendo sobre o vínculo do Command.
- A emissão permanece bloqueada por padrão via `FMCC_IRON_ASAAS_ISSUANCE_ENABLED`; não há novo flag, autorização implícita de pagamento, nem alteração da autoridade de billing.
- Cadastro governado do pagador, webhook autenticado, worker e homologação externa seguem pendentes. Código e testes não equivalem a provedor homologado.

## D11 — Onboarding financeiro canônico do pagador (14/10/2026)

A inscrição de pagadores utiliza **um único vínculo FM Command → produto IRON → academia (gym UUID) → customer → gateway Asaas production**. A academia é selecionada no billing real do Command a partir do snapshot comercial canônico do backend IRON; a API exige OWNER/ADMIN do tenant de controle da FM, `billing:write` e step-up por senha. A UI oferece formulário em português com CPF/CNPJ e e-mail opcional, sem armazenar documento no navegador. Quando o gate está OFF, exibe indisponibilidade explícita, não um botão fictício.

Uma reserva persistente `fmcc_billing_iron_customer_enrollment` (migration `0011_foundation`) possui unicidade por academia e conta/referência do provedor. CPF/CNPJ é normalizado e validado com dígitos verificadores **somente em memória**, enviado ao Asaas quando autorizado e nunca gravado no banco/auditoria/logs. O ID de cliente confirmado é persistido atomicamente na inscrição e em `fmcc_billing_customer.external_customer_id`, mantendo a reconciliação financeira e a emissão de faturas na mesma fonte de verdade.

O fluxo realiza GET por `externalReference=fmcc-iron-customer-<gymUUID>` e GET por CPF/CNPJ antes de eventual POST. Se já houver cliente com a referência e documento exatos, confirma apenas por leitura. Documento presente sob referência de outro serviço, duplicidade, mismatch, scope inválido e GET inconclusivo bloqueiam a criação para revisão. O registro da reserva é comitado **antes** da primeira tentativa de POST; qualquer retorno incerto é marcado `uncertain` e novas chamadas de inscrição fazem recuperação **GET-only**, nunca uma segunda tentativa de cadastro. Um cliente previamente vinculado na fonte canônica também só pode ser adotado por GET, sem novo POST.

A rota `POST /api/billing/products/[productId]/iron-license/asaas-payer` permanece desabilitada por padrão via `FMCC_IRON_ASAAS_PAYER_ENROLLMENT_ENABLED`. **Nunca ativar essa flag**, criar segredo Asaas real, aplicar migration `0011` ao banco operacional ou efetuar primeira inscrição externa sem homologação operacional governada. O cadastro de pagador NÃO emite cobrança, NÃO registra pagamento e NÃO altera entitlement. Continua independente do financeiro academia → aluno.

Gates antes do uso real: aplicar 0009/0010/0011 sob runbook e autorização, confirmar conta Asaas e recebedor, segredo real segregado, testar identidade e duplicidade em provedor autorizado, aprovar o onboarding legal/LGPD, verificar estado da rota comercial e documentar evidência sandbox/production. **Status: IMPLEMENTED / EXTERNAL BLOCKER**, ainda sem homologação do fluxo financeiro Asaas → Command → IRON.
