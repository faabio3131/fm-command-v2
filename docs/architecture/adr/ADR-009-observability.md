# ADR-009 — Observabilidade inicial

**Status:** ACCEPTED  
**Data:** 18/09/2026  
**Autoridade:** FM Solution Architect / FM SaaS Tech Lead  
**Produto:** FM Control Center

## Contexto

O FMCC parte de um repositório essencialmente vazio e de um System Design já aprovado. A decisão deve preservar arquitetura única evolutiva, multi-tenancy, segurança by design, fronteiras explícitas, portabilidade e o princípio de que o Core não substitui autoridades determinísticas.

## CURRENT

Não existe implementação estrutural do FMCC na `main`. As capacidades existentes da Nova FM são heterogêneas. O Core mais maduro observado está no Kordena, em branch OPEN/DRAFT, e não constitui componente compartilhado de produção.

## Decisão

Implementar **structured JSON logs + correlation id + health/readiness + métricas de aplicação essenciais**. Criar boundary compatível com OpenTelemetry para futura exportação, mas **não escolher vendor de observabilidade** agora.

## Justificativa

O Current não demonstra necessidade de tracing/vendor dedicado, e F06 pede observabilidade básica. Adiar o vendor evita lock-in e custo sem evidência.

## Consequências

Positivas: diagnósticos desde o início e portabilidade. Negativas: menor profundidade até que um backend de observabilidade seja escolhido.

## Riscos e mitigação

Sanitização de PII/secrets; métricas apenas quando operacionalmente úteis; tracing será ativado quando complexidade justificar.

## Segurança e dados

Toda implementação derivada deste ADR deve manter autorização server-side, escopo de tenant confiável, secrets fora do código e rastreabilidade suficiente para auditoria.

## Reversibilidade

A decisão deve permanecer reversível por contratos/boundaries e migrations controladas; substituição futura não autoriza arquitetura paralela.

## Condições de revisão

Revisar quando volume, SLA, custo, compliance, necessidade de segundo provider ou evidência operacional invalidarem as premissas atuais.

