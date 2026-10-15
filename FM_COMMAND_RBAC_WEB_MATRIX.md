# FM Command — RBAC / Web Matrix

Data: 2026-10-06
Baseline auditado: `main@370897af04fafe6729dd3f6f22e75337e32f3014`

## Papéis canônicos

- owner
- admin
- analyst
- viewer
- member

Papéis desconhecidos normalizam para `member`.

## Matriz de permissões

| Permission | Owner | Admin | Analyst | Viewer | Member |
|---|:---:|:---:|:---:|:---:|:---:|
| tenant:manage | ✓ | — | — | — | — |
| member:manage | ✓ | ✓ | — | — | — |
| source:read | ✓ | ✓ | ✓ | — | — |
| source:write | ✓ | ✓ | — | — | — |
| metric:read | ✓ | ✓ | ✓ | ✓ | ✓ |
| audit:read | ✓ | ✓ | ✓ | — | — |
| integration:read | ✓ | ✓ | ✓ | ✓ | ✓ |
| integration:write | ✓ | ✓ | — | — | — |
| product:read | ✓ | ✓ | ✓ | ✓ | ✓ |
| product:write | ✓ | ✓ | — | — | — |
| alert:read | ✓ | ✓ | ✓ | ✓ | ✓ |
| alert:write | ✓ | ✓ | — | — | — |
| action:prepare | ✓ | ✓ | ✓ | — | — |
| commercial:read | ✓ | ✓ | ✓ | ✓ | ✓ |
| commercial:write | ✓ | ✓ | — | — | — |
| billing:read | ✓ | ✓ | — | — | — |
| billing:write | ✓ | ✓ | — | — | — |
| receivable:read | ✓ | ✓ | — | — | — |
| search:use | ✓ | ✓ | ✓ | ✓ | ✓ |
| notification:use | ✓ | ✓ | ✓ | ✓ | ✓ |

## Navegação Web

| Superfície | Permission | Owner | Admin | Analyst | Viewer | Member |
|---|---|:---:|:---:|:---:|:---:|:---:|
| Visão Geral | metric:read | ✓ | ✓ | ✓ | ✓ | ✓ |
| Busca | search:use | ✓ | ✓ | ✓ | ✓ | ✓ |
| Notificações | notification:use | ✓ | ✓ | ✓ | ✓ | ✓ |
| Produtos | product:read | ✓ | ✓ | ✓ | ✓ | ✓ |
| Financeiro | metric:read | ✓ | ✓ | ✓ | ✓ | ✓ |
| Comercial/Growth | metric:read | ✓ | ✓ | ✓ | ✓ | ✓ |
| Trials | metric:read | ✓ | ✓ | ✓ | ✓ | ✓ |
| Assinaturas | metric:read | ✓ | ✓ | ✓ | ✓ | ✓ |
| Clientes | metric:read | ✓ | ✓ | ✓ | ✓ | ✓ |
| Operações | metric:read | ✓ | ✓ | ✓ | ✓ | ✓ |
| Incidentes | alert:read | ✓ | ✓ | ✓ | ✓ | ✓ |
| Atividades | audit:read | ✓ | ✓ | ✓ | — | — |
| Core | metric:read | ✓ | ✓ | ✓ | ✓ | ✓ |
| Kordena | commercial:read + tenant feature | ✓ | ✓ | ✓ | ✓ | ✓ |
| Fontes e Integrações | source:read | ✓ | ✓ | ✓ | — | — |
| Configurações | metric:read | ✓ | ✓ | ✓ | ✓ | ✓ |

## Subrotas sensíveis

### Billing

`/dashboard/products/[productId]/billing`

- leitura: owner/admin;
- escrita: owner/admin;
- guard server-side por `billing:read/write`.

### Recebimentos

`/dashboard/products/[productId]/receivables`

- leitura: owner/admin;
- guard server-side por `receivable:read`.

### Source Registry

`/dashboard/sources`

- leitura: owner/admin/analyst;
- escrita: owner/admin;
- viewer/member não recebem a entrada de administração;
- service também revalida `source:write`.

### Kordena Commercial

- leitura: todos os papéis autenticados que possuam `commercial:read`;
- mutação: apenas owner/admin;
- publicação de alto risco exige step-up de senha + approval server-side consumível uma única vez;
- viewer/member não recebem `source:read` por transitividade.

### Alertas

- leitura: todos;
- criação/avaliação/mutação de regra: owner/admin;
- preparação de ação: owner/admin/analyst;
- viewer/member não podem preparar ação nem mutar regra.

## Tenant boundary

- tenant deriva de sessão Better Auth;
- `X-Tenant-ID` não é autoridade;
- lookup é tenant-first;
- acesso direto a Product Cockpit de outro tenant retorna 404;
- repositories usam tenant_id nos acessos críticos.

## Evidência de teste

Cobertura atual inclui:

- `tests/security.unit.test.ts`;
- `tests/auth.integration.test.ts`;
- `tests/product-scope-db.integration.test.ts`;
- `tests/source-registry.unit.test.ts`;
- `tests/kca12-commercial-security.test.ts`;
- `tests/kca12-commercial-approval.integration.test.ts`;
- `tests/f19-adversarial.unit.test.ts`;
- `tests/f19-alert-tenant-isolation.integration.test.ts`;
- `e2e/fmcc-critical.spec.ts`.

## Veredito

```text
RBAC_WEB_MATRIX = PASS
DIRECT_URL_SERVER_GUARDS = PASS
CROSS_TENANT_PROTECTION = PASS
PRIVILEGE_ESCALATION_FINDING = 0
```
