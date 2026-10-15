# ADR-010 — Identidade, autenticação e autorização

**Status:** ACCEPTED  
**Data:** 18/09/2026  
**Autoridade:** FM Solution Architect / FM SaaS Tech Lead  
**Produto:** FM Control Center

## Contexto

O FMCC parte de um repositório essencialmente vazio e de um System Design já aprovado. A decisão deve preservar arquitetura única evolutiva, multi-tenancy, segurança by design, fronteiras explícitas, portabilidade e o princípio de que o Core não substitui autoridades determinísticas.

## CURRENT

Não existe implementação estrutural do FMCC na `main`. As capacidades existentes da Nova FM são heterogêneas. O Core mais maduro observado está no Kordena, em branch OPEN/DRAFT, e não constitui componente compartilhado de produção.

## Decisão

Adotar **Better Auth 1.7.x** com PostgreSQL e plugin **Organization** como framework de identidade/sessão/membership. Organization ID é a raiz do tenant. Usar access control customizado para recursos FMCC e reforçar autorização em application services/server boundaries. ABAC fica adiado até requisito real. Não criar criptografia/sessão proprietária.

## Justificativa

Better Auth fornece autenticação, sessões, organizations e access control em TypeScript e permite manter dados sob a persistence escolhida. Evita reinventar auth e não impõe limite comercial externo por tenant do FMCC.

## Consequências

Positivas: framework maduro, extensível e alinhado à stack. Negativas: migrations/schema do framework tornam-se dependência de upgrade.

## Riscos e mitigação

Cookies seguros; CSRF/origin protections do framework; e-mail verification/SSO/2FA podem ser habilitados por requisito; autorizações críticas nunca dependem apenas do cliente.

## Segurança e dados

Toda implementação derivada deste ADR deve manter autorização server-side, escopo de tenant confiável, secrets fora do código e rastreabilidade suficiente para auditoria.

## Reversibilidade

A decisão deve permanecer reversível por contratos/boundaries e migrations controladas; substituição futura não autoriza arquitetura paralela.

## Condições de revisão

Revisar quando volume, SLA, custo, compliance, necessidade de segundo provider ou evidência operacional invalidarem as premissas atuais.

## Evidências / fontes consultadas

- https://better-auth.com/docs/introduction
- https://better-auth.com/docs/plugins/organization
- https://better-auth.com/docs/adapters/drizzle
