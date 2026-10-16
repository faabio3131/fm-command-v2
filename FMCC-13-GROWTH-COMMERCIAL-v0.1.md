# FM CONTROL CENTER — F13 GROWTH / COMERCIAL

**Fase:** F13 — 77% → 81%  
**Status inicial:** CURRENT DISCOVERY + SYSTEM DESIGN

## Current Discovery

Existe:
- `trial.started` e `trial.starts.count`;
- Product Registry;
- canonical facts genéricos;
- Metric Engine;
- product scope.

Não existe no repositório:
- CRM canônico;
- HubSpot/Meta/Google/Cakto como autoridade;
- UTM/attribution contract aprovado;
- lead source provider;
- conversão trial→assinatura com definição de coorte;
- CAC calculável.

## Design

Novo fact suportado:
- `lead.created` para contagem de leads, somente quando fonte autorizada o emitir.

Nova métrica base:
- `lead.created.count`.

Permanecem pending_semantics:
- `trial.conversion.rate`;
- `acquisition.cac`;
- atribuição por canal;
- funil multiestágio que não possua eventos canônicos.

A visão Growth consulta métricas governadas por tenant/produto e sempre expõe provenance, período, quality e freshness.

O Core pode explicar métricas existentes, mas não inventar atribuição ou conversão.


## Fechamento técnico da fase

Implementação concluída na PR #12:
- métrica governada `lead.created.count` sobre fact `lead.created`;
- visão Growth tenant/product-scoped;
- API e UI dedicadas;
- trial starts preservado como métrica factual existente;
- conversão, CAC e atribuição permanecem `pending_semantics` sem fabricação.

Foundation Gate #210 — **SUCCESS** no SHA `3fda942e6d898f6445f0ae4317c5e8ba38913c9b`.

**Estado:** implementação/CI PASS. Preview da tranche permanece evidência separada.
