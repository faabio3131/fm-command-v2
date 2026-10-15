# FM CONTROL CENTER — F15 CLIENTES, USO E SUPORTE

**Fase:** F15 — 85% → 88%  
**Status inicial:** CURRENT DISCOVERY + SYSTEM DESIGN

## Current Discovery

Autoridades existentes:
- organização/tenant para cliente institucional;
- Better Auth para usuário/sessão;
- Product Registry para produto;
- canonical facts para eventos de origem externa.

Não existe:
- ticketing provider canônico;
- modelo de feedback;
- semântica de adoção aprovada;
- score de cliente em risco;
- fonte de eventos de uso já conectada.

## Design

Facts suportados quando provenientes de fonte autorizada:
- `usage.active_user.day`;
- `usage.engagement_event`;
- `support.ticket.opened`.

Métricas base:
- `usage.active_users.dau`;
- `usage.engagement.events`;
- `support.ticket.open.count`.

Permanecem pending_semantics:
- MAU;
- feature adoption rate;
- customer risk score;
- experience score.

Não haverá score mágico. A superfície apresenta sinais individuais e diferencia fato, ausência e semântica pendente.

PII não deve ser replicada no payload de métricas quando não necessária.


## Fechamento técnico da fase

Implementação concluída na PR #12:
- DAU governado por usuários distintos;
- eventos de engajamento;
- chamados de suporte abertos;
- API/UI agregada;
- Core usa apenas agregados governados;
- fatos brutos/PII não são expostos pela superfície de inteligência;
- MAU, adoção, risk score e experience score permanecem `pending_semantics`.

Foundation Gate #214 — **SUCCESS** no SHA `545114ce2379178eae05b06d3b2fb66765cf006e`.

Resultado automático do candidate:
- 31 test files PASS;
- 109 tests PASS;
- 0 FAIL;
- lint/typecheck/migrations/build/Docker/runtime audit verdes.

**Estado:** implementação/CI PASS. Preview do candidate da tranche ainda não foi comprovado.
