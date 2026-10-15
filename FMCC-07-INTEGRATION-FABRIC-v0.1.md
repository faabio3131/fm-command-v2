# FM CONTROL CENTER — F07 INTEGRATION FABRIC

**Status:** IMPLEMENTADA E TESTADA — GATE TÉCNICO VERDE NA PR #9  
**Baseline:** F06 certificada em Preview  
**Branch:** `feat/fmcc-f07-f10-intelligence-stack`  
**HEAD verificado:** `8d2fee2d4db989cabcc19e485dcf0eb6d0ad48f7`  
**CI:** FMCC Foundation Gate #82 — SUCCESS

## Objetivo
Implementar o boundary governado de integrações do FMCC sem acoplar domínio a providers.

## Current anterior
F06 possuía auth/tenant/audit/runtime, mas nenhum Source Registry, Connector Runtime ou canonical ingestion.

## Implementação comprovada
- Source Registry tenant-scoped;
- secret-by-reference e rejeição de segredo bruto em config;
- contratos de connector;
- runtime de pull com timeout, retry classificado, idempotência, cursor/checkpoint e erro normalizado;
- sync execution record;
- canonical facts com provenance;
- adapters PostgreSQL;
- API server-side de fontes sem exposição de secretRef;
- RBAC e tenant server-side;
- testes unitários, adversariais e de integração PostgreSQL;
- migration versionada e verificada no CI;
- observabilidade/correlation preservadas no boundary.

## Evidência de integração
A suíte PostgreSQL prova isolamento entre tenants, lifecycle de idempotência e o caminho governado F07 → F08 → F09 sobre o mesmo dado.

## Limites
Nenhum provider externo real é declarado integrado. Fixtures/fakes de testes são explicitamente não-produtivos.

## Gate
**F07 — APROVADA NO GATE TÉCNICO DA PR #9.**

A classificação não declara provider externo Live nem produção. O merge da missão permanece bloqueado pelo gate F09 descrito na documentação correspondente.
