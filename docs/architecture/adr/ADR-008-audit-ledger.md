# ADR-008 — Audit ledger

**Status:** ACCEPTED  
**Data:** 18/09/2026  
**Autoridade:** FM Solution Architect / FM SaaS Tech Lead  
**Produto:** FM Control Center

## Contexto

O FMCC parte de um repositório essencialmente vazio e de um System Design já aprovado. A decisão deve preservar arquitetura única evolutiva, multi-tenancy, segurança by design, fronteiras explícitas, portabilidade e o princípio de que o Core não substitui autoridades determinísticas.

## CURRENT

Não existe implementação estrutural do FMCC na `main`. As capacidades existentes da Nova FM são heterogêneas. O Core mais maduro observado está no Kordena, em branch OPEN/DRAFT, e não constitui componente compartilhado de produção.

## Decisão

Manter **audit ledger append-only lógico em PostgreSQL**, tenant-scoped, com actor/service identity, action, resource, result, correlation id, timestamp e metadata sanitizada. A aplicação não oferece update/delete ordinário do ledger. Política final de retenção deve ser aprovada antes de produção.

## Justificativa

Fornece trilha determinística sem introduzir uma segunda tecnologia de storage prematuramente.

## Consequências

Positivas: consulta simples, integridade transacional e rastreabilidade. Negativas: crescimento contínuo e necessidade futura de arquivamento.

## Riscos e mitigação

Índices por tenant/tempo; metadata sem secret/PII desnecessária; futuras rotinas de retenção somente por política autorizada.

## Segurança e dados

Toda implementação derivada deste ADR deve manter autorização server-side, escopo de tenant confiável, secrets fora do código e rastreabilidade suficiente para auditoria.

## Reversibilidade

A decisão deve permanecer reversível por contratos/boundaries e migrations controladas; substituição futura não autoriza arquitetura paralela.

## Condições de revisão

Revisar quando volume, SLA, custo, compliance, necessidade de segundo provider ou evidência operacional invalidarem as premissas atuais.

