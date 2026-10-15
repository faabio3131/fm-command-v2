# ADR-012 — Política cambial e multi-moeda

**Status:** DEFERRED  
**Data:** 18/09/2026  
**Autoridade:** FM Solution Architect / FM SaaS Tech Lead  
**Produto:** FM Control Center

## Contexto

O FMCC parte de um repositório essencialmente vazio e de um System Design já aprovado. A decisão deve preservar arquitetura única evolutiva, multi-tenancy, segurança by design, fronteiras explícitas, portabilidade e o princípio de que o Core não substitui autoridades determinísticas.

## CURRENT

Não existe implementação estrutural do FMCC na `main`. As capacidades existentes da Nova FM são heterogêneas. O Core mais maduro observado está no Kordena, em branch OPEN/DRAFT, e não constitui componente compartilhado de produção.

## Decisão

Não converter moedas automaticamente. MetricValues financeiros permanecem por moeda. FX só será implementado após fonte de taxa, horário de referência, regra contábil e autoridade serem aprovados.

## Justificativa

F03 proíbe somar multi-moeda sem política FX. Ainda não há autoridade financeira/cambial comprovada.

## Consequências

Evita números financeiros falsos. Dashboards futuros deverão mostrar valores separados por moeda enquanto este ADR estiver deferred.

## Riscos e mitigação

Nenhuma estimativa de câmbio pelo Core poderá substituir cálculo determinístico autorizado.

## Segurança e dados

Toda implementação derivada deste ADR deve manter autorização server-side, escopo de tenant confiável, secrets fora do código e rastreabilidade suficiente para auditoria.

## Reversibilidade

A decisão deve permanecer reversível por contratos/boundaries e migrations controladas; substituição futura não autoriza arquitetura paralela.

## Condições de revisão

Revisar quando volume, SLA, custo, compliance, necessidade de segundo provider ou evidência operacional invalidarem as premissas atuais.

