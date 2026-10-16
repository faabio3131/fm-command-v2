# FM CONTROL CENTER — F14 OPERAÇÕES, SRE E INCIDENTES

**Fase:** F14 — 81% → 85%  
**Status inicial:** CURRENT DISCOVERY + SYSTEM DESIGN

## Current Discovery

Existe:
- `/api/health`;
- `/api/ready`;
- logger estruturado;
- sync executions com status, attempt, errorCode/errorMessage, correlationId e timestamps;
- connector health contract;
- source status;
- Audit Ledger/Core operational context.

Não existe:
- série histórica canônica de uptime;
- SLO/SLA aprovado;
- incident registry dedicado;
- provider externo de observabilidade;
- disponibilidade histórica suficiente para percentuais.

## Design

Facts governados suportados:
- `incident.opened`;
- `job.failed`;
- `integration.failed`;
- `service.error`.

Métricas:
- `incident.count`;
- `job.failure.count`;
- `integration.failure.count`;
- `service.error.count`.

`service.availability.rate` permanece pending_semantics até existir série temporal/denominador aprovado.

Nenhum `99.9%` pode ser fabricado.

O Core pode explicar/correlacionar fatos operacionais, mas não pode alterar infraestrutura.


## Fechamento técnico da fase

Implementação concluída na PR #12:
- incident count;
- job failure count;
- integration failure count;
- service error count;
- API/UI operacional governada;
- health/readiness tratados como sinais pontuais, nunca como uptime;
- availability/error rate/infra consumption permanecem `pending_semantics` onde não há denominador/série temporal.

Foundation Gate #211 — **SUCCESS** no SHA `bbe84f94d953825dd783a5a16a8c15d666deb315`, certificado por PR auxiliar #13 sem merge. O mesmo SHA recebeu Gate #212 — **SUCCESS** na PR #12.

**Estado:** implementação/CI PASS. Preview da tranche permanece evidência separada.
