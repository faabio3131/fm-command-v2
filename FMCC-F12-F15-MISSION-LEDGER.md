# FM CONTROL CENTER — F12–F15 MISSION LEDGER

**Baseline:** `2a276f4c57577bf0236ae134311705f294d31b21`  
**Branch:** `feat/fmcc-f12-f15-business-operations`  
**PR:** #12 — OPEN/DRAFT  
**Produção:** fora do escopo  
**F16:** proibida nesta tranche

## Gates

| Fase | Estado | Evidência |
|---|---|---|
| F11 pós-merge | PASS | Gate #192 SUCCESS |
| F12 Current Discovery | PASS | `FMCC-12-CURRENT-DISCOVERY-FINANCE-v0.1.md` |
| F12 System Design | PASS | `FMCC-12-FINANCIAL-UNIT-ECONOMICS-v0.1.md` |
| F12 implementação | PASS | Finance service/API/UI + deterministic operating result + Core grounding |
| F12 gate | PASS | Foundation Gate #205 — SUCCESS on `c2afaf26fbe727baba3f6e3658e48978e06f1307` |
| F13 | PASS | Foundation Gate #210 — SUCCESS on `3fda942e6d898f6445f0ae4317c5e8ba38913c9b` |
| F14 | PASS | Foundation Gate #211 — SUCCESS on `bbe84f94d953825dd783a5a16a8c15d666deb315`; auxiliary Draft PR #13 closed without merge; Gate #212 also SUCCESS on the same SHA in PR #12 |
| F15 implementação | PASS | Customer Usage/Support intelligence + aggregate-only privacy + Core grounding |
| F15 gate | PASS | Foundation Gate #214 — SUCCESS on `545114ce2379178eae05b06d3b2fb66765cf006e`; 31 test files / 109 tests PASS / 0 FAIL |
| Preview candidate F12–F15 | BLOQUEADO POR EVIDÊNCIA | serviço Preview existente acompanha `main`; candidate da PR #12 não foi implantado sem merge/reconfiguração externa |

## Guardrails

- missing != zero;
- multi-moeda sem FX falha fechado;
- product/tenant isolation server-side;
- sem providers inventados;
- sem scores mágicos;
- Core cognitivo não substitui cálculo determinístico;
- PR permanece Draft;
- sem merge, produção ou F16.


## Estado consolidado após Gate #214

- F12: implementação + CI PASS;
- F13: implementação + CI PASS;
- F14: implementação + CI PASS;
- F15: implementação + CI PASS;
- HEAD funcional certificado: `545114ce2379178eae05b06d3b2fb66765cf006e`;
- testes: 31 arquivos / 109 testes PASS / 0 FAIL;
- lint: PASS com 2 warnings de variáveis não utilizadas em teste/mock;
- typecheck: PASS;
- migration verify/apply: PASS;
- build: PASS;
- Docker build: PASS;
- runtime dependency audit: PASS no threshold HIGH; 4 vulnerabilidades moderate transitivas em tooling permanecem registradas;
- Preview do **candidate F12–F15**: ainda sem evidência válida.

### Bloqueio operacional de Preview

O serviço Render Preview existente está configurado para acompanhar `main`. Como esta missão proíbe merge e alteração direta da `main`, não é correto afirmar que o candidate da PR #12 foi homologado nesse Preview.

O bloqueio é de **evidência operacional externa**, não falha conhecida de implementação/CI. A tranche não recebe classificação READY FOR MERGE até o smoke do candidate existir.


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
