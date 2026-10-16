# FM CONTROL CENTER — F11 PRODUCT INTELLIGENCE

**Fase:** F11 — Inteligência por Produto  
**Progresso mestre:** 65% → 71%  
**Status atual:** IMPLEMENTAÇÃO + SMOKE + HEALTH/READY APROVADOS — RECERTIFICAÇÃO DOCUMENTAL FINAL PENDENTE  
**Baseline:** `c199b5bc6fc4ad871523eeaf98f6705b12417bb7`  
**Branch:** `feat/fmcc-f11-product-intelligence`  
**PR:** #11 — OPEN/DRAFT  
**Candidate funcional certificado:** `986991e74e53fc8ff41d90d0ca27cabf345163fc`  
**Foundation Gate funcional:** #184 — SUCCESS  
**Produção:** fora do escopo

## 0. Reconciliação de CURRENT — 22/09/2026

A descoberta inicial deste documento registrava lacunas ainda inexistentes no baseline. Após a implementação da F11, o CURRENT técnico da PR #11 passa a incluir:
- Product Registry canônico e tenant-scoped;
- `product_id` opcional em Source Definition, Canonical Fact e Metric Value;
- validação server-side de product scope;
- isolamento cross-tenant e cross-product;
- Product Intelligence Service;
- Product Overview por SaaS;
- histórico de métricas por produto para sinais de growth governados;
- Portfolio Comparison com bloqueio de moeda/período incompatíveis;
- APIs de produtos, overview e comparação;
- UI de cadastro/listagem, visão individual e comparação;
- FM Cognitive Vertical Core product-aware com catálogo autorizado do tenant;
- evidence/auditoria com product refs;
- migration Drizzle versionada `0002_foundation.sql`.

Evidência de CI do candidate funcional `986991e...`:
- Foundation Gate #184 — SUCCESS;
- 21 test files PASS;
- 91 tests PASS;
- 0 FAIL;
- lint, typecheck, migration verification/apply, build, Docker e runtime dependency audit verdes.

Risco conhecido não bloqueante: 4 vulnerabilidades `moderate` transitivas em tooling de desenvolvimento; nenhuma HIGH/CRITICAL bloqueando o gate vigente.

**Preview/smoke funcional:** aprovado no Render, incluindo Product Registry, visão por produto, comparação, Core single/multi-product, localização pt-BR, ditado por voz e limpeza do campo cognitivo após envio. **Health/ready:** aprovados. **Pendência real:** somente recertificação deste último HEAD documental e gate final da PR.

## 1. Objetivo

Entregar visão governada por SaaS para:
- aquisição;
- ativação;
- engajamento;
- receita;
- churn;
- saúde;
- crescimento;
- comparação entre produtos.

Nenhuma métrica pode ser inventada. Ausência de dado permanece ausência de dado.

## 2. BASELINE confirmado antes da implementação

Esta seção preserva o estado encontrado no início da F11 para fins de rastreabilidade histórica.

O FMCC já possuía:
- TenantContext server-side;
- Integration Fabric com Source Registry;
- canonical facts tenant-scoped;
- Metric Registry e Metric Engine determinísticos;
- metric values com provenance/freshness/quality;
- Executive Command Center;
- FM Cognitive Vertical Core próprio do produto;
- Audit Ledger;
- Preview/CI/CD certificados.

O baseline ainda não possuía:
- Product Registry canônico;
- product scope explícito no Source Registry;
- product scope explícito nos canonical facts;
- product scope explícito nos metric values;
- APIs de Product Intelligence;
- Product Overview;
- Portfolio Comparison;
- planejamento cognitivo com catálogo autorizado de produtos.

## 3. Restrições semânticas herdadas

O catálogo F03 determina:
- métricas de uso/engajamento são templates até existir evento qualificador aprovado;
- desempenho por produto é composição de métricas explícitas;
- não existe `product.performance.score` aprovado;
- lucro real não pode ser inferido sem autoridade contábil;
- conversão deve ser cohort-aware;
- currencies incompatíveis não podem ser agregadas sem política de FX.

Logo, F11 deve suportar estados `unavailable` / `pending_semantics` sem fabricar cálculo.

## 4. TARGET

Fluxo canônico:

```text
TenantContext
  ↓
Product Registry
  ↓
Source Registry (product scoped quando aplicável)
  ↓
Canonical Facts (product scoped)
  ↓
Metric Engine (tenant + optional product scope)
  ↓
Product Intelligence Service
  ├─ Product Overview
  ├─ Product Metric History
  └─ Portfolio Comparison
  ↓
Executive UI / APIs / FM Cognitive Vertical Core
  ↓
Audit Ledger
```

## 5. Autoridades

| Assunto | Autoridade |
|---|---|
| tenant | sessão/membership server-side |
| produto autorizado | FMCC Product Registry |
| source binding | Source Registry |
| fato bruto/canônico | source autorizado + Canonical Fact Store |
| definição de métrica | Metric Registry |
| cálculo factual | Metric Engine |
| valor derivado | Metric Store |
| composição por produto | Product Intelligence Service |
| interpretação/recomendação | FMCC Cognitive Vertical Core |
| trilha | Audit Ledger |

Frontend nunca seleciona autoridade por si só.

## 6. Product Registry

Criar `fmcc_product_definition` com:
- `id` UUID;
- `tenant_id`;
- `slug`;
- `name`;
- `status` (`active` | `inactive`);
- timestamps.

Restrições:
- slug único por tenant;
- leitura sempre tenant-scoped;
- criação exige permissão explícita;
- productId recebido externamente deve ser resolvido pelo registry do tenant antes de uso.

Não criar produto automaticamente a partir de texto, nome de source ou pergunta do Core.

## 7. Product scope nos dados

Adicionar `product_id` opcional a:
- Source Definition;
- Canonical Fact;
- Metric Value.

Motivo:
- existem métricas corporativas globais que não pertencem a um produto;
- F11 exige métricas por produto;
- o mesmo Metric Engine deve continuar servindo ambos os escopos.

Regras:
- consulta global usa `productId = null`;
- consulta de produto exige Product Registry válido no mesmo tenant;
- facts/metrics de um produto não podem entrar em cálculo de outro;
- productId não pode ampliar tenant scope.

## 8. Catálogo F11

Categorias e alvos:

### Acquisition
- `lead.created.count` — pending semantics;
- `trial.starts.count` — implemented.

### Activation
- `activation.completed.count` — pending semantics;
- `activation.rate` — pending semantics.

### Engagement
- `usage.active_users.dau` — pending semantics;
- `usage.active_users.mau` — pending semantics;
- `usage.feature_adoption.rate` — pending semantics;
- `usage.engagement.events` — pending semantics.

### Revenue
- `billing.gross_billed` — implemented;
- `revenue.cash_collected` — implemented;
- `subscription.active.count` — implemented;
- `revenue.mrr` — pending semantics;
- `revenue.arr` — pending semantics.

### Churn
- `subscription.cancelled.count` — implemented;
- `subscription.logo_churn.rate` — pending semantics.

### Health
- `incident.count` — pending semantics;
- `service.error.rate` — pending semantics;
- `support.ticket.open.count` — pending semantics.

### Growth
Growth não será uma métrica mágica nova.
Será derivada somente de duas observações comparáveis do MESMO metricId/productId:
- mesma unidade;
- mesma currency;
- períodos temporalmente ordenados;
- valores disponíveis.

Sem duas observações comparáveis: `unavailable`.

## 9. Product Overview

Cada produto deve expor:
- id;
- slug;
- nome;
- status;
- categorias F11;
- metricId;
- definition status;
- valor ou indisponibilidade;
- unit/currency;
- period/asOf;
- freshness;
- quality;
- source authority;
- provenance;
- gaps explícitos.

## 10. Portfolio Comparison

Comparação permitida apenas quando:
- produtos pertencem ao tenant;
- metricId é o mesmo;
- definição existe;
- valores estão disponíveis;
- unit é igual;
- currency é igual quando aplicável;
- períodos são comparáveis.

Resultados possíveis:
- `comparable`;
- `unavailable`;
- `incompatible_currency`;
- `incompatible_period`;
- `pending_semantics`.

Não produzir ranking artificial para estado não comparável.

## 11. APIs

Planejadas:
- `GET /api/products`;
- `POST /api/products`;
- `GET /api/products/:productId/overview`;
- `GET /api/products/compare?metricId=...&productId=...&productId=...`.

Todas:
- resolvem tenant server-side;
- validam permission;
- nunca aceitam tenant de header/body como autoridade.

## 12. UI

No Dashboard:
- adicionar seção Product Intelligence;
- listar produtos do tenant;
- link para visão individual.

Nova superfície:
- `/dashboard/products/:productId`;
- overview por categoria;
- states `available`, `unavailable`, `pending_semantics`, `error`;
- provenance/freshness/quality quando houver valor.

Comparação:
- superfície inicial governada no dashboard ou página dedicada;
- nenhum gráfico/ranking se dados não forem comparáveis.

## 13. Core F11

O planner passa a receber:
- metric catalog;
- product catalog autorizado do tenant;
- contexto operacional.

O plano cognitivo poderá retornar:
- `metricIds`;
- `productSlugs`.

Guardrails:
- somente slugs presentes no catálogo autorizado;
- sem produto explícito, consulta continua global;
- com produto(s), cada slug é resolvido server-side;
- Core nunca cria produto;
- Core nunca troca tenant;
- fatos enviados ao modelo incluem product scope;
- evidence inclui productId/productSlug quando aplicável.

## 14. Auditabilidade

Registrar nas consultas cognitivas:
- evidence refs;
- product refs quando aplicável;
- tenant/actor/correlation já existentes.

APIs de criação de produto devem registrar ação de auditoria apropriada.

## 15. Observabilidade

Logs:
- sem secret;
- sem raw provider errors;
- podem registrar productId/slug, tenantId e correlationId quando necessário;
- cross-tenant/invalid product deve falhar fechado.

## 16. Testes obrigatórios

- Product Registry tenant scope;
- slug único por tenant;
- permission read/write;
- source/fact/metric product scope;
- cross-product isolation;
- cross-tenant denial;
- missing != zero;
- provenance;
- incompatible currency;
- incompatible period;
- product overview;
- portfolio comparison;
- Core single-product;
- Core multi-product;
- provider contract com product catalog;
- Audit Ledger;
- APIs;
- UI states;
- regressão F07–F10.

## 17. Migration

Migration versionada gerada por Drizzle.

Não editar migration gerada para mascarar divergência de schema.

## 18. Rollback

Rollback funcional:
- desabilitar superfícies F11 e voltar ao dashboard global;
- campos `product_id` são aditivos/opcionais;
- dados F07–F10 globais permanecem válidos;
- Product Registry é aditivo e não substitui tenant/source/metric authorities.

Rollback de banco destrutivo não será automatizado.

## 19. Riscos

- semânticas ainda pendentes em acquisition/activation/engagement/health;
- ausência atual de fontes reais por produto;
- comparação temporal depende de valores históricos comparáveis;
- migrations precisam preservar dados F07–F10;
- provider cognitivo deve respeitar product catalog autorizado.

## 20. Decisão de ADR

Não é necessário novo ADR nesta etapa.

A criação de Product Registry e product dimension é uma extensão coerente do Target F04 (visão por produto/unidade e múltiplos produtos) e não altera a distribuição do Core nem autoridade estrutural aprovada.

Se durante implementação surgir decisão difícil de reverter fora deste desenho, criar ADR específico antes de codificar essa parte.

## 21. Critérios de aceite e estado atual

F11 só fecha quando:
- Product Registry existe e é tenant-scoped;
- product scope chega a source/fact/metric;
- Product Overview existe;
- Portfolio Comparison existe;
- categorias F11 aparecem com valor ou gap honesto;
- growth só ocorre com histórico comparável;
- Core entende produto(s) autorizados;
- cross-tenant/cross-product testado;
- Audit Ledger/provenance preservados;
- CI 100% verde;
- Preview smoke concluído;
- documentação reconciliada.

**F12 permanece proibida até o fechamento formal de F11.**

## 22. Matriz de aceite reconciliada — 22/09/2026

| Critério | Estado |
|---|---|
| Product Registry tenant-scoped | PASS |
| product scope em source/fact/metric | PASS |
| Product Overview | PASS |
| Portfolio Comparison | PASS |
| categorias F11 com valor ou gap explícito | PASS |
| growth apenas com histórico comparável | PASS |
| Core entende produto(s) autorizados | PASS |
| cross-tenant/cross-product automatizado | PASS |
| Audit Ledger/provenance preservados | PASS |
| CI funcional | PASS — Gate #184 |
| Preview/smoke funcional F11 | PASS |
| UI pt-BR | PASS |
| Core por produto single/multi | PASS |
| voz pt-BR + campo limpo | PASS |
| documentação reconciliada | PASS — atualização final |
| health/ready final | PASS |
| gate final PR #11 | AGUARDANDO RECERTIFICAÇÃO DOCUMENTAL |
| merge PR #11 | PROIBIDO até GO final + autorização humana |

**Classificação atual da F11:** IMPLEMENTADA, CERTIFICADA EM CI E APROVADA NO SMOKE FUNCIONAL E DE RUNTIME.  
**Bloqueio remanescente:** somente a recertificação deste último HEAD documental e a autorização humana de merge após GO final.

## 23. Adições validadas durante o smoke

O smoke real incorporou melhorias sem alterar as autoridades arquiteturais:
- camada de apresentação pt-BR para impedir vazamento de enums técnicos;
- correção do falso erro pós-submit no cadastro de produto;
- limpeza automática da pergunta do Core após envio, preservando resposta/evidência;
- ditado por voz em pt-BR no navegador com fallback por digitação;
- lifecycle seguro do reconhecimento de fala.

Essas mudanças foram recertificadas no Gate #184 e validadas funcionalmente no Preview.
