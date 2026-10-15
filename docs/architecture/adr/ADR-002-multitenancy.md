# ADR-002 — Estratégia de isolamento multi-tenant

**Status:** ACCEPTED  
**Data:** 18/09/2026  
**Autoridade:** FM Solution Architect / FM SaaS Tech Lead  
**Produto:** FM Control Center

## Contexto

O FMCC parte de um repositório essencialmente vazio e de um System Design já aprovado. A decisão deve preservar arquitetura única evolutiva, multi-tenancy, segurança by design, fronteiras explícitas, portabilidade e o princípio de que o Core não substitui autoridades determinísticas.

## CURRENT

Não existe implementação estrutural do FMCC na `main`. As capacidades existentes da Nova FM são heterogêneas. O Core mais maduro observado está no Kordena, em branch OPEN/DRAFT, e não constitui componente compartilhado de produção.

## Decisão

Usar **shared schema com tenant lógico explícito**. A organização autenticada é a autoridade de tenant. Toda tabela FMCC pertencente a cliente deve possuir `tenant_id NOT NULL`; repositories/use-cases recebem um `TenantContext` derivado de sessão confiável. Nunca aceitar header livre como autoridade. Aplicar constraints/índices compostos e testes adversariais. RLS PostgreSQL será defesa em profundidade para tabelas críticas quando a estratégia de conexão transacional estiver comprovada, sem substituir os controles da aplicação.

## Justificativa

É a menor arquitetura coerente para início multi-tenant, reduz custo operacional e mantém caminho para isolamento físico posterior em clientes/regulações que exijam.

## Consequências

Positivas: simplicidade, uma linha de migrations e operação econômica. Negativas: erro de escopo pode ter impacto alto se controles forem dispersos.

## Riscos e mitigação

Centralizar TenantContext; negar ausência de tenant; revisar queries; testes cross-tenant; constraints; auditoria de tentativas negadas.

## Segurança e dados

Toda implementação derivada deste ADR deve manter autorização server-side, escopo de tenant confiável, secrets fora do código e rastreabilidade suficiente para auditoria.

## Reversibilidade

A decisão deve permanecer reversível por contratos/boundaries e migrations controladas; substituição futura não autoriza arquitetura paralela.

## Condições de revisão

Revisar quando volume, SLA, custo, compliance, necessidade de segundo provider ou evidência operacional invalidarem as premissas atuais.

