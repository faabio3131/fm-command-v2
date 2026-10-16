# FM Command — Capability Completion Matrix

Data da auditoria: 2026-10-06  
Baseline de código auditado: `main@370897af04fafe6729dd3f6f22e75337e32f3014`  
Branch original de certificação zero-órfãos: `audit/command-zero-orphans-20261006`  
PR de certificação zero-órfãos: `#59`  
Merge certificado: `370897af04fafe6729dd3f6f22e75337e32f3014`

## Regra de classificação

Estados permitidos pelo Prompt Mestre:

- `COMPLETE`
- `IMPLEMENTED_NOT_REACHABLE`
- `REACHABLE_NOT_AUTHORIZED_CORRECTLY`
- `UI_WITHOUT_BACKEND`
- `BACKEND_WITHOUT_UI`
- `PARTIAL`
- `EXTERNAL_BLOCKED`
- `NOT_APPLICABLE`

A classificação abaixo separa capacidade interna do FM Command de disponibilidade de dados externos. Uma tela pode estar `COMPLETE` e, corretamente, mostrar `Indisponível` quando sua fonte ou semântica ainda não existe.

## Evidência estrutural

O CURRENT possui 19 páginas humanas sob `/dashboard`:

- Visão Geral;
- Busca;
- Notificações;
- Financeiro;
- Comercial;
- Trials;
- Assinaturas;
- Clientes;
- Operações;
- Incidentes/Alertas;
- detalhe arquivado de regra;
- Atividades;
- Core;
- Kordena;
- Fontes e Integrações;
- Configurações;
- Product Cockpit;
- Billing por produto;
- Recebimentos por produto.

A navegação global é derivada de `COMMAND_NAVIGATION` + permissões canônicas. Subrotas humanas existem somente quando possuem entry point explícito a partir de uma superfície pai.

O teste `tests/capability-reachability.unit.test.ts` transforma essa regra em gate: toda página humana do dashboard deve ser classificada como item de navegação global ou subrota explicitamente alcançável.

## Matriz completa

| Capability | Autoridade / API / serviço | Web e reachability | Permissão principal | Estado | Evidência / blocker |
|---|---|---|---|---|---|
| Autenticação | Better Auth / `/api/auth/[...all]` | `/sign-in` | sessão | COMPLETE | login/signup/logout e auth integration test |
| Onboarding de organização | Better Auth Organization | `/onboarding` | sessão autenticada | COMPLETE | guarda server-side e testes de onboarding |
| Shell e navegação | `COMMAND_NAVIGATION` + `commandNavigationForRole` | layout global | permissão por item | COMPLETE | navegação deriva RBAC e feature flags |
| Visão Geral | Metric/Product/Alert/Health/Activity services | `/dashboard` | `metric:read` | COMPLETE | dados ausentes permanecem indisponíveis |
| Product Registry | ProductRegistryService / `/api/products` | formulário na Visão Geral | `product:read/write` | COMPLETE | cadastro autenticado, tenant-scoped e auditado |
| Product Cockpit | ProductCockpitService / `/api/products/[productId]/cockpit` | card do produto -> `/dashboard/products/[productId]` | `product:read` | COMPLETE | escopo do produto validado server-side |
| Comparação de produtos | `/api/products/compare` | Visão Geral | `product:read` + métricas | COMPLETE | compara somente métricas/unidades/períodos compatíveis |
| Billing por produto | Billing control service / Kordena billing boundary quando aplicável | Product Cockpit -> `/billing` | `billing:read/write` | COMPLETE | owner/admin; provider ausente degrada fechado |
| Recebimentos por produto | ProductReceivablesService / `/api/products/[productId]/receivables` | Product Cockpit -> `/receivables` | `receivable:read` | COMPLETE | owner/admin; não cria ledger paralelo |
| Financeiro | FinancialIntelligenceService / `/api/intelligence/finance` | `/dashboard/finance` | `metric:read` | COMPLETE | missing != zero e semânticas pendentes preservadas |
| Comercial / Growth | GrowthIntelligenceService / `/api/intelligence/growth` | `/dashboard/growth` | `metric:read` | COMPLETE | funnels/atribuição fecham quando dados não existem |
| Trials | MetricService + Product Registry | `/dashboard/trials` | `metric:read` | COMPLETE | UI, produto, provenance, quality/freshness, Core e estados de indisponibilidade |
| Assinaturas | MetricService + Product Registry | `/dashboard/subscriptions` | `metric:read` | COMPLETE | UI, produto, provenance, Core e semântica pendente explícita |
| Clientes | CustomerIntelligenceService / `/api/intelligence/customers` | `/dashboard/customers` | `metric:read` | COMPLETE | agregados governados, sem PII bruta |
| Operações | OperationsIntelligence + OperationalHealth / APIs correspondentes | `/dashboard/operations` | `metric:read` | COMPLETE | health/read model governados e fail-closed |
| Alertas / Incidentes | AlertService / APIs `/api/alerts/**` | `/dashboard/alerts` | `alert:read/write`, `action:prepare` | COMPLETE | leitura separada de criação/preparação; audit/idempotência |
| Arquivo de regra de alerta | AlertService ruleDetail | Alertas -> `/dashboard/alerts/rules/[ruleId]` | autorização do AlertService | COMPLETE | entry point explícito, somente leitura para histórico |
| Scheduler de alertas | `/api/internal/automation/alerts/evaluate` + GitHub Actions | sem UI humana dedicada | scheduler secret | NOT_APPLICABLE | automação server-to-server certificada; UI humana não é requisito |
| Atividades | ActivityFeedService / `/api/activity` | `/dashboard/activity` | `audit:read` | COMPLETE | visível somente owner/admin/analyst |
| Busca global | GlobalSearchService / `/api/search` | `/dashboard/search` + Ctrl/Cmd+K | `search:use` | COMPLETE | rate limit, RBAC e escopo tenant |
| Notificações | NotificationService / `/api/notifications` | `/dashboard/notifications` + topbar | `notification:use` | COMPLETE | unread e mark-read reais por usuário/tenant |
| Core cognitivo | Core Gateway / `/api/core/query` | `/dashboard/intelligence` + Core contextual | `metric:read` + capabilities internas | COMPLETE | evidence/provenance, grounding e fail-closed |
| Kordena leitura | KordenaCommercialControlService | `/dashboard/commercial/kordena` tenant-featured | `commercial:read` | COMPLETE | feature só aparece quando source do tenant existe |
| Kordena mutações | commands + step-up + approval lifecycle | módulo Kordena | `commercial:write` | COMPLETE | idempotência, preview/diff, approval e audit |
| Kordena source runtime | `KordenaCommercialConnector` | Fontes/Kordena | `integration:read/write` | COMPLETE | source real healthy, sync fresco completed e bootstrap runtime verificado |
| Source Registry | SourceRegistryService / `/api/sources` | `/dashboard/sources` | `source:read/write` | COMPLETE | viewer/member sem administração; secret-by-reference |
| Source health/sync | Connector Runtime / `/api/sources/[sourceId]/health|sync` | Central de Fontes | `integration:read/write` | COMPLETE | timeout, retry, cursor, dedupe, idempotência, audit |
| Configurações | Better Auth Organization | `/dashboard/settings` | leitura comum; `tenant:manage/member:manage` para mutações | COMPLETE | update org, invite, role update e remove governados |
| Identidade do tenant | DashboardIdentity / Better Auth | header/dashboard | sessão + tenant | COMPLETE | contexto humano; tenant ID técnico removido da UX principal |
| RBAC | `ROLE_PERMISSIONS` + guards server-side | todas as superfícies | role/permission | COMPLETE | testes de roles, direct access e operações sensíveis |
| Tenant isolation | TenantContext + repositories tenant-first | todas as superfícies | tenant autenticado | COMPLETE | cross-tenant test retorna 404/bloqueio; cliente não escolhe tenant arbitrário |
| Audit Ledger | audit repositories/services | Atividades + ações governadas | `audit:read` para consulta | COMPLETE | mutações críticas registram evento sanitizado |
| Métricas implementadas | Metric Registry + Metric Engine | superfícies executivas | `metric:read` | COMPLETE | métricas implementadas determinísticas, provenance preservada |
| 8 semânticas executivas pendentes | Metric Registry | superfícies exibem `Semântica pendente` | `metric:read` | EXTERNAL_BLOCKED | decisão empresarial/corporativa obrigatória; nenhuma fórmula inventada |
| IRON como produto | Product Registry | card + Product Cockpit | `product:read` | COMPLETE | produto ativo no tenant Nova FM |
| IRON source real | contrato/connector ainda inexistente no FM Command | nenhuma source falsa registrada | — | EXTERNAL_BLOCKED | backend/frontend existem, mas falta contrato governado + connector + health/sync/provenance |
| CampaIA como produto | Product Registry | card + Product Cockpit | `product:read` | COMPLETE | produto ativo no tenant Nova FM |
| CampaIA source real | runtime/contrato/connector não homologados | nenhuma source falsa registrada | — | EXTERNAL_BLOCKED | requer runtime externo homologado e connector |
| NFCore como produto | Product Registry | card + Product Cockpit | `product:read` | COMPLETE | produto ativo no tenant Nova FM |
| NFCore source real | NFCore CURRENT em reconciliação | nenhuma source falsa registrada | — | EXTERNAL_BLOCKED | staging antigo não é autoridade final; falta CURRENT homologado + adapter/connector |
| Billing/invoices corporativo universal | provider/ledger corporativo não definido | indisponível quando ausente | — | EXTERNAL_BLOCKED | provider/autoridade de invoices ainda precisa ser escolhido |
| FinOps corporativo | provider ainda não escolhido | indisponível | — | EXTERNAL_BLOCKED | autoridade de custos de infraestrutura não definida |
| Custos operacionais corporativos | autoridade financeira não definida | indisponível | — | EXTERNAL_BLOCKED | sistema/autoridade contábil requerida |
| CRM/leads corporativo | provider não definido | indisponível | — | EXTERNAL_BLOCKED | decisão de CRM requerida |
| Telemetria universal de produtos | contrato/provider por produto não definido | indisponível quando ausente | — | EXTERNAL_BLOCKED | Kordena possui sinais parciais; não existe autoridade universal |
| Observabilidade consolidada | provider corporativo não definido | health interno funciona com fontes registradas | — | EXTERNAL_BLOCKED | `service.error.rate` também depende de semântica aprovada |
| Suporte/tickets corporativo | provider não definido | indisponível | — | EXTERNAL_BLOCKED | decisão de sistema de suporte requerida |
| Data classification corporativa | política externa | não aplicável como página própria | — | EXTERNAL_BLOCKED | taxonomia corporativa formal ainda não foi aprovada |

## Mapa de reachability

### Navegação global

Todos os itens em `COMMAND_NAVIGATION` apontam para página real. A navegação é filtrada por permissão e feature tenant-scoped.

### Subrotas humanas

As únicas páginas humanas que não são destinos diretos da navegação global são:

- `/dashboard/products/[productId]` — alcançada pelos cards de produto;
- `/dashboard/products/[productId]/billing` — alcançada pelo Product Cockpit somente quando `billing:read`;
- `/dashboard/products/[productId]/receivables` — alcançada pelo Product Cockpit somente quando `receivable:read`;
- `/dashboard/alerts/rules/[ruleId]` — alcançada pela lista de regras arquivadas.

O teste de reachability falha se uma nova `page.tsx` humana for adicionada e não entrar em uma dessas duas categorias.

## Backend sem UI

Endpoints que propositalmente não possuem página humana própria:

- `/api/health`;
- `/api/ready`;
- `/api/version`;
- `/api/me`;
- `/api/internal/automation/alerts/evaluate`;
- endpoints de comando/health/sync usados pelas superfícies pai.

Esses casos são `NOT_APPLICABLE`, não `BACKEND_WITHOUT_UI`, porque são contratos de runtime, suporte de UI existente ou server-to-server.

## Contagem final da auditoria

```text
IMPLEMENTED_NOT_REACHABLE = 0
REACHABLE_NOT_AUTHORIZED_CORRECTLY = 0
UI_WITHOUT_BACKEND = 0
BACKEND_WITHOUT_UI_HUMAN_CAPABILITIES = 0
PARTIAL_INTERNAL_FIXABLE = 0

EXTERNAL_BLOCKED =
- 8 semânticas executivas;
- IRON source;
- CampaIA source;
- NFCore source;
- provider corporativo de billing/invoices;
- FinOps;
- custos operacionais;
- CRM/leads;
- telemetria universal;
- observabilidade consolidada;
- suporte/tickets;
- data classification policy.
```

## Veredito deste bloco

`WEB_CAPABILITY_ZERO_ORPHANS = PASS`

Evidência de promoção:

1. `capability-reachability.unit.test.ts`: PASS dentro da suíte integral;
2. Foundation Gate da PR #59: SUCCESS;
3. F21 Operational Readiness Gate da PR #59: SUCCESS;
4. PR #59 mergeada;
5. pós-merge Foundation: SUCCESS;
6. pós-merge F21 Readiness: SUCCESS;
7. pós-merge Preview Deployment Gate: SUCCESS;
8. Render LIVE no SHA `370897af04fafe6729dd3f6f22e75337e32f3014`;
9. `/api/version` confirmou o mesmo SHA;
10. `/api/health = ok`, `/api/ready = ready`;
11. `/dashboard` e `/onboarding` anônimos redirecionam para `/sign-in`.

Nenhuma capability humana interna permaneceu órfã no CURRENT auditado.
