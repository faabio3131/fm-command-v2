# FM COMMAND
# FMCC-04 — TARGET + SYSTEM DESIGN

**Identidade comercial oficial:** FM Command
**Identificador técnico/histórico preservado:** FM Control Center / FMCC
**Domínio oficial:** `fmcommand.com.br`

**Status:** TARGET ARQUITETURAL v0.2 — RECONCILIADO
**Versão:** 0.2
**Data:** 20/09/2026
**Supersedes:** v0.1 no tema de ownership/distribuição do Core
**Natureza:** System Design Target

## 1. Princípio central

O **FM Command** é o SaaS comercial independente anteriormente identificado tecnicamente como **FM Control Center (FMCC)** e possui um **FM Cognitive Vertical Core próprio do produto**.

O Core pertence à arquitetura do FMCC. Não depende do runtime cognitivo de outro SaaS para existir, operar ou evoluir.

## 2. Arquitetura Target

1. Product Shell / Experience
2. Identity & Tenant Control Plane
3. Application / Domain
4. Source & Connector Control Plane
5. Ingestion / Sync Fabric
6. Canonical Data / Read Models
7. Metric Registry + Metric Engine
8. Query & Provenance Services
9. **FMCC Cognitive Vertical Core**
10. Governed Action Orchestrator
11. Audit / Observability
12. Runtime / Platform

Nenhuma camada implica microservice separado.

## 3. Cognitive Boundary

O FMCC Cognitive Vertical Core:
- pertence ao produto;
- recebe TenantContext autoritativo;
- consulta apenas capabilities autorizadas;
- usa Metric Query e demais serviços determinísticos como fonte factual;
- mantém contexto operacional tenant/user scoped;
- não acessa DB arbitrariamente;
- não executa operação crítica diretamente;
- usa model providers apenas como infraestrutura de cognição.

## 4. Verticalidade

O Core é especializado em inteligência executiva e operacional empresarial:
- KPIs;
- billing/trials/assinaturas;
- custos/receita;
- produtos/unidades;
- infraestrutura;
- incidentes;
- suporte;
- leads;
- engajamento;
- correlação;
- anomalias;
- risco;
- recomendações.

## 5. Cognição

Pipeline cognitivo Target:

intenção do usuário
→ contexto operacional autorizado
→ planejamento cognitivo
→ seleção de capabilities
→ consulta a autoridades determinísticas
→ facts + provenance
→ síntese/explicação/recomendação
→ resposta auditada.

## 6. Model Provider Boundary

Modelos externos são providers de capacidade cognitiva, não o Core em si.

O Core deve encapsular:
- prompts/policies verticais;
- tool/capability catalog;
- memória/contexto;
- grounding;
- provenance;
- guardrails;
- orquestração;
- avaliação de respostas.

Adapters de provider ficam na infraestrutura.

## 7. Reutilização institucional

Podem ser reaproveitados contracts, primitives e adapters genéricos da Nova FM, desde que isso não mova a autoridade cognitiva vertical para outro produto.

## 8. Autoridade determinística

Metric Engine, Auth/Tenant, Connector Runtime, Audit Ledger e futuros Action Services continuam autoritativos nos seus domínios.

## 9. Deploy Target

Na V1, o Core pode viver no modular monolith do FMCC. Extração para processo/serviço separado exige evidência de escala, isolamento ou operação e novo ADR.

## 10. Critérios de aceite

- cérebro vertical próprio do FMCC;
- sem dependência operacional de Kordena/IRON;
- tenant isolation;
- memória contextual segregada;
- model provider atrás de boundary;
- facts/evidence governados;
- missing permanece unknown/unavailable;
- nenhuma ação crítica automática;
- audit/correlation;
- fail-closed;
- testes e evidência.
