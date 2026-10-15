# FM COMMAND — AUDITORIA PROFUNDA DE COMPLETUDE FUNCIONAL PRÉ-INTEGRAÇÕES

**Data:** 04/10/2026
**Repositório:** faabio3131/FM-CONTROL-CENTER
**Branch auditada:** fix/fm-command-cme11-visual-refinement
**Objetivo:** provar que a camada interna prevista por arquitetura/Cronograma Mestre existe de fato antes da fase de integrações externas.

## Regra de classificação

- PASS: requisito interno implementado, exposto e com evidência.
- FIX_REQUIRED: requisito interno existe parcialmente, mas não cumpre o contrato completo.
- EXTERNAL_BLOCKED: depende de semântica humana, provider, credencial ou autoridade externa e não pode ser fabricado.
- POST_FIX_RETEST: corrigido durante esta auditoria e exige recertificação final.

## Matriz executiva

| Bloco | Requisito | Estado da auditoria | Evidência / Finding |
|---|---|---|---|
| CME-01 | Semântica dos cards | PASS | Registry/Metric Engine preservam missing != zero e labels por metric_id. |
| CME-02 | Trials | PASS INTERNO | Produto server-side, proveniência/qualidade/freshness, coorte/gaps explícitos, Core contextual e loading/error implementados sem fabricar semânticas. |
| CME-02 | Assinaturas | PASS INTERNO | Produto/período, proveniência/qualidade/freshness, novas assinaturas como gap explícito, Core contextual e loading/error implementados; churn/MRR/ARR permanecem governados. |
| CME-02 | Configurações | PASS | Better Auth Organization é a autoridade real para organização, membros, convite, papéis e remoção; RBAC e minimização de exposição preservados. |
| CME-03 | Operational Health | PASS | MonitoredService + observations + stale/unknown + provenance + Core usam mesma autoridade. |
| CME-04 | Activity Feed | PASS | Projeção une Audit Ledger + canonical facts, filtros/paginação/provenance reais. |
| CME-05 | Busca global | PASS | Busca/API/rate-limit/RBAC preservados e Ctrl/Cmd+K implementado globalmente no shell. |
| CME-06 | Notificações | PASS | Inbox derivada de eventos/alertas, unread real, mark-read por usuário/tenant. |
| CME-07 | Header/Identidade | PASS | Identidade humana preservada; identificador técnico de tenant removido da UX principal. |
| CME-08 | 8 semânticas | EXTERNAL_BLOCKED | Registro canônico mantém exatamente oito pending_semantics aguardando decisão empresarial/corporativa. |
| CME-09 | Providers corporativos | EXTERNAL_BLOCKED | Fase seguinte: billing, FinOps, CRM, usage, incidents, support etc. |
| CME-10 | Kordena + scheduler | PASS INTERNO / EXACT-SHA PENDENTE | Contratos, scheduler, idempotência, fail-closed e Kordena permanecem verdes; runtime externo será revalidado no exact-SHA pós-merge. |
| CME-11 | Visual Premium | PASS LOCAL / APROVADO | Refinamentos CME-11.1/11.2/11.3 concluídos e aprovados visualmente pelo proprietário; merge e exact-SHA Preview permanecem pós-merge. |
| Voz Core | Ditado pt-BR | PASS INTERNO | SpeechRecognition pt-BR preservado e Permissions-Policy corrigida para microphone=(self), mantendo câmera/geolocalização bloqueadas; hardware/permissão real do navegador será smoke manual pós-deploy. |
| Core | Core vertical próprio | PASS | FmccVerticalCognitiveCore, gateway, evidence/provenance, provider boundary, audit e fail-closed. |
| Segurança | Tenant/RBAC | PASS | Contexto server-side, role permissions, isolamento cross-tenant e matriz adversarial recertificados. |
| Sources/Connectors | Fabric interno | PASS | Source Registry, secret-by-reference, connector runtime, canonical facts, sync/health. |
| Alertas | Regras/automações governadas | PASS | Threshold determinístico, audit, idempotência, advisory lock, intents sem side effect crítico. |

## Findings internos obrigatórios

### F-01 — Voz bloqueada por policy
`next.config.ts` define globalmente `microphone=()`, incompatível com a função de ditado oferecida pelo Core.
Correção: permitir microfone apenas para origem própria, mantendo câmera/geolocalização bloqueadas; adicionar teste de policy.

### F-02 — Trials incompleto
Completar superfície sem inventar semânticas:
- produto server-side;
- período/as_of quando houver;
- source authority, quality, freshness e provenance;
- coorte/origem explicitamente disponíveis ou indisponíveis;
- trial encerrado somente quando houver autoridade; caso contrário gap explícito;
- Core com contexto de Trials;
- loading/error e testes negativos.

### F-03 — Assinaturas incompleto
Completar:
- produto/período;
- provenance/quality/freshness;
- novas assinaturas como estado explícito indisponível enquanto não houver evento/métrica canônica;
- Core com contexto de Assinaturas;
- loading/error;
- preservar churn/MRR/ARR como pending_semantics.

### F-04 — Configurações parcialmente decorativas
Usar Better Auth Organization plugin já autoritativo para:
- dados reais da organização;
- lista de membros;
- convite;
- alteração de papel;
- remoção governada quando permitida;
- RBAC server-side/Better Auth;
sem duplicar Auth.

### F-05 — Atalho de busca não global
Mover/adicionar Ctrl/Cmd+K ao shell para navegar/focar a busca global a partir de qualquer módulo.

### F-06 — Tenant ID técnico na UX principal
Remover o identificador abreviado da Visão Geral e mostrar somente contexto humano de organização.

## Bloqueios externos legítimos — não corrigir por inferência

As oito semânticas do CME-08 permanecem bloqueadas até decisão canônica:
- trial.active.count
- trial.conversion.rate
- subscription.logo_churn.rate
- revenue.mrr
- revenue.arr
- finance.operating_result
- finance.operating_margin.rate
- service.error.rate

A fase posterior de integrações deve tratar providers/credenciais/autoridades reais. Nenhum blocker externo será transformado em mock, zero ou PASS fictício.

## Próximo gate

Após corrigir F-01..F-06:
1. testes focados;
2. suite completa;
3. lint/typecheck/build;
4. migrations;
5. E2E;
6. security/tenant negatives;
7. secret scan/dependency audit;
8. Docker/runtime smoke;
9. auditoria independente sem blockers;
10. merge e exact-SHA Preview;
11. health/ready/journeys/responsividade;
12. somente então classificar camada interna como PASS ou PASS WITH EXTERNAL BLOCKERS.

## Fechamento da auditoria interna

Após correção dos findings F-01..F-06, refinamento visual CME-11.3 e recertificação em ambiente isolado, a camada interna foi classificada como:

```text
FMCC_INTERNAL_LAYER = PASS_WITH_EXTERNAL_BLOCKERS
VISUAL_OWNER_APPROVAL = APPROVED
EXTERNAL_PROVIDER_PHASE = PENDING
EXACT_SHA_PREVIEW = PENDING_POST_MERGE
```

### Evidências finais

```text
LINT = PASS
TYPECHECK = PASS
FRESH_DATABASE_MIGRATIONS = PASS
UNIT_INTEGRATION_TEST_FILES = 81/81 PASS
UNIT_INTEGRATION_TESTS = 338/338 PASS
BROWSER_E2E = 7/7 PASS
RUNTIME_SMOKE = PASS
PRODUCTION_BUILD = PASS
SECRET_SCAN = PASS (357 tracked files)
F21_READINESS = PASS
SECURITY_TENANCY_ADVERSARIAL = PASS
DEPENDENCY_AUDIT_HIGH_CRITICAL = PASS
DIFF_WHITESPACE = PASS
CME_11_3_VISUAL = APPROVED
```

A primeira execução integral local expôs dois timeouts por contenção de 81 workers e banco previamente reutilizado, sem falha de assertion. A recertificação foi repetida em PostgreSQL novo, com migrations aplicadas e execução determinística sem paralelismo entre arquivos. Resultado: 81/81 arquivos e 338/338 testes verdes. O `vitest.config.ts` foi endurecido com `fileParallelism: false`. O teste de rota do scheduler recebeu timeout explícito de 15s apenas para absorver carregamento frio de módulos no Windows; nenhuma asserção foi removida ou enfraquecida.

O E2E foi executado em porta isolada para não interferir com a prévia local do Kordena. O Playwright e o runtime smoke agora aceitam porta por variável de ambiente, mantendo `3000` como default do CI.

A função de voz teve o bloqueio interno removido: `Permissions-Policy` passou a permitir microfone somente para a própria origem, enquanto câmera e geolocalização continuam bloqueadas. A existência do fluxo SpeechRecognition pt-BR e a policy foram recertificadas; a permissão/hardware real do navegador será validada no smoke humano pós-deploy.

### Bloqueios externos legítimos preservados

As oito semânticas abaixo continuam sem promoção artificial:

- `trial.active.count`
- `trial.conversion.rate`
- `subscription.logo_churn.rate`
- `revenue.mrr`
- `revenue.arr`
- `finance.operating_result`
- `finance.operating_margin.rate`
- `service.error.rate`

A próxima fase após merge e pós-merge exact-SHA é a integração dos providers corporativos reais (billing, FinOps, CRM, usage, incidents, support e demais autoridades externas previstas pelo Cronograma Mestre).
