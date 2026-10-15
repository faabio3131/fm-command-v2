# ADR-007 — Cálculo e materialização de métricas

**Status:** ACCEPTED  
**Data:** 18/09/2026  
**Autoridade:** FM Solution Architect / FM SaaS Tech Lead  
**Produto:** FM Control Center

## Contexto

O FMCC parte de um repositório essencialmente vazio e de um System Design já aprovado. A decisão deve preservar arquitetura única evolutiva, multi-tenancy, segurança by design, fronteiras explícitas, portabilidade e o princípio de que o Core não substitui autoridades determinísticas.

## CURRENT

Não existe implementação estrutural do FMCC na `main`. As capacidades existentes da Nova FM são heterogêneas. O Core mais maduro observado está no Kordena, em branch OPEN/DRAFT, e não constitui componente compartilhado de produção.

## Decisão

Adotar **Metric Registry versionado + Metric Engine determinístico**. Definições ficam versionadas; cálculo crítico ocorre server-side. MetricValues podem ser materializados em PostgreSQL quando cobertura/fonte forem comprovadas, com `computed_at`, source timestamp, freshness, quality e provenance. Recompute é explícito e versionado.

## Justificativa

F03 exige semântica canônica e proíbe cálculo ad hoc do dashboard/Core.

## Consequências

Positivas: reprodutibilidade, auditabilidade e performance previsível. Negativas: materialização exige reconciliação e versionamento.

## Riscos e mitigação

Não materializar métrica com definição pendente; missing ≠ zero; moeda preservada; late data dispara recompute controlado.

## Segurança e dados

Toda implementação derivada deste ADR deve manter autorização server-side, escopo de tenant confiável, secrets fora do código e rastreabilidade suficiente para auditoria.

## Reversibilidade

A decisão deve permanecer reversível por contratos/boundaries e migrations controladas; substituição futura não autoriza arquitetura paralela.

## Condições de revisão

Revisar quando volume, SLA, custo, compliance, necessidade de segundo provider ou evidência operacional invalidarem as premissas atuais.

