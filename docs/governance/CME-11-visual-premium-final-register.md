# CME-11 — Visual Premium Final

**Projeto:** FM Command
**Repositório:** `faabio3131/FM-CONTROL-CENTER`
**Baseline:** `main@f6a9a287b8eb7d82ea5ad2daf5dbeecce3617ce7`
**Branch:** `feat/fm-command-cme11-visual-premium-final`
**Status:** LOCAL_CERTIFIED / VISUAL_APPROVED / PENDING_PR_MERGE_AND_EXACT_SHA_DEPLOY

## Autoridade visual

A referência oficial é o dashboard premium aprovado pelo proprietário da FM Tecnologia.

A implementação deve preservar integralmente:

- autenticação;
- autorização e RBAC;
- tenancy;
- APIs e contratos;
- regras de negócio;
- autoridades determinísticas;
- integração Kordena;
- Core cognitivo;
- métricas e semântica;
- observabilidade;
- auditoria.

## Delta CME-11

- busca global governada exposta no topbar;
- identidade FM Tecnologia / COMMAND preservada;
- artwork aprovado do FM Command confirmado na tela de login e aplicado ao painel cognitivo do dashboard usando a mesma autoridade `APPROVED_COMMAND_ARTWORK_SRC`; validação visual aprovada pelo proprietário;
- Visão Geral recomposta com hierarquia executiva equivalente à referência;
- rail de Saúde Operacional, Status dos Serviços e Alertas;
- Activity Feed compactado em cards executivos;
- design system final reforçado para tabelas, estados, responsividade e densidade;
- nenhuma métrica conceitual do mock foi hardcoded;
- ausência de fonte continua sendo `Indisponível`, nunca zero presumido.

## Revisão visual pós-merge — pendências antes do deploy

- copy do hero do Core aprovada para `INTELIGÊNCIA COGNITIVA VERTICAL` e aplicada localmente;
- artwork do dashboard substituído pelo mesmo asset oficial aprovado usado na tela de login; validação visual do proprietário APROVADA;
- microtextos sobrepostos removidos da composição do artwork; validação visual APROVADA;
- compactação desktop aplicada localmente em Financeiro, Assinaturas, Clientes, Operações, Atividades e Alertas, reduzindo cabeçalhos, cards, gaps, painéis, filtros e controles;
- CME-11.2 aplicado localmente em Visão Geral + Notificações: em 1366×768 o header da Visão Geral caiu de 114px para 81px, os quatro cards executivos de 144px para 92px e o Core subiu de Y=386 para Y=269; Notificações passou de scrollHeight 1033/overflow 265px para scrollHeight 768/overflow 0 após compactação e scroll interno governado da sidebar;
- responsividade CME-11.2 validada sem overflow horizontal em 1440×900, 900×900 e 390×844;
- bloqueio interno da voz corrigido: `Permissions-Policy` permite `microphone=(self)` e mantém câmera/geolocalização bloqueadas; fluxo SpeechRecognition pt-BR e policy recertificados, com smoke humano de hardware/permissão real reservado ao pós-deploy;
- nenhuma destas correções está publicada no Render.

## Gates exigidos

```text
CANDIDATE_SHA = af6306c8f99e74258e0c32abf5f24c6b519b7b0f

FMCC_F21_READINESS_RUN = 37220269733 / SUCCESS
FMCC_FOUNDATION_RUN = 37220269639 / SUCCESS
FMCC_COGNITIVE_GOVERNED_RUN = 37220269645 / SUCCESS

LINT = PASS
TYPECHECK = PASS
UNIT_INTEGRATION_TESTS = PASS
CME_11_VISUAL_CONTRACT = PASS
BUILD = PASS
BROWSER_E2E = PASS
RUNTIME_SMOKE = PASS
DOCKER_BUILD_WITHOUT_RUNTIME_SECRETS = PASS
SECRET_SCAN = PASS
SECURITY_TENANCY_ADVERSARIAL = PASS
BACKUP_RESTORE_SMOKE = PASS
DEPENDENCY_AUDIT = PASS
DIFF_WHITESPACE = PASS

PROHIBITED_BACKEND_AUTH_RBAC_TENANCY_DELTA = 0
MOCK_NUMBERS_AS_REAL_DATA = 0
MISSING_TO_ZERO = 0

PREVIEW_EXACT_SHA = PENDING_POST_MERGE
POST_MERGE = PENDING

CME_11_PRE_MERGE = PASS
CME_11_FINAL = PENDING_POST_MERGE
```

## STOP conditions

- regressão funcional;
- rota quebrada;
- auth/RBAC/tenancy alterados;
- dado inexistente exibido como zero;
- número do mock usado como dado real;
- secret/PII exposto;
- preview em SHA diferente do certificado;
- gate crítico vermelho.


## CME-11.3 — Refinamento final de densidade visual

**Branch corretiva:** `fix/fm-command-cme11-visual-refinement`
**Escopo:** somente `/dashboard/growth`, `/dashboard/customers` e `/dashboard/settings`.
**Render/deploy/merge:** não executados.

### Resultado em 1366×768

| Tela | Antes | Depois | Delta principal |
|---|---:|---:|---|
| Growth / Comercial | scrollHeight 811 / overflow Y 43px | scrollHeight 768 / overflow Y 0 | header 138→93px; cards 158→94px |
| Clientes | scrollHeight 768 / overflow Y 0 | scrollHeight 768 / overflow Y 0 | header 107→93px; cards 112→94px; painéis mais compactos |
| Configurações | scrollHeight 1023 / overflow Y 255px | scrollHeight 768 / overflow Y 0 | header 107→93px; painéis administrativos 275→164px; atalhos 70→48px |

Nas três rotas, `overflowX = 0`.

### Responsividade

- 1440×900: Growth, Clientes e Configurações com overflow Y/X = 0;
- 1920×1080: Growth, Clientes e Configurações com overflow Y/X = 0;
- 900×768: comportamento responsivo preservado, com rolagem vertical natural e overflow horizontal = 0;
- nenhuma informação, card ou módulo foi removido para atingir a compactação;
- nenhum `overflow:hidden` foi usado para mascarar conteúdo.

### Gates pós-ajuste

```text
CME_11_3_LINT = PASS
CME_11_3_TYPECHECK = PASS
CME_11_3_VISUAL_TESTS = 19/19 PASS
CME_11_3_DIFF_CHECK = PASS
CME_11_3_PRODUCTION_BUILD = PASS
CME_11_3_VIEWPORT_1366x768 = PASS
CME_11_3_VIEWPORT_1440x900 = PASS
CME_11_3_VIEWPORT_1920x1080 = PASS
CME_11_3_RESPONSIVE_UNDER_981 = PASS
RENDER_CHANGED = NO
DEPLOY_EXECUTED = NO
MERGE_EXECUTED = NO
```

### Estado

`CME_11_3_LOCAL_REFINEMENT = PASS`

A conferência visual do proprietário foi APROVADA. A promoção agora depende somente de commit/PR, CI verde, merge e pós-merge exact-SHA.


## Certificação local final pós-auditoria

```text
VISUAL_OWNER_APPROVAL = APPROVED
LINT = PASS
TYPECHECK = PASS
UNIT_INTEGRATION_TESTS = 338/338 PASS
UNIT_INTEGRATION_TEST_FILES = 81/81 PASS
BROWSER_E2E = 7/7 PASS
RUNTIME_SMOKE = PASS
PRODUCTION_BUILD = PASS
SECRET_SCAN = PASS (357 tracked files)
F21_READINESS = PASS
DEPENDENCY_AUDIT_HIGH_CRITICAL = PASS
DIFF_WHITESPACE = PASS

CME_11_LOCAL_FINAL = PASS
PR_MERGE = PENDING
RENDER_EXACT_SHA = PENDING_POST_MERGE
```

A recertificação integral foi executada em PostgreSQL novo com migrations aplicadas e runner Vitest determinístico (`fileParallelism: false`). Um único teste de rota do scheduler recebeu timeout explícito de 15s para absorver carregamento frio de módulos no Windows; nenhuma asserção foi removida ou enfraquecida, e o endpoint continuou fail-closed. A prévia local aprovada permanece separada do Render até o merge.

## Reconciliação final da PR visual histórica #32 — 2026-10-06

A PR #32 (`feat/command-premium-dashboard-20261001`) permanece baseada em uma arquitetura anterior e não deve ser mergeada sobre o CURRENT.

Evidência do CURRENT antes desta tranche:

- `main@5cf6c305491a1ba1b027f9d736e73476c83eb017`;
- visual premium e artwork oficial já presentes no CURRENT;
- `CommandOrbLogo` da PR #32 não existe mais no CURRENT e foi substituído pelo artwork oficial aprovado;
- shell, Core, navegação, produto, notificações, busca, operações e demais módulos evoluíram depois da PR #32;
- Foundation Gate, F21 Operational Readiness Gate e Preview Deployment Gate verdes no CURRENT;
- Render LIVE no SHA exato acima;
- `/api/health = ok` e `/api/ready = ready`;
- proteção de `main` exige `foundation` + `readiness`, strict, sem force-push/delete.

Gap de evidência encontrado durante a reconciliação:

- o E2E CURRENT validava explicitamente 1366×768, 768×1024 e 390×844;
- faltava uma validação explícita do dashboard autenticado em 1920×1080.

Correção desta tranche:

- adicionar E2E determinístico para dashboard autenticado em 1920×1080 e 1366×768;
- preservar os cenários já existentes de tablet e mobile;
- nenhuma alteração em auth, RBAC, tenancy, APIs, schema, regra de negócio ou dados.

Critério de encerramento da PR #32:

- novo E2E verde;
- gates obrigatórios verdes;
- merge da tranche de reconciliação;
- Preview/Render no SHA exato;
- PR #32 encerrada como `SUPERSEDED_BY_CURRENT`, sem cherry-pick ou merge de código antigo.
