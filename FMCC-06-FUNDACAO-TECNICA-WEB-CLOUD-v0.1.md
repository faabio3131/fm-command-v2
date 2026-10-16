# FM CONTROL CENTER
# FASE 06 — FUNDAÇÃO TÉCNICA WEB/CLOUD

**Status:** CONCLUÍDA E CERTIFICADA EM PREVIEW  
**Versão:** 0.2  
**Data original:** 18/09/2026  
**Data de fechamento:** 19/09/2026 (BRT)  
**Gate:** F06 — APROVADO PARA AVANÇO À F07

---

## 1. IDENTIFICAÇÃO

- Repositório: `faabio3131/FM-CONTROL-CENTER`
- Branch principal certificada: `main`
- HEAD funcional implantado em Preview: `0c8c0f4917aceeae3b81202344e98e5d17aaca40`
- Base histórica inicial da F06: `f68cef6bb527631b2d0e440e3af715ee42e0cec7`
- Candidate técnico inicial: `bfa84346237164fbd084c92da7c98eae73819fa4`
- Candidate com migration versionada: `bc0753c179eb65a87332cd2aafde9d740adba944`
- Ambiente certificado: Render / projeto `FM CONTROL CENTER` / environment `Preview`
- Web Service: `fmcc-preview-web`
- PostgreSQL: `fmcc-preview-postgres`
- Região: Virginia (US East)
- Produção: não utilizada

## 2. STACK REAL IMPLEMENTADA

- Node.js 24 LTS
- Next.js 16.3.x
- React 19.2.x
- TypeScript
- PostgreSQL 18
- Drizzle ORM / Drizzle Kit
- Better Auth + Organization
- GitHub Actions
- Docker/container-compatible
- Render como runtime cloud inicial conforme ADR-005

## 3. ESTRUTURA FUNDACIONAL CERTIFICADA

Implementado e validado no escopo da F06:
- application shell Web;
- fronteira de autenticação;
- organizações/tenants;
- memberships;
- RBAC fundacional;
- TenantContext server-side;
- PostgreSQL/Drizzle;
- migration versionada;
- startup migration governada em Preview;
- audit foundation;
- configuração externa;
- health/readiness;
- structured logging;
- correlation id;
- CI;
- Dockerfile;
- login/cadastro;
- onboarding de organização;
- entrada em organização existente;
- restauração automática do único tenant após re-login;
- logout;
- dashboard shell;
- fundação visual responsiva;
- validação de slug compatível com browser moderno;
- metadata de autocomplete sem issue no DevTools.

Não implementado nesta fase:
- dashboard executivo completo;
- Core funcional;
- connectors reais;
- Metric Engine completo;
- automações de negócio.

## 4. AUTH E TENANCY

A autoridade de tenant é a organização ativa da sessão autenticada e sua membership válida.

Confirmado por teste automatizado e smoke real:
- sessão validada server-side;
- membership validada server-side;
- ausência de sessão/tenant válido falha fechado;
- `X-Tenant-ID` não é autoridade;
- usuário com exatamente uma organização retorna ao mesmo tenant após logout/re-login;
- usuário com organização existente pode selecioná-la no onboarding quando necessário;
- dois usuários/organizações reais geraram tenant IDs distintos;
- tentativa manual de forçar o tenant da Nova FM via `X-Tenant-ID` usando sessão de outro tenant foi ignorada; a API manteve o tenant da sessão autenticada;
- RBAC fundacional permaneceu server-side.

## 5. PERSISTÊNCIA E MIGRATIONS

A migration fundacional foi:
- gerada a partir do schema Drizzle;
- versionada no repositório;
- validada em PostgreSQL 18 no CI;
- aplicada no PostgreSQL real do ambiente Preview.

No deploy certificado, o runtime registrou:
- `database_migration_started`;
- `database_migration_completed`;
- serviço posteriormente `Live`.

## 6. CONFIGURAÇÃO E SECRETS

Secrets permanecem fora do repositório.

Variáveis runtime utilizadas:
- `DATABASE_URL`;
- `BETTER_AUTH_URL`;
- `BETTER_AUTH_SECRET`;
- `RUN_MIGRATIONS_ON_STARTUP` no fluxo governado de Preview.

A conexão real do Web Service usa a Internal Database URL do PostgreSQL no mesmo ambiente/região.

Nenhum secret foi registrado nesta documentação.

## 7. OBSERVABILIDADE E ENDPOINTS

Implementado:
- structured JSON logging;
- sanitização de campos sensíveis;
- correlation id;
- audit foundation;
- `/api/health`;
- `/api/ready`.

Smoke real:
- `/api/health` -> `{"service":"fm-control-center","status":"ok"}`;
- `/api/ready` -> `{"status":"ready"}`.

Vendor dedicado de observabilidade permanece deferred conforme ADR-009.

## 8. CI / TESTES

Workflow: `FMCC Foundation Gate`.

Gates relevantes do fechamento:
- Run #7 — logout: SUCCESS;
- Run #10 — restauração de tenant/onboarding: SUCCESS;
- Run #11 — correção de pattern/slug: SUCCESS;
- Run #13 — autocomplete + normalização tipográfica: SUCCESS.

No Run #13, HEAD técnico testado `a3b860d76fea73fb431622d24c72282b933a55d4`:
- Install — SUCCESS
- Lint — SUCCESS
- Typecheck — SUCCESS
- Verify migration matches schema — SUCCESS
- Apply versioned migration — SUCCESS
- Tests — SUCCESS
- Build — SUCCESS
- Build Docker image without runtime secrets — SUCCESS
- Runtime dependency audit — SUCCESS

A PR correspondente foi squash-mergeada na `main` como `0c8c0f4917aceeae3b81202344e98e5d17aaca40`.

## 9. DEPLOY NÃO PRODUTIVO — EVIDÊNCIA REAL

Executado no Render Preview:
- Web Service `fmcc-preview-web` — Live;
- PostgreSQL `fmcc-preview-postgres` — Available;
- ambos na região Virginia (US East);
- deploy automático do HEAD `0c8c0f4...` concluído com sucesso;
- migrations reais concluídas;
- aplicação pública acessível;
- health e readiness verdes;
- cadastro/login funcionais;
- organização criada e recuperada;
- logout/re-login funcionais;
- seleção de organização existente funcional;
- smoke manual multi-tenant concluído;
- DevTools final sem erros no Console e com `No issues`.

## 10. CORREÇÕES ENCONTRADAS DURANTE O SMOKE

O fechamento da F06 identificou e corrigiu antes da certificação:
1. `DATABASE_URL` inicialmente inválida no Render, causando `getaddrinfo ENOTFOUND base`;
2. `BETTER_AUTH_URL` ajustada para a URL pública real do Preview;
3. suporte a migrations governadas no startup de Preview;
4. ausência de logout;
5. nova sessão sem `activeOrganizationId` após re-login;
6. onboarding sem opção de entrar em organização existente;
7. pattern HTML de slug incompatível com semântica moderna `v`;
8. aviso de autocomplete em DevTools;
9. hierarquia tipográfica do onboarding normalizada.

Todas foram corrigidas, testadas e redeployadas antes deste fechamento.

## 11. SEGURANÇA

Confirmado no escopo F06:
- autorização server-side;
- TenantContext confiável;
- membership server-side;
- header arbitrário não amplia escopo;
- isolamento entre dois tenants reais no Preview;
- tentativa manual de spoofing cross-tenant sem efeito;
- secrets fora do código/documentação;
- configuração fail-closed;
- logs com sanitização;
- dependency audit verde.

## 12. CLASSIFICAÇÃO DO GATE

[x] projeto compila/builda  
[x] lint verde  
[x] typecheck verde  
[x] testes fundacionais verdes  
[x] auth funciona em Preview real  
[x] logout/re-login validado  
[x] autorização server-side  
[x] tenant isolation automatizado e manual  
[x] spoofing de `X-Tenant-ID` bloqueado/ignorado  
[x] migration baseline funciona  
[x] migration aplicada no banco Preview real  
[x] secrets fora do código  
[x] CI verde  
[x] observabilidade básica  
[x] `/api/health` verde  
[x] `/api/ready` verde  
[x] deploy não produtivo real concluído  
[x] smoke real concluído  
[x] DevTools sem erro/issue no fechamento  
[x] nenhum deploy de produção  
[x] documentação atualizada

# GATE F06 — APROVADO

A F06 está **CONCLUÍDA E CERTIFICADA NO AMBIENTE PREVIEW**.

Esta certificação:
- não equivale a homologação de produção;
- não autoriza deploy de produção;
- não antecipa F08/F09;
- remove o bloqueio que impedia o início da F07.

**F07 — Integration Fabric está formalmente liberada para início, respeitando o Plano Mestre e os gates subsequentes.**
