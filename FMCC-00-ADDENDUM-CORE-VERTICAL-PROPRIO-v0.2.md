# FM COMMAND — ADDENDUM F00

**Identificador técnico/histórico:** FM Control Center / FMCC
**Domínio comercial oficial:** `fmcommand.com.br`
# OWNERSHIP DO FM COGNITIVE VERTICAL CORE

**Status:** DECISÃO FUNDACIONAL APROVADA
**Versão:** 0.2
**Data:** 20/09/2026
**Produto:** FM Command
**Natureza:** SaaS comercial independente
**Tenant Zero:** Nova FM Tecnologia

## 1. Motivo

A seção de reutilização do Documento 00 determinava descobrir o Current do Core existente antes de escolher o boundary de reutilização. Durante F05/F09, essa regra foi interpretada como obrigação de consumir um runtime cognitivo compartilhado hospedado em outro produto.

A reconciliação arquitetural identificou que essa interpretação conflita com a independência comercial do FM Command (FMCC) e com a exigência de um FM Cognitive Vertical Core como módulo principal de gestão operacional cognitiva do próprio produto.

## 2. Decisão

O FM Command possuirá **seu próprio FM Cognitive Vertical Core**, pertencente ao produto, ao seu repositório, ao seu lifecycle, aos seus tenants e à sua operação.

Isso significa:
- cérebro cognitivo vertical próprio;
- memória/contexto próprios e tenant-scoped;
- capabilities próprias do domínio de Control Center;
- release/deploy próprios;
- observabilidade e auditoria próprias;
- nenhuma dependência estrutural do runtime cognitivo de Kordena, IRON ou outro SaaS.

## 3. Reutilização permitida

A reutilização institucional do FM Cognitive Core será feita em nível de fundações reutilizáveis quando fizer sentido:
- contracts;
- padrões;
- primitives;
- adapters de modelos;
- guardrails;
- audit/observability helpers;
- segurança;
- avaliações.

Esses elementos podem ser compartilhados sem compartilhar memória, autoridade cognitiva vertical ou ciclo operacional entre produtos.

## 4. Verticalidade

O Core do FMCC deverá compreender e coordenar o domínio de gestão empresarial consolidada:
- métricas e KPIs;
- produtos/unidades;
- billing/trials/assinaturas;
- receitas/custos;
- infraestrutura;
- incidentes;
- suporte;
- leads;
- uso/engajamento;
- riscos;
- anomalias;
- recomendações;
- ações governadas.

## 5. Cognição

O Core não será um chatbot decorativo. Deve possuir capacidade real de:
- interpretar intenção;
- manter contexto operacional autorizado;
- planejar consultas;
- correlacionar múltiplos fatos;
- explicar indicadores;
- identificar padrões/anomalias;
- analisar risco;
- recomendar próximos passos;
- coordenar capabilities.

## 6. Autoridade

A cognição permanece separada da autoridade determinística:

Core → interpretação/análise/recomendação → capability governada → serviço determinístico → autorização/validação → execução → auditoria.

## 7. Efeito sobre decisões anteriores

- ADR-001 fica SUPERSEDED;
- ADR-013 passa a ser a decisão arquitetural vigente;
- F09 deve operar com Core vertical próprio do FMCC;
- qualquer referência a runtime obrigatório do `fm-ai-platform` como cérebro operacional do FMCC deixa de ser válida.

## 8. Preservação de histórico

Nenhuma decisão anterior é apagada. O histórico permanece para rastreabilidade, conforme governança institucional.
