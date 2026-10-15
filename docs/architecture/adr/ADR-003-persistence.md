# ADR-003 — Persistência e data platform inicial

**Status:** ACCEPTED  
**Data:** 18/09/2026  
**Autoridade:** FM Solution Architect / FM SaaS Tech Lead  
**Produto:** FM Control Center

## Contexto

O FMCC parte de um repositório essencialmente vazio e de um System Design já aprovado. A decisão deve preservar arquitetura única evolutiva, multi-tenancy, segurança by design, fronteiras explícitas, portabilidade e o princípio de que o Core não substitui autoridades determinísticas.

## CURRENT

Não existe implementação estrutural do FMCC na `main`. As capacidades existentes da Nova FM são heterogêneas. O Core mais maduro observado está no Kordena, em branch OPEN/DRAFT, e não constitui componente compartilhado de produção.

## Decisão

Adotar **PostgreSQL 18** como persistence primária e **Drizzle ORM** como camada tipada/migration tooling do FMCC. Usar node-postgres como driver. Manter schema relacional para identidade de domínio, sources, ingestão, métricas, proveniência e auditoria; JSONB somente para payload/metadata com justificativa.

## Justificativa

PostgreSQL oferece transações, constraints, índices, tipos ricos e portabilidade ampla. Drizzle mantém SQL visível, schemas TypeScript e migrations rastreáveis, coerente com a stack escolhida.

## Consequências

Positivas: integridade, maturidade, portabilidade e baixo acoplamento. Negativas: schema compartilhado exige disciplina de tenancy e migrations.

## Riscos e mitigação

Migration-only para DDL; constraints; índices tenant-first; backups/restore definidos antes de produção; sem push destrutivo. PMI de volume será reavaliado antes de sharding/warehouse separado.

## Segurança e dados

Toda implementação derivada deste ADR deve manter autorização server-side, escopo de tenant confiável, secrets fora do código e rastreabilidade suficiente para auditoria.

## Reversibilidade

A decisão deve permanecer reversível por contratos/boundaries e migrations controladas; substituição futura não autoriza arquitetura paralela.

## Condições de revisão

Revisar quando volume, SLA, custo, compliance, necessidade de segundo provider ou evidência operacional invalidarem as premissas atuais.

## Evidências / fontes consultadas

- PostgreSQL: https://www.postgresql.org/
- Drizzle migrations: https://orm.drizzle.team/docs/drizzle-kit-generate
- Drizzle PostgreSQL: https://orm.drizzle.team/docs/get-started-postgresql
