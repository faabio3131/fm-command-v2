# IRON D11 — CURRENT operacional verificado no preview (14/10/2026)

## Fontes da evidência

- `faabio3131/FM-CONTROL-CENTER`, base `003b0aca0e49d107e0512754bf58c5a860c7b234` e código das PRs #81–#85.
- Render service `fmcc-preview-web`, ligado ao branch `main`, publicação de preview; Postgres Render `fmcc-preview-postgres`. A inspeção foi somente de leitura e **não** demonstra qual release/mecanismo executou as migrations.
- Consultas à `information_schema`, `drizzle.__drizzle_migrations`, `fmcc_product_definition` e entidades financeiras; nenhuma credencial/CPF/CNPJ/ID de cliente foi extraído ou registrado neste checkpoint.

## Fatos certificados pela inspeção do banco

| Verificação | Resultado |
|---|---|
| Migrations Drizzle registradas no PostgreSQL do preview | 12 (`0000–0011`) |
| Tabelas de billing | 14 |
| Colunas do inbox/worker Asaas | 11 verificadas |
| Índices de controle (payer academy, referência Asaas, outbox) | 3 |
| Slug FM Command dos produtos IRON já registrados | `iron` |
| Código externo do snapshot da API do IRON | `IRON_FIT_CORE` |
| Registro de fonte `iron-commercial-v1` no preview | **0** |
| Rota de billing de produto no preview | **0** |
| Vinculação de academias ao cliente de billing | **0** |
| Inscrição canônica do pagador Asaas | **0** |
| Gateway Asaas `production` marcado `enabled` no banco | 1, sem prova de credenciais válidas/KYC/homologação |
| Faturas existentes (todos os produtos) | 1, não pressupor fatura paga nem fatura IRON |

**Desvio identificado:** o código D11 referenciava `iron-fit-core`, que não corresponde ao slug efetivo no registro comercial do preview (`iron`). Isso impedia que os guardas de escopo localizassem as entidades reais, mesmo com CI verde. Esta alteração mantém a checagem de tenant, produto UUID, fonte `IRON FIT CORE Commercial`, gateway, role, step-up e entitlement canônico, mas reconcilia somente o slug interno para `iron`. O `product_code=IRON_FIT_CORE` da API externa **permanece inalterado**.

## Gate operacional e ordem de ativação

1. **Código e CI:** aprovar correção de slug em PR, certificar migração/schema/testes, merge e pós-merge; confirmar preview no mesmo SHA.
2. **Reconciliar ambiente com segurança:** confirmar que `fmcc-preview-web` usa efetivamente o `fmcc-preview-postgres` inspecionado e conferir versão/schema da database de **cada ambiente**. Não reaplicar `0009–0011` se já constarem no journal desse banco. Não atribuir causa/ator ao estado das migrations sem evidência.
3. **Identidade/control plane IRON:** registrar uma única fonte `iron-commercial-v1` no tenant da FM autorizado, com produto canônico `iron` e URL HTTPS allowlisted, `IRON_COMMERCIAL_SECRET_REF`, e comprovar `/health` e snapshot IRON **sem vazar token**. Não criar fonte sob tenant não confirmado.
4. **Planos/comercial:** conferir mapeamento imutável de plano+versão de entitlement IRON, rota exata produto→gateway, account status, titularidade, KYC e licença. A conta Asaas marcada `enabled` na database **não equivale** a produção homologada.
5. **Cadastro pagador:** uma academia IRON real identificada por UUID, consentimento/base legal e CPF/CNPJ válidos do titular (sem persistir documento no Command), uso de token Asaas em Vault e gate explícito `FMCC_IRON_ASAAS_PAYER_ENROLLMENT_ENABLED`. Cadastro externo `POST /customers` precisa de aprovação para o piloto real.
6. **Cobrança/reconciliação:** autorizar **separadamente** primeira cobrança externa; validar provedor por `GET` autenticado; webhook authToken independente e workers/flags OFF até homologação; testar refund, duplicidade, replay e idempotência no ambiente autorizado.
7. **Entitlement:** confirmar outbox e IRON `subscription.status.sync` idempotente; verificar no backend IRON estado canônico da academia com isolamento tenant; não declarar GO sem teste fim-a-fim e evidência auditável.

## STOP-SHIP e limites

Qualquer conflito de tenant, fonte, plano, cliente Asaas, status de pagamento ou evento de licença bloqueia promoção. Não promover automaticamente credenciais, webhooks, cobrança, migrações ou flags no preview/produção por resultado de teste unitário ou CI. A autorização visual da PR #22 do Macro O é um gate humano distinto.

**Status da homologação comercial D11:** `IMPLEMENTED / EXTERNAL BLOCKER`; faltam vínculo da fonte comercial, rota e cadastro real, além de credenciais/evidência do Asaas e E2E externo. Código corrigido não equivale a provedor homologado.
