# FM Command — Metric Semantics Status

Data: 2026-10-06
Baseline auditado: `main@370897af04fafe6729dd3f6f22e75337e32f3014`

## Autoridade

- Registry: `src/domain/metrics/registry.ts`
- Engine: Metric Engine determinístico
- Regra: missing != zero
- FX automático: proibido sem política canônica
- Métrica pendente não pode ser materializada como implementada

## Estado do catálogo executivo

Total de targets executivos: 24

- `implemented`: 16
- `pending_semantics`: 8

### Implementadas

- `trial.starts.count`
- `subscription.active.count`
- `subscription.cancelled.count`
- `billing.gross_billed`
- `revenue.cash_collected`
- `receivable.delinquent_amount`
- `cost.infrastructure.total`
- `cost.operating.total`
- `lead.created.count`
- `incident.count`
- `job.failure.count`
- `integration.failure.count`
- `service.error.count`
- `usage.active_users.dau`
- `usage.engagement.events`
- `support.ticket.open.count`

### Semântica pendente

| Métrica | Estado | Bloqueio |
|---|---|---|
| `trial.active.count` | pending_semantics | aprovação corporativa da definição de trial ativo |
| `trial.conversion.rate` | pending_semantics | aprovação de coorte/janela/denominador |
| `subscription.logo_churn.rate` | pending_semantics | aprovação da definição corporativa de churn |
| `revenue.mrr` | pending_semantics | autoridade financeira + elegibilidade contratual |
| `revenue.arr` | pending_semantics | regra canônica de anualização/elegibilidade |
| `finance.operating_result` | pending_semantics | autoridade contábil + fórmula |
| `finance.operating_margin.rate` | pending_semantics | numerador/denominador corporativos |
| `service.error.rate` | pending_semantics | denominador, janela e autoridade de observabilidade |

## Evidência candidata Kordena

Kordena oferece semânticas candidatas para parte das métricas acima, mas isso não as transforma em contrato corporativo universal.

Candidatas existentes:

- trial ativo;
- conversão rolling 30d;
- gross logo churn 30d;
- MRR contratual por moeda;
- ARR contratual por moeda.

Essas definições permanecem evidência de produto, não aprovação corporativa.

## Estado de dados do tenant Nova FM

Na auditoria PostgreSQL final:

- canonical facts: 0
- metric values: 0

Isso é coerente com o último snapshot Kordena elegível vazio.

O Command não materializou zeros para preencher dashboards.

## Gate

```text
IMPLEMENTED_METRICS = 16
PENDING_SEMANTICS = 8
FALSE_PROMOTIONS = 0
MISSING_TO_ZERO = 0
FX_IMPLICIT = 0
SEMANTIC_STATUS = EXTERNAL_BLOCKED / BUSINESS_SEMANTICS_REQUIRED
```
