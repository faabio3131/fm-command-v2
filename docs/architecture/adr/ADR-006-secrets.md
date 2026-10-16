# ADR-006 — Gestão de secrets

**Status:** ACCEPTED  
**Data:** 18/09/2026  
**Autoridade:** FM Solution Architect / FM SaaS Tech Lead  
**Produto:** FM Control Center

## Contexto

O FMCC parte de um repositório essencialmente vazio e de um System Design já aprovado. A decisão deve preservar arquitetura única evolutiva, multi-tenancy, segurança by design, fronteiras explícitas, portabilidade e o princípio de que o Core não substitui autoridades determinísticas.

## CURRENT

Não existe implementação estrutural do FMCC na `main`. As capacidades existentes da Nova FM são heterogêneas. O Core mais maduro observado está no Kordena, em branch OPEN/DRAFT, e não constitui componente compartilhado de produção.

## Decisão

Adotar **secret-by-reference**. Código e banco armazenam somente nomes/referências; valores ficam no secret/environment store do runtime autorizado. No target Render inicial, secrets são configurados no ambiente da plataforma. Nunca retornar secrets ao frontend, logs, Core ou documentação.

## Justificativa

Reaproveita o padrão já observado no Core Kordena sem acoplar o FMCC à implementação do Kordena e atende fail-closed.

## Consequências

Positivas: rotação independente do código e menor exposição. Negativas: exige disciplina operacional e ambientes corretamente configurados.

## Riscos e mitigação

Validação de configuração; masking; testes de ausência; nenhuma credencial em fixtures versionadas.

## Segurança e dados

Toda implementação derivada deste ADR deve manter autorização server-side, escopo de tenant confiável, secrets fora do código e rastreabilidade suficiente para auditoria.

## Reversibilidade

A decisão deve permanecer reversível por contratos/boundaries e migrations controladas; substituição futura não autoriza arquitetura paralela.

## Condições de revisão

Revisar quando volume, SLA, custo, compliance, necessidade de segundo provider ou evidência operacional invalidarem as premissas atuais.

