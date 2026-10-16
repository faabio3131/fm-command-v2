# FM CONTROL CENTER — RELATÓRIO DE EXECUÇÃO F12–F15

**Data:** 22/09/2026  
**Baseline certificado:** `main@2a276f4c57577bf0236ae134311705f294d31b21`  
**Branch:** `feat/fmcc-f12-f15-business-operations`  
**PR:** #12 — OPEN/DRAFT  
**Produção:** não utilizada  
**F16:** não iniciada

## Resumo executivo

A tranche F12–F15 foi implementada de forma sequencial sobre a mesma arquitetura canônica do FM Control Center:

`Source → Integration Fabric → Canonical Facts → Metric Registry/Engine → Intelligence → API/UI → FMCC Vertical Core`.

Não foi criado ledger financeiro paralelo, segundo Metric Engine, segundo Product Registry ou segundo Core.

O candidate funcional consolidado é:

`545114ce2379178eae05b06d3b2fb66765cf006e`

No candidate:
- F12 Financeiro e Unit Economics: implementação + CI PASS;
- F13 Growth/Comercial: implementação + CI PASS;
- F14 Operações/SRE/Incidentes: implementação + CI PASS;
- F15 Clientes/Uso/Suporte: implementação + CI PASS.

A homologação em Preview do **candidate da PR #12** ainda não possui evidência válida. O serviço Render Preview existente acompanha `main`; esta missão proíbe merge e alteração direta da `main`. Portanto o Preview atual não pode ser usado como prova de que o candidate F12–F15 foi implantado.

## F12 — Financeiro e Unit Economics

### Implementado
- Current Discovery financeiro;
- System Design;
- `receivable.delinquent_amount`;
- `cost.infrastructure.total`;
- `cost.operating.total`;
- Financial Intelligence Service;
- API/UI financeira;
- resultado operacional determinístico;
- cálculo decimal textual/BigInt;
- bloqueio de moeda incompatível;
- bloqueio de período incompatível;
- Core groundeado no resultado determinístico.

### Fail-closed
Permanecem semântica pendente quando não sustentados:
- MRR;
- ARR;
- margem percentual;
- CAC;
- LTV;
- payback;
- ARPU.

Nenhum provider/custo externo foi inventado.

### Gate
Foundation Gate #205 — SUCCESS  
SHA: `c2afaf26fbe727baba3f6e3658e48978e06f1307`.

## F13 — Growth / Comercial

### Implementado
- `lead.created.count`;
- visão Growth por tenant/produto;
- API/UI;
- uso do `trial.starts.count` já governado;
- grounding pelo Metric Engine/Core.

### Fail-closed
Permanecem:
- trial conversion rate — pending semantics;
- CAC — pending semantics;
- channel attribution — pending semantics.

Nenhum CRM, UTM ou provider comercial inexistente foi declarado como fonte real.

### Gate
Foundation Gate #210 — SUCCESS  
SHA: `3fda942e6d898f6445f0ae4317c5e8ba38913c9b`.

## F14 — Operações, SRE e Incidentes

### Implementado
- `incident.count`;
- `job.failure.count`;
- `integration.failure.count`;
- `service.error.count`;
- visão operacional;
- API/UI;
- preservação dos endpoints /api/health e /api/ready como sinais pontuais;
- Core capaz de usar métricas operacionais governadas.

### Fail-closed
Não foram fabricados:
- uptime histórico;
- SLA/SLO;
- availability percentage;
- error rate sem denominador;
- infrastructure consumption sem fonte.

Alertas proativos/workflows permanecem F17.

### Gate
Foundation Gate #211 — SUCCESS no SHA `bbe84f94d953825dd783a5a16a8c15d666deb315`, via PR auxiliar #13, fechada sem merge.

O mesmo SHA também recebeu Foundation Gate #212 — SUCCESS na PR #12.

## F15 — Clientes, Uso e Suporte

### Implementado
- `usage.active_users.dau`;
- `usage.engagement.events`;
- `support.ticket.open.count`;
- Customer Intelligence Service;
- API/UI agregada;
- factual signals;
- Core customer intelligence usando agregados;
- superfície aggregate-only sem exposição de facts brutos/PII.

### Fail-closed
Permanecem semântica pendente:
- MAU;
- feature adoption rate;
- customer risk score;
- customer experience score.

Nenhum score mágico foi criado.

### Gate
Foundation Gate #214 — SUCCESS  
SHA: `545114ce2379178eae05b06d3b2fb66765cf006e`.

## Matriz de testes do candidate funcional

Gate #214:

- Install — PASS;
- Lint — PASS, com 2 warnings não bloqueantes de variáveis não utilizadas em test/mock;
- Typecheck — PASS;
- Verify migration matches schema — PASS;
- Apply versioned migration — PASS;
- Tests — PASS;
- Build — PASS;
- Docker build without runtime secrets — PASS;
- Runtime dependency audit at HIGH threshold — PASS.

Resultado:
- **31 test files PASS**;
- **109 tests PASS**;
- **0 FAIL**;
- nenhum SKIP registrado pelo Vitest no resumo do gate.

Dependências:
- 4 vulnerabilidades `moderate` transitivas em tooling;
- nenhuma HIGH/CRITICAL bloqueando o runtime audit atual;
- nenhum `npm audit fix --force` aplicado.

## Isolamento e governança

Preservado:
- tenant scope server-side;
- product scope server-side;
- Product Registry canônico;
- Canonical Facts;
- Metric Registry;
- Metric Engine determinístico;
- Core cognitivo não transacional;
- missing != zero;
- provenance;
- source authority;
- fail-closed para semântica não aprovada.

## Preview / homologação técnica

### Evidência histórica do ambiente
O projeto possui Render Preview real e já havia certificado health/readiness e jornadas das fases anteriores.

### Candidate F12–F15
**NÃO CERTIFICADO EM PREVIEW AINDA.**

Motivo:
- o serviço Preview vigente acompanha `main`;
- a PR #12 está corretamente OPEN/DRAFT;
- merge está proibido nesta missão;
- não existe conector Render autorizado nesta execução para reconfigurar/deployar a branch candidate;
- a tentativa de consulta externa direta aos endpoints não produziu evidência utilizável nesta execução e, mesmo que produzisse, a `main` não provaria o candidate.

Logo, não é permitido afirmar Preview PASS para o candidate.

## CURRENT final documental

A criação deste relatório e a reconciliação dos documentos geram um HEAD documental posterior ao candidate funcional #214.

Esse HEAD deve passar pelo Foundation Gate integral.

Para evitar criar um novo HEAD depois da certificação, o resultado do gate documental final será registrado na conversa da PR #12 e não por novo commit.

## Governança

Confirmado:
- `main` não foi alterada diretamente;
- PR #12 permanece OPEN/DRAFT;
- nenhum merge;
- nenhum deploy de produção;
- F16 não foi iniciada;
- nenhum force push;
- nenhum secret versionado;
- nenhuma métrica fabricada;
- PR auxiliar #13 foi fechada sem merge.

## Progresso

A implementação funcional de F12–F15 alcança o escopo correspondente ao marco planejado de 88%.

Porém, o **marco oficial de 88% certificado não deve ser declarado enquanto o Preview do candidate permanecer sem evidência**.

## Veredito atual

**TRANCHE F12–F15 BLOQUEADA — PENDÊNCIAS CRÍTICAS**

Bloqueio único conhecido para a certificação desta missão:
- homologação/smoke do **candidate F12–F15** no ambiente Preview existente ou equivalente autorizado.

Não há falha de código conhecida no candidate funcional certificado pelo CI.

Nenhum merge deve ser executado até resolver a evidência de Preview e realizar a auditoria final da tranche.


---

## CURRENT PÓS-MERGE / FECHAMENTO FACTUAL — 23/09/2026

Esta seção complementa o estado histórico acima sem apagá-lo.

Estado factual posterior à emissão original deste documento:

- PR #12: **MERGED / CLOSED**;
- squash merge na `main`: `9632dd3871790a8b709fa5bc11211b9649b943fa`;
- Foundation Gate pós-merge #220: **SUCCESS**;
- 31 test files / 109 tests PASS / 0 FAIL;
- Render Preview `fmcc-preview-web` reconfigurado para `main`;
- source implantado: `9632dd3`;
- deploy: **succeeded / live**;
- startup migration: PASS;
- `/api/health`: PASS;
- `/api/ready`: PASS;
- login/dashboard: PASS;
- F12 Financeiro: Preview PASS;
- F13 Growth/Comercial: Preview PASS;
- F14 Operações/SRE: Preview PASS;
- F15 Clientes/Uso/Suporte: Preview PASS;
- Core financeiro e Core uso/suporte: fail-closed + provenance PASS;
- progresso oficial F12–F15 após homologação: **88%**.

Portanto, descrições anteriores de PR #12 OPEN/DRAFT, Preview bloqueado e 88% ainda não certificado representam o **estado histórico pré-merge**, não o CURRENT atual.
