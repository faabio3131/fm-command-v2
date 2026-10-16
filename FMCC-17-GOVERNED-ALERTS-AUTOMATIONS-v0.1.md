# FM CONTROL CENTER — F17 ALERTAS E AUTOMAÇÕES GOVERNADAS

**Fase:** F17 — 91% → 93%  
**Branch:** `feat/fmcc-f16-f19-advanced-intelligence-readiness`  
**Baseline interna:** F16 Gate #228 — SUCCESS  
**Status:** CURRENT DISCOVERY + SYSTEM DESIGN

## 1. CURRENT confirmado

Existe:
- Metric Registry/Engine;
- sinais F12–F16;
- Audit Ledger PostgreSQL;
- RBAC;
- correlationId;
- idempotência no Integration Fabric;
- Core com evidence metadata;
- health/readiness;
- infraestrutura Next.js/PostgreSQL.

Não existe:
- scheduler canônico;
- queue/event bus;
- notification provider;
- workflow engine;
- provider de ações externas;
- policy aprovada para ações financeiras/comerciais críticas.

## 2. Decisão proporcional

F17 não introduzirá scheduler, queue ou provider externo sem necessidade comprovada.

O mecanismo inicial será:
- regras explicitamente configuradas;
- avaliação determinística sob demanda/trigger autorizado;
- ocorrência persistida no Audit Ledger;
- fingerprint determinístico;
- lock transacional PostgreSQL para impedir ocorrência duplicada concorrente;
- action preview/intents auditáveis;
- nenhuma ação crítica externa executada.

O Audit Ledger funcionará como event stream durável para:
- `alert.rule.created`;
- `alert.raised`;
- `alert.acknowledged`;
- `action.intent.prepared`.

Isso evita criar uma segunda infraestrutura de persistência apenas para eventos derivados nesta fase.

## 3. AlertRule

Campos:
- id;
- tenant;
- productId opcional;
- metricId;
- operator;
- threshold;
- severity;
- enabled;
- createdBy;
- createdAt.

Operators:
- gt;
- gte;
- lt;
- lte;
- eq.

Threshold deve ser decimal textual válido.

A regra só pode referenciar métrica registrada.

## 4. AlertEvaluation

Fluxo:
`Rule → MetricService.query → deterministic compare → AlertOccurrence`.

Estados:
- triggered;
- clear;
- unavailable;
- incompatible.

Missing nunca vira zero.

Currency/unidade permanecem as da métrica governada; a regra não converte moedas.

## 5. AlertOccurrence

Inclui:
- ruleId;
- metricId;
- productId;
- observedValue;
- threshold;
- operator;
- severity;
- evidence/provenance;
- fingerprint;
- correlation;
- occurredAt.

Fingerprint deve ser derivado de:
tenant + rule + metric observation/provenance.

Reavaliação da mesma observação não cria duplicata.

## 6. Ações governadas

F17 suporta somente preparação de intent/preview.

Risco:
- low;
- medium;
- high.

Low:
- ações internas não destrutivas podem ser preparadas.

Medium:
- sempre preview/approval required.

High:
- preview somente; execução externa fica indisponível nesta fase.

Nenhum output do Core vira efeito crítico diretamente.

## 7. RBAC

Novas permissões:
- `alert:read`;
- `alert:write`;
- `action:prepare`.

Owner/Admin:
- read/write/prepare.

Analyst:
- read/prepare.

Viewer/Member:
- read.

## 8. Idempotência e replay

Persistência de ocorrência/intents usa:
- fingerprint;
- PostgreSQL advisory transaction lock por tenant+fingerprint;
- read-before-insert sob lock.

Não existem side effects externos na F17.

## 9. UI

Superfície:
`/dashboard/alerts`

Estados:
- loading;
- empty;
- active;
- acknowledged;
- resolved (contrato preparado; execução de resolução automática não é presumida);
- failed;
- unavailable;
- forbidden.

A UI deve mostrar:
- regra;
- severidade;
- origem/métrica;
- evidência;
- timestamp;
- status;
- recommendation/action preview quando aplicável.

## 10. Core

O Core pode:
- explicar alerta;
- correlacionar evidence;
- recomendar próximo passo;
- preparar intenção governada via serviço determinístico autorizado.

O Core não pode:
- executar pagamento;
- mudar preço;
- cancelar assinatura;
- alterar privilégio;
- publicar campanha;
- mudar infraestrutura crítica.

## 11. Gate F17

Cobrir:
- validation;
- rule evaluation;
- threshold boundaries;
- missing;
- duplicate/replay;
- idempotency;
- concurrency lock path;
- tenant/product isolation;
- RBAC;
- forbidden action;
- stale/unavailable evidence;
- audit;
- action confirmation policy;
- fail-closed;
- UI states;
- lint/typecheck/tests/build/Docker/audit;
- Preview proporcional.

## 12. Evidência de execução

Implementação realizada incrementalmente sobre F16 certificada.

Entregas comprovadas:
- regras determinísticas de alerta;
- avaliação fail-closed de thresholds;
- missing/stale nunca convertido em zero;
- persistência em Audit Ledger;
- fingerprint/idempotência;
- advisory transaction lock PostgreSQL para concorrência;
- RBAC `alert:read`, `alert:write`, `action:prepare`;
- action intents/previews auditáveis;
- ações de médio/alto risco sem side effect externo;
- APIs e dashboard `/dashboard/alerts`;
- testes de replay, idempotência, RBAC, audit e tenant isolation.

Gate de engenharia:
- **Foundation Gate #237 — SUCCESS**
- HEAD certificado: `303f0f042d95076c05f032dbd34ce9fbb9fdb56e`
- 36 test files PASS;
- 123 tests PASS;
- 0 FAIL;
- lint/typecheck/migrations/build/Docker/dependency audit PASS.

Estado: **IMPLEMENTADA E CERTIFICADA EM CI**.

Nenhuma automação crítica externa foi executada ou habilitada autonomamente.
