# ADR-004 — Arquitetura de sincronização

**Status:** ACCEPTED  
**Data:** 18/09/2026  
**Autoridade:** FM Solution Architect / FM SaaS Tech Lead  
**Produto:** FM Control Center

## Contexto

O FMCC parte de um repositório essencialmente vazio e de um System Design já aprovado. A decisão deve preservar arquitetura única evolutiva, multi-tenancy, segurança by design, fronteiras explícitas, portabilidade e o princípio de que o Core não substitui autoridades determinísticas.

## CURRENT

Não existe implementação estrutural do FMCC na `main`. As capacidades existentes da Nova FM são heterogêneas. O Core mais maduro observado está no Kordena, em branch OPEN/DRAFT, e não constitui componente compartilhado de produção.

## Decisão

Adotar modelo **híbrido por connector**: pull incremental para fontes que expõem leitura/cursor e webhook/push assinado quando a fonte oferecer evento confiável. Cada connector declara seu modo, cursor/checkpoint, idempotência, timestamp da fonte, mapping version e health. Não criar event bus global obrigatório nesta fase.

## Justificativa

As fontes reais são heterogêneas e várias ainda não foram comprovadas. Forçar um único modo criaria abstração artificial.

## Consequências

Positivas: adaptação por provider e menor complexidade inicial. Negativas: runtime de integração precisa suportar mais de um padrão.

## Riscos e mitigação

Contrato comum + adapters; idempotência; replay protection; retries; reconciliação.

## Segurança e dados

Toda implementação derivada deste ADR deve manter autorização server-side, escopo de tenant confiável, secrets fora do código e rastreabilidade suficiente para auditoria.

## Reversibilidade

A decisão deve permanecer reversível por contratos/boundaries e migrations controladas; substituição futura não autoriza arquitetura paralela.

## Condições de revisão

Revisar quando volume, SLA, custo, compliance, necessidade de segundo provider ou evidência operacional invalidarem as premissas atuais.

