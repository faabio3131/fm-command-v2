# FM Command — Post-Fix Deep Audit

Data: 2026-10-06
Natureza: auditoria independente pós-correção
Baseline de aplicação: `main@370897af04fafe6729dd3f6f22e75337e32f3014`

## 1. Pergunta principal

> Existe hoje no FM Command alguma função planejada, documentada ou implementada que não esteja corretamente disponível e utilizável na aplicação Web para o usuário autorizado?

**Resposta:** não foi encontrada capability humana interna órfã no CURRENT auditado.

Evidência:

- 19 páginas humanas sob `/dashboard`;
- navegação global derivada de permissões canônicas;
- quatro subrotas humanas classificadas e com entry points explícitos;
- `tests/capability-reachability.unit.test.ts` verde;
- Foundation Gate verde;
- browser E2E verde;
- cross-tenant E2E verde.

## 2. Web sem backend real

> Existe alguma função visível na Web que não esteja sustentada por backend/contrato real?

**Resposta:** não foi encontrado caso interno.

Superfícies externas sem autoridade real degradam fechado:

- métricas ausentes -> `Indisponível`;
- semânticas não aprovadas -> `Semântica pendente`;
- IRON/CampaIA/NFCore -> sem source ativa;
- Kordena sem source em tenant novo -> fail-closed;
- Source health/sync sem connector -> erro governado, não sucesso falso.

## 3. RBAC

> Existe alguma permissão declarada que não corresponda ao comportamento Web/server-side?

**Resposta:** não foi encontrada divergência interna.

Evidência:

- navigation permission-scoped;
- server guards independentes da navegação;
- Source Registry write recusado para viewer;
- Billing/Receivables owner/admin;
- Kordena write owner/admin;
- alert write owner/admin;
- action prepare owner/admin/analyst;
- audit owner/admin/analyst;
- tenant derivado de sessão.

## 4. Blockers históricos reconciliados

Foram removidos do estado pendente:

- branch protection de main;
- Kordena source/runtime;
- scheduler;
- onboarding anonymous server guard;
- Kordena read sem ampliar `source:read`;
- visual premium histórico;
- viewport desktop 1920x1080;
- zero orphan Web;
- dependency HIGH de `source-map-js`;
- dependency HIGH de `sharp`;
- PRs #32, #33, #34, #35, #36, #37 e #41.

## 5. Blockers atuais mascarados por CI verde

Nenhum blocker externo foi promovido a `COMPLETE` só porque o CI está verde.

Permanecem explicitamente bloqueados:

- 8 semânticas executivas;
- IRON source;
- CampaIA source/runtime;
- NFCore source/runtime CURRENT;
- providers corporativos ainda não definidos;
- data classification policy.

## 6. Segurança

Não foi encontrada evidência de:

- auth bypass;
- arbitrary tenant selection;
- cross-tenant leak;
- privilege escalation;
- secret exposure;
- Kordena publish sem step-up/approval;
- approval replay;
- missing -> zero;
- métrica pendente promovida;
- provenance removida.

Cobertura reproduzível inclui auth integration, product-scope PostgreSQL, alert tenant isolation, Kordena security/approval, source registry, Core audit/grounding, E2E e F21 adversarial suite.

## 7. Runtime

Preview:

- SHA: `370897af04fafe6729dd3f6f22e75337e32f3014`
- health: ok
- ready: ready
- sign-in: 200
- dashboard anônimo: 307 -> sign-in
- onboarding anônimo: 307 -> sign-in

Kordena:

- source healthy;
- último sync: completed;
- error_code: null;
- facts: 0;
- metrics: 0;
- dataset vazio preservado como vazio.

## 8. Banco

- migrations: 4
- tenant indexes/unique constraints presentes;
- product uniqueness por tenant+slug;
- source uniqueness por tenant+name;
- sync idempotency por tenant+key;
- fact dedupe por tenant+source+external+mapping;
- audit tenant+time index;
- nenhum dado sensível impresso.

## 9. PRs antigas

Nenhuma PR permanece aberta após reconciliação.

Branches históricas não foram mergeadas cegamente.

## 10. Findings finais

```text
BLOCKER_INTERNAL = 0
CRITICAL_INTERNAL = 0
HIGH_INTERNAL = 0
MEDIUM_INTERNAL = 0

IMPLEMENTED_NOT_REACHABLE = 0
REACHABLE_NOT_AUTHORIZED_CORRECTLY = 0
UI_WITHOUT_BACKEND = 0
BACKEND_WITHOUT_UI_HUMAN = 0
PARTIAL_INTERNAL_FIXABLE = 0
```

## 11. Veredito

`FM COMMAND — APPROVED WITH EXTERNAL BLOCKERS`

Motivo: tudo que depende internamente do FM Command está reconciliado no escopo auditado; dependências restantes exigem decisão empresarial, provider, runtime externo ou finalização de outro produto e permanecem fail-closed.
