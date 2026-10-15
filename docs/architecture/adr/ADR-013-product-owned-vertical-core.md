# ADR-013 — Product-Owned FM Cognitive Vertical Core

**Status:** ACCEPTED  
**Data:** 20/09/2026  
**Supersedes:** ADR-001  
**Autoridade:** FM Solution Architect / direção do produto  
**Produto:** FM Control Center

## Contexto

O FM Control Center é um SaaS comercial independente, multi-tenant, cuja Nova FM Tecnologia é Tenant Zero. A Fundação do produto exige que o FM Cognitive Vertical Core seja componente estrutural do próprio Control Center, preservando cognição vertical, contexto operacional e evolução comercial sem dependência estrutural de outro SaaS.

O ADR-001 interpretou o princípio de reutilização como runtime cognitivo compartilhado por API a partir do `fm-ai-platform`. A revisão arquitetural mostrou que isso acoplaria lifecycle, disponibilidade, evolução cognitiva e operação do FMCC a outro produto.

## Decisão

O FM Control Center possuirá um **FM Cognitive Vertical Core próprio do produto**, versionado, testado, implantado e evoluído no repositório e lifecycle do FMCC.

O Core próprio:
- pertence ao domínio e release do FM Control Center;
- mantém contexto e memória tenant-scoped do FMCC;
- coordena capabilities próprias do Control Center;
- usa Metric Engine e demais serviços determinísticos como autoridades factuais;
- pode consumir modelos externos por adapters de infraestrutura;
- não depende do runtime cognitivo do Kordena ou de qualquer outro SaaS;
- não importa regras, memória, tenant state ou ciclo de release de outro produto.

## Relação com o Documento Mestre e exceção formal

O Documento Mestre v2.0 usa a formulação **CORE COGNITIVO COMPARTILHADO + CAPACIDADES ESPECÍFICAS DO PRODUTO/VERTICAL**.

Para o FM Control Center, a direção do produto aprovou uma exceção arquitetural explícita à interpretação de "compartilhado" como runtime operacional único entre SaaS.

A necessidade é comercial e arquitetural:
- o FMCC é produto SaaS independente;
- precisa de lifecycle, memória, contexto, SLA e evolução cognitiva próprios;
- não pode depender operacionalmente de Kordena/IRON ou de outro produto para funcionar;
- o Tenant Zero e clientes externos devem executar a mesma arquitetura.

A compatibilidade institucional será preservada por uma **FM Cognitive Foundation reutilizável**, formada por primitives, contratos, padrões e adapters comuns. Essa fundação pode ser compartilhada; o cérebro operacional vertical permanece product-owned.

Esta exceção está registrada também em `docs/architecture/EXCEPTION-001-product-owned-vertical-core.md`.

## Reutilização institucional

O reaproveitamento de capacidades cognitivas comuns será atendido por **primitives, contratos, padrões, bibliotecas e adapters reutilizáveis**, quando apropriado, e não por compartilhamento obrigatório do cérebro operacional de produtos diferentes.

Reutilização permitida:
- contracts de model provider;
- adapters genéricos;
- padrões de tool/capability calling;
- observabilidade;
- segurança;
- audit primitives;
- utilitários de memória;
- avaliação e guardrails.

Não reutilizar como autoridade operacional:
- memória de outro produto;
- regras de domínio de outro vertical;
- tenant state de outro SaaS;
- workflow cognitivo específico do Kordena;
- serviço que torne o FMCC indisponível por dependência de outro produto.

## Arquitetura

```text
FM Control Center
  ├─ Identity/Tenant
  ├─ Integration Fabric
  ├─ Data Platform
  ├─ Metric Registry + Metric Engine
  ├─ FMCC Cognitive Vertical Core
  │    ├─ intention/context
  │    ├─ metric planning
  │    ├─ multi-metric reasoning
  │    ├─ explanation
  │    ├─ anomaly/risk analysis
  │    ├─ recommendations
  │    └─ capability coordination
  ├─ Governed Action Orchestrator
  └─ Audit/Observability

FMCC Cognitive Vertical Core
  └─ Model Adapter(s) -> external model provider(s)
```

## Autoridade

Core/IA → intenção/análise/recomendação → capability governada → serviço determinístico → validação/autorização → execução → auditoria.

O Core não pode:
- inventar métricas;
- substituir Metric Engine;
- escolher tenant;
- elevar privilégio;
- executar ação crítica diretamente;
- tratar memória conversacional como fonte de verdade;
- somar moedas sem política aprovada.

## Multi-tenancy

Memória/contexto, tools, evidence e respostas são tenant-scoped. Cross-tenant é STOP condition.

## Segurança

Secrets de provider permanecem somente em secret/environment store. Nenhum segredo em Git, frontend, prompt persistido ou log. Falta de provider/configuração cognitiva degrada de forma segura.

## Deploy

O Core faz parte da aplicação comercial FMCC. Pode permanecer modular monolith na V1 e ser separado em processo/serviço próprio apenas quando escala, isolamento ou operação justificarem novo ADR.

## Consequências

Positivas:
- independência comercial;
- cognição vertical real;
- release/deploy próprios;
- isolamento de contexto;
- evolução do cérebro junto ao produto;
- menor acoplamento entre SaaS.

Custos:
- cada produto precisa evoluir suas capacidades verticais;
- primitives reutilizáveis exigem governança para evitar cópia divergente.

## Reversibilidade

Boundaries de model provider e capabilities permanecem explícitos, permitindo futura extração de componentes genéricos sem mover a autoridade cognitiva vertical para outro produto.
