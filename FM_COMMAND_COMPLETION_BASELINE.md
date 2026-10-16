# FM Command — Completion Baseline

Data: 2026-10-06

## Natureza desta baseline

Este arquivo congela o estado de entrada da auditoria pós-fix final. Ele não pretende reescrever o baseline histórico anterior às correções já executadas.

## Repositório e CURRENT

- Repositório: `faabio3131/FM-CONTROL-CENTER`
- Branch canônica: `main`
- SHA auditado: `370897af04fafe6729dd3f6f22e75337e32f3014`
- PRs abertas após reconciliação: 0
- Proteção de `main`: habilitada
- Checks obrigatórios: `foundation`, `readiness`
- Required status checks: strict
- Force-push: bloqueado
- Exclusão da branch: bloqueada

PRs históricas #33, #34, #35, #36, #37 e #41 foram reconciliadas com o CURRENT e encerradas como `SUPERSEDED_BY_CURRENT`.

## Preview / runtime

- Serviço: `fmcc-preview-web`
- Provedor: Render
- URL: `https://fmcc-preview-web.onrender.com`
- Deploy certificado: `dep-db2hbbc9v7es73c64jpg`
- Deploy status: `live`
- Deploy SHA: `370897af04fafe6729dd3f6f22e75337e32f3014`
- `/api/version`: SHA exato acima, branch `main`
- `/api/health`: `ok`
- `/api/ready`: `ready`
- `/sign-in`: HTTP 200
- `/dashboard` anônimo: HTTP 307 -> `/sign-in`
- `/onboarding` anônimo: HTTP 307 -> `/sign-in`

## Gates pós-merge do SHA auditado

- FMCC Foundation Gate: SUCCESS
- FMCC F21 Operational Readiness Gate: SUCCESS
- FMCC Preview Deployment Gate: SUCCESS

Runs:

- Foundation: `37489038152`
- F21 Readiness: `37489037972`
- Preview: `37489038344`

## PostgreSQL real — auditoria read-only

Instância: Render PostgreSQL do FM Command.

- migrations Drizzle aplicadas: 4
- tabela de migrations: `drizzle.__drizzle_migrations`
- tenant auditado: `Nova FM Tecnologia`
- memberships: 1
- sessões ativas observadas: 10
- produtos: 4
- sources: 1
- sync executions: 25
- canonical facts: 0
- metric values: 0
- audit events: 14
- monitored services: 0
- health observations: 0

Nenhuma senha, token, cookie, PII ou secret foi impresso.

Índices/constraints relevantes confirmados:

- `fmcc_product_tenant_slug_uq`
- `fmcc_source_tenant_name_uq`
- `fmcc_sync_tenant_idempotency_uq`
- `fmcc_fact_dedupe_uq`
- índices tenant-first para facts, métricas, source, sync e audit.

## Portfólio do tenant Nova FM

- Kordena — ativo
- IRON — ativo
- CampaIA — ativo
- NFCore — ativo

### Kordena

- source: `Kordena Commercial`
- source type: `kordena-commercial-v1`
- source status: `healthy`
- último sync observado: `completed`
- último sync iniciado: `2026-10-06T15:39:25.488301Z`
- último sync concluído: `2026-10-06T15:39:26.938Z`
- error_code: null
- canonical facts: 0
- metric values: 0

Dataset vazio é estado factual válido; não é convertido em zero de negócio.

### IRON / CampaIA / NFCore

Produtos ativos no Registry, porém sem source registrada no Command. Nenhum deles é classificado como conectado sem contrato, connector, runtime, health, sync e provenance verificáveis.

## Scheduler

Último run agendado observado antes desta baseline:

- workflow: `FMCC Governed Alert Automation`
- run: `37448909910`
- trigger: schedule
- conclusion: SUCCESS
- `Validate runtime configuration`: SUCCESS
- `Evaluate governed alert rules`: SUCCESS

## Baseline de segurança

Cobertura vigente inclui:

- auth e sessão;
- tenant derivado server-side;
- rejeição de autoridade via `X-Tenant-ID`;
- cross-tenant;
- RBAC;
- Source Registry secret-by-reference;
- Kordena commercial read/write;
- step-up por senha;
- approval lifecycle;
- approval one-time/replay protection;
- audit;
- idempotência;
- Core fail-closed;
- browser E2E;
- runtime smoke;
- secret scan;
- dependency audit.

## Blockers conhecidos na entrada da auditoria pós-fix

Somente blockers externos/decisórios conhecidos:

- 8 semânticas executivas pendentes;
- IRON source/connector;
- CampaIA runtime/source/connector;
- NFCore CURRENT reconciliado + source/connector;
- providers corporativos ainda não definidos para algumas autoridades;
- política formal corporativa de data classification.

Nenhum blocker interno foi aceito como resolvido apenas por documentação.
