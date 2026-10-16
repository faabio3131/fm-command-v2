# FMCC — F20 INDEPENDENT AUDIT & FIX — INITIAL FINDINGS

Status: AUDIT PASS 1 CONCLUÍDO / FIX PENDENTE

Baseline auditada:
`main@c70a9d0b36f860926122c47497ca9256f76a2ed4`

Escopo:
- architecture;
- security;
- tenancy/RBAC;
- data integrity;
- integration boundaries;
- Core grounding;
- automation;
- CI/supply chain;
- Preview evidence;
- operations/readiness blockers.

Visual Premium / redesign global: EXCLUÍDO.

## Evidência de baseline

- Foundation Gate #395: SUCCESS.
- 49 test files / 187 tests PASS.
- Browser E2E 6/6 PASS.
- secret scan PASS.
- runtime smoke PASS.
- Docker PASS.
- dependency audit HIGH threshold PASS.
- Preview Deployment Gate anterior do SHA funcional: PASS.
- Source Coverage reconciliada.
- Kordena KCA-13 source contract: merged/gates green.
- Nenhuma source externa não homologada declarada CONNECTED.

## Método de auditoria

Passe 1 executado em modo read-only sobre o baseline antes de qualquer correção.

Foram revisados:
- Auth/Tenant/RBAC;
- Better Auth configuration;
- commercial step-up;
- commercial approval;
- Kordena connector/control service;
- source registry/runtime;
- sync/canonical facts;
- metric registry/engine/store;
- Audit Ledger;
- alert lifecycle/automation;
- Core gateway/model/provider adapter;
- migrations/schema;
- CI/Docker;
- E2E;
- security/secrets;
- operational gates.

## Findings

### F20-H01 — HIGH — Prévia comercial não está criptograficamente vinculada ao payload realmente pré-visualizado

Evidência:
- a UI de publicação chama o action de preview enviando `payload={}`;
- o payload que será publicado é enviado separadamente como `approvalContext`;
- o servidor emite approval hash sobre `approvalContext`, mas o provider Kordena recebe o `payload` do preview;
- portanto a resposta de preview pode não representar o conteúdo que o token autoriza publicar.

Impacto:
o Human/Policy Gate de preço/plano/promoção pode aprovar um payload diferente do que foi efetivamente pré-visualizado.

Correção obrigatória:
- remover `approvalContext` como canal paralelo;
- preview deve receber exatamente o payload proposto;
- approval deve ser emitido somente para o mesmo payload efetivamente enviado ao preview;
- adicionar testes adversariais de mismatch.

### F20-H02 — HIGH — Action comercial não possui allowlist runtime antes do forward

Evidência:
- `body.action` é validado apenas como string;
- depois é convertido por cast TypeScript para `KordenaCommercialCommand`;
- TypeScript não valida runtime;
- actions não reconhecidas não passam por `isHighRiskCommercialPublish` e podem ser encaminhadas ao provider.

Impacto:
um action futuro/oculto aceito pelo Kordena poderia contornar classificação de risco e gate de publicação.

Correção obrigatória:
- allowlist runtime explícita;
- rejeitar unknown action antes de step-up/forward;
- classificar preview/publish/create/validate explicitamente;
- teste adversarial para action desconhecida.

### F20-H03 — HIGH — Replay guard de approval comercial consulta apenas os 100 últimos consumos

Evidência:
- `consumeCommercialApproval` lê `alertEvents`/Audit Ledger de `commercial.command.approval_consumed` com `.limit(100)`;
- um token consumido mais antigo pode sair da janela;
- approval TTL é 5 minutos.

Impacto:
em tenant de alto volume, um approval já consumido pode deixar de ser reconhecido como consumido ainda dentro do TTL.

Correção obrigatória:
- consultar consumo pelo hash exato do token, sem janela arbitrária;
- manter lock/advisory transaction;
- teste com >100 consumos posteriores.

### F20-H04 — HIGH — Requests comerciais externos não aplicam AbortSignal/timeout real no connector

Evidência:
- `KordenaCommercialControlService` cria context com `timeoutMs=8000`;
- `KordenaCommercialConnector.request` não usa `context.timeoutMs`;
- snapshot/command diretos não passam pelo `ConnectorRuntime.withTimeout`;
- mesmo no runtime pull, Promise.race não cancela o fetch subjacente.

Impacto:
upstream lento/hung pode manter requests e conexões vivas, gerar execução incerta e amplificar retries.

Correção obrigatória:
- AbortController/AbortSignal no próprio request do connector;
- timeout propagado a health/snapshot/pull/command;
- preservar idempotency key;
- testes de abort/timeout.

### F20-H05 — HIGH — Build/release não é reprodutível por ausência de lockfile

Evidência:
- repositório não contém `package-lock.json`;
- CI usa `npm install`;
- Docker usa `npm install`;
- devDependencies usam ranges.

Impacto:
mesmo SHA pode resolver árvore transitiva diferente em momentos diferentes; release candidate não é estritamente imutável/reprodutível.

Correção obrigatória:
- gerar e versionar lockfile;
- CI/Docker usar `npm ci`;
- recertificar build/test/audit.

### F20-M01 — MEDIUM — Idempotency de sync é tenant-wide, não tenant+source

Evidência:
- unique index: `tenant_id,idempotency_key`;
- repository lookup/restart usa tenant+key;
- sourceId não participa da identidade.

Impacto:
reuso da mesma chave em duas sources do mesmo tenant pode fazer a segunda herdar estado da primeira.

Correção:
- migration para `tenant_id,source_id,idempotency_key`;
- repository lookup/restart com sourceId;
- teste cross-source.

### F20-M02 — MEDIUM — Alert rules são truncadas em 100 registros

Evidência:
- `PostgresAlertRepository.listRules` limita created rows a 100;
- duplicate detection usa `listRules`;
- AlertAutomationService usa overview/listRules para selecionar regras ativas.

Impacto:
regra ativa antiga pode desaparecer da operação/automação e duplicate detection.

Correção:
- eliminar truncamento para rules ou implementar paginação/consulta específica;
- teste com >100 rules.

### F20-M03 — MEDIUM — Alert automation não possui stale-run recovery

Evidência:
- `beginRun` grava `alert.automation.started`;
- qualquer started existente para o mesmo runId retorna duplicate;
- ausência de completed/failure/stale recovery;
- workflow tem timeout de 5 minutos.

Impacto:
falha abrupta depois de started pode transformar retry do mesmo runId em duplicate sem completar avaliação.

Correção:
- lifecycle explícito started/completed/failed/restarted;
- recuperação governada de run stale com threshold derivado do timeout do job;
- teste de uncertain result.

### F20-M04 — MEDIUM — Audit metadata não tem sanitização central e Core persiste texto arbitrário

Evidência:
- ADR-008 exige metadata sanitizada;
- `recordAuditEvent` grava metadata diretamente;
- `core.query` persiste question/answer completos;
- usuário/modelo podem inserir material sensível no texto.

Impacto:
secret/PII/business-sensitive content pode ficar retido no ledger lógico append-only.

Correção técnica:
- sanitizer central de metadata;
- redaction de chaves e padrões de segredo;
- limites de tamanho;
- reduzir dados brutos quando não necessários.

Dependência de governança:
- política de retenção/PII final permanece decisão F21.

### F20-M05 — MEDIUM — Baseline de security headers ausente

Evidência:
`next.config.ts` possui apenas `poweredByHeader=false` e standalone output.

Impacto:
faltam hardenings HTTP básicos contra framing, MIME sniffing e leakage de referrer.

Correção:
- headers globais compatíveis com Next;
- teste/runtime smoke dos headers;
- evitar CSP que quebre o app; aplicar baseline segura e validada.

### F20-M06 — MEDIUM — GitHub Actions usa tags mutáveis

Evidência:
- `actions/checkout@v5`;
- `actions/setup-node@v4`.

Impacto:
supply-chain pinning incompleto.

Correção:
- fixar SHAs exatos das actions já observados nos runs certificados;
- manter comentário de versão humana.

### F20-M07 — MEDIUM — 4 vulnerabilidades transitivas MODERATE no tooling

Evidência:
- `esbuild <=0.24.2`;
- GHSA-67mh-4wv8-2f99;
- cadeia reportada via drizzle-kit tooling;
- npm sugere fix com alteração breaking.

Classificação:
não há HIGH/CRITICAL e o artefato standalone não carrega drizzle-kit como runtime operacional.

Tratamento:
- não executar `npm audit fix --force` cegamente;
- manter explicitamente aceita para F20 se lockfile provar árvore exata;
- reavaliar upgrade seguro na janela de dependências.

### F20-L01 — LOW — Source health/sync cross-tenant cai em erro genérico 502 em algumas rotas

Impacto:
sem leak de recurso, mas semântica HTTP pode ser mais precisa.

Tratamento:
corrigir se tocar nessas rotas durante Fix.

### F20-I01 — INFO — Audit Ledger é append-only lógico, não imutável por trigger

Conforme ADR-008, isso é coerente com a decisão atual:
- aplicação não oferece update/delete ordinário;
- não é finding bloqueante.

### F20-I02 — INFO — RLS não está ativo

Conforme F05/ADR, RLS foi deferido como defense-in-depth.
Tenant scope é server-side e tenant-first nas queries/repositories.
Não é finding bloqueante nesta fase.

### F20-I03 — INFO — Retention/SLO/providers externos continuam decisões de F21

Não podem ser inventados por código.

## Sumário de severidade

- BLOCKER: 0
- CRITICAL: 0
- HIGH: 5
- MEDIUM: 7
- LOW: 1
- INFO: 3

## Gate de F20

F20 NÃO pode ser aprovada neste estado.

Obrigatório:
1. corrigir F20-H01..H05;
2. corrigir MEDIUM materialmente solucionáveis nesta tranche;
3. executar testes alvo;
4. regressão integral;
5. Preview/Staging;
6. segundo passe de auditoria;
7. zero HIGH/CRITICAL aberto;
8. emitir `FM AUDIT & FIX — APPROVED` somente com evidência.

## Handoff para fase Fix

PROJECT:
FM CONTROL CENTER

REPOSITORY:
`faabio3131/FM-CONTROL-CENTER`

BASELINE:
`c70a9d0b36f860926122c47497ca9256f76a2ed4`

TARGET:
F20 APPROVED sem Visual Premium.

KNOWN EXTERNAL BLOCKERS:
- Kordena runtime credentials/source real;
- scheduler runtime real;
- provider decisions;
- pending metric semantics;
- retention/SLO policies.

Nenhum desses blockers autoriza mascarar findings de código.


# SECOND PASS — FIX VERIFICATION

Status: **FIX COMPLETE / FINAL PREVIEW PENDING / H3 PENDING**

Segundo passe executado depois das correções, sem Visual Premium.

## Findings resolvidos

### F20-H01 — RESOLVED
A prévia comercial agora recebe exatamente o mesmo payload proposto que será
posteriormente publicado. O approval hash é emitido sobre o payload realmente
encaminhado ao preview; o canal paralelo `approvalContext` foi removido.

### F20-H02 — RESOLVED
Actions comerciais possuem allowlist runtime explícita por
`isKordenaCommercialAction`. Action desconhecida é recusada antes de forward.

### F20-H03 — RESOLVED
Replay guard consulta approval/consumo pelo `tokenHash` exato no Audit Ledger,
sem janela arbitrária dos 100 eventos mais recentes. Lock transacional foi
preservado. Há cobertura adversarial com mais de 100 consumos posteriores.

### F20-H04 — RESOLVED
O connector Kordena aplica cancelamento real por AbortController/AbortSignal
usando o timeout do ConnectorContext em health/snapshot/pull/command.
Request hung é abortado e falha fechado.

### F20-H05 — RESOLVED
`package-lock.json` passou a ser versionado.
Foundation Gate, Cognitive Gate e Docker usam `npm ci`.
As GitHub Actions relevantes estão SHA-pinned.
O mesmo SHA passa a resolver a mesma árvore de dependências.

### F20-M01 — RESOLVED
A identidade de idempotência de sync passou a ser namespaced por `sourceId`
antes da persistência, tornando a constraint existente tenant-scoped
equivalente a `tenant + source + client key` sem migration destrutiva.
Lookup/restart também exige o mesmo source. Teste prova a mesma client key em
duas sources do mesmo tenant sem colisão.

### F20-M02 — RESOLVED
`listRules` não trunca mais as regras criadas em 100 registros. Teste com 105
regras prova visibilidade das mais antigas e mais novas.

### F20-M03 — RESOLVED
Alert automation possui lifecycle explícito:
`started/restarted/failed/completed`, recovery de falha e recovery de run
stale. Run concluído permanece duplicate-safe. O threshold stale é superior ao
timeout operacional do workflow.

### F20-M04 — RESOLVED
`recordAuditEvent` aplica sanitizer central de metadata.
Há redaction de chaves sensíveis, padrões de segredo inline, e-mails, limites de
profundidade, quantidade de entradas e tamanho de strings.
A política legal/comercial de retenção continua corretamente deferida à F21.

### F20-M05 — RESOLVED
Baseline de security headers global:
- X-Content-Type-Options: nosniff;
- X-Frame-Options: DENY;
- Referrer-Policy: strict-origin-when-cross-origin;
- Permissions-Policy restritiva.

Runtime smoke valida os headers.

### F20-M06 — RESOLVED
`actions/checkout` e `actions/setup-node` foram fixados em SHAs imutáveis nos
gates que os utilizam.

### F20-M07 — ACCEPTED / NON-BLOCKING
Persistem 4 vulnerabilidades transitivas MODERATE do tooling.
Não há HIGH/CRITICAL. O audit runtime com `--omit=dev --audit-level=high`
permanece verde.
Não foi usado `npm audit fix --force` por exigir alteração breaking não
justificada. A árvore exata agora está congelada pelo lockfile.

### F20-L01 — RESOLVED
Cross-tenant source health/sync passa a retornar denial governado (403) em vez
de cair no erro genérico 502.

## Finding adicional do segundo passe

### F20-M08 — MEDIUM — RESOLVED
O segundo passe detectou que acknowledgement e preparação de ação procuravam
ocorrências por uma janela dos 100 eventos mais recentes.

Correção:
- novo lookup exato tenant-scoped por `occurrenceId`;
- acknowledgement usa lookup exato;
- `prepareAction` usa lookup exato;
- teste de integração cria 105 ocorrências e prova acesso/acknowledgement da
  ocorrência mais antiga.

## Evidência técnica após Fix

Candidate de código auditado antes deste commit documental:
`b741c854530a608039ed194238c972ad867d85d9`

Foundation Gate #432: **SUCCESS**
- install reprodutível com `npm ci`;
- lint PASS;
- typecheck PASS;
- migration/schema verification PASS;
- migrations PASS;
- 51 test files PASS;
- 200 tests PASS;
- secret scan PASS — 241 tracked files;
- build PASS;
- Browser E2E 6/6 PASS;
- runtime smoke PASS;
- Docker build PASS usando `npm ci`;
- dependency audit HIGH threshold PASS;
- 4 MODERATE transitivas conhecidas.

Cognitive Governed Intelligence Gate #108: **SUCCESS**
- 8 arquivos direcionados PASS;
- 53 testes cognitivos/integracionais direcionados PASS;
- regressão integral 51 arquivos / 200 testes PASS;
- build PASS;
- whitespace gate PASS;
- dependency audit HIGH threshold PASS.

## Segundo passe — severidade aberta

- BLOCKER: 0
- CRITICAL: 0
- HIGH: 0
- MEDIUM bloqueante: 0
- MEDIUM aceita: 1 (`F20-M07`, tooling transitivo MODERATE / não runtime)
- LOW aberto: 0
- INFO: 3, não bloqueantes conforme ADRs/governança

## Pendência antes de F20 APPROVED

Este commit documental altera o HEAD da PR #22 e deve ser recertificado.

Depois da recertificação integral, ainda é obrigatório homologar o **HEAD final
exato da PR #22 em Preview/Staging** antes de emitir:

`FM AUDIT & FIX — APPROVED`

Sem Preview/Staging do HEAD final:
**F20 permanece FIX COMPLETE / PREVIEW PENDING.**

## H3

Mesmo depois do Preview PASS:
- PR #22 permanece DRAFT até fechamento;
- merge exige H3 humano explícito;
- produção permanece proibida.
