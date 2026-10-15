# ADR-001 — Distribuição e reuso do FM Cognitive Vertical Core

**Status:** SUPERSEDED by ADR-013  
**Data:** 18/09/2026  
**Autoridade:** FM Solution Architect / FM SaaS Tech Lead  
**Produto:** FM Control Center

## Contexto

O FMCC parte de um repositório essencialmente vazio e de um System Design já aprovado. A decisão deve preservar arquitetura única evolutiva, multi-tenancy, segurança by design, fronteiras explícitas, portabilidade e o princípio de que o Core não substitui autoridades determinísticas.

## CURRENT

Não existe implementação estrutural do FMCC na `main`. As capacidades existentes da Nova FM são heterogêneas. O Core mais maduro observado está no Kordena, em branch OPEN/DRAFT, e não constitui componente compartilhado de produção.

## Decisão

Adotar o Core canônico como **serviço interno versionado por API/contrato**, consumido futuramente por um Core Gateway do FMCC. O FMCC não copiará o Core do Kordena e não implementará um segundo Core. A integração funcional fica proibida até a F09.

## Justificativa

O Current mostra Core Python/Kordena com governança útil, porém acoplado à vertical. Um boundary de serviço permite linguagem/runtime independentes, autoridade central e evolução do Core sem forçar o FMCC a compartilhar código específico da vertical.

## Consequências

Positivas: autoridade única, menor risco de fork, desacoplamento tecnológico e evolução centralizada. Negativas: latência, disponibilidade distribuída e necessidade de versionamento de contrato.

## Riscos e mitigação

Mitigar com timeouts, health, versionamento, autenticação serviço-a-serviço, observabilidade e degradação segura. Dashboards/métricas determinísticos devem funcionar sem o Core.

## Segurança e dados

Toda implementação derivada deste ADR deve manter autorização server-side, escopo de tenant confiável, secrets fora do código e rastreabilidade suficiente para auditoria.

## Reversibilidade

A decisão deve permanecer reversível por contratos/boundaries e migrations controladas; substituição futura não autoriza arquitetura paralela.

## Condições de revisão

Revisar quando volume, SLA, custo, compliance, necessidade de segundo provider ou evidência operacional invalidarem as premissas atuais.



## Supersession — 20/09/2026

A premissa de um runtime cognitivo único compartilhado entre produtos foi revista após reconciliação com a natureza comercial independente do FM Control Center e com o requisito institucional de Vertical Core por produto. O histórico é preservado; novas implementações devem seguir o ADR-013.
