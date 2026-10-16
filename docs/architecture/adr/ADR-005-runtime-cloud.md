# ADR-005 — Runtime, stack Web e cloud inicial

**Status:** ACCEPTED  
**Data:** 18/09/2026  
**Autoridade:** FM Solution Architect / FM SaaS Tech Lead  
**Produto:** FM Control Center

## Contexto

O FMCC parte de um repositório essencialmente vazio e de um System Design já aprovado. A decisão deve preservar arquitetura única evolutiva, multi-tenancy, segurança by design, fronteiras explícitas, portabilidade e o princípio de que o Core não substitui autoridades determinísticas.

## CURRENT

Não existe implementação estrutural do FMCC na `main`. As capacidades existentes da Nova FM são heterogêneas. O Core mais maduro observado está no Kordena, em branch OPEN/DRAFT, e não constitui componente compartilhado de produção.

## Decisão

Adotar **TypeScript + Next.js 16.3.x em Node.js 24 LTS** como aplicação Web full-stack em **modular monolith**. Empacotar de modo container-compatible. Adotar **Render** como target inicial de PaaS para ambientes não produtivos e produção futura, com PostgreSQL gerenciado compatível e health checks. GitHub Actions será o CI. Não usar Kubernetes nesta etapa.

## Justificativa

O FMCC ainda não necessita complexidade distribuída. Next.js já é usado em ativos Nova FM e permite Web First com uma única linha. Render fornece web services, env/secrets, TLS, health e previews, reduzindo carga DevOps; container preserva caminho de saída.

## Consequências

Positivas: velocidade, uma stack principal, baixo custo operacional e deploy simples. Negativas: dependência inicial de PaaS e limites do plano escolhido.

## Riscos e mitigação

Manter Dockerfile/contratos portáveis; configuração externa; não usar APIs proprietárias no domínio. O deploy real depende de conta/credenciais Render e continua bloqueado até acesso autorizado.

## Segurança e dados

Toda implementação derivada deste ADR deve manter autorização server-side, escopo de tenant confiável, secrets fora do código e rastreabilidade suficiente para auditoria.

## Reversibilidade

A decisão deve permanecer reversível por contratos/boundaries e migrations controladas; substituição futura não autoriza arquitetura paralela.

## Condições de revisão

Revisar quando volume, SLA, custo, compliance, necessidade de segundo provider ou evidência operacional invalidarem as premissas atuais.

## Evidências / fontes consultadas

- Next.js 16.3: https://nextjs.org/blog
- Render Web Services: https://render.com/docs/web-services
- Render Preview Environments: https://render.com/docs/preview-environments
