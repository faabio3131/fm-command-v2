# FM CONTROL CENTER — F08 DATA PLATFORM + METRIC ENGINE

**Status:** IMPLEMENTADA E TESTADA — GATE TÉCNICO VERDE NA PR #9  
**HEAD verificado:** `8d2fee2d4db989cabcc19e485dcf0eb6d0ad48f7`  
**CI:** FMCC Foundation Gate #82 — SUCCESS

## Objetivo
Materializar a autoridade determinística de métricas definida em F03/F04/F05.

## Implementação comprovada
- canonical facts;
- Metric Registry versionado em código;
- Metric Engine determinístico;
- MetricValue persistido;
- Metric Query Service;
- overview executivo baseado no mesmo serviço governado;
- provenance/freshness/quality;
- isolamento tenant no store PostgreSQL;
- missing permanece diferente de zero;
- valor inválido não vira zero;
- soma decimal sem erro de ponto flutuante binário;
- multi-moeda é recusada sem política FX;
- catálogo de alvos executivos distingue definição implementada de semântica pendente.

## Regras financeiras preservadas
`billing.gross_billed` não é `revenue.cash_collected`; receita não é lucro; nenhuma métrica de lucro é criada sem autoridade contábil; ADR-012 continua DEFERRED.

Métricas executivas ainda sem definição governada aparecem como `pending_semantics`, nunca como valor inventado.

## Evidências
- testes determinísticos para missing/zero/valor inválido;
- teste explícito de multi-moeda sem FX;
- isolamento PostgreSQL entre tenants;
- integração F07 → F08 → F09 sobre dado governado;
- migration/schema verificados;
- lint, typecheck, testes, build, Docker e audit verdes no Gate #82.

## Gate
**F08 — APROVADA NO GATE TÉCNICO DA PR #9.**

Não equivale a ingestão real de todas as fontes comerciais nem a Preview pós-merge.
