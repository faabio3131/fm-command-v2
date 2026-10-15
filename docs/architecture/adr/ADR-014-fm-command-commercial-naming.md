# ADR-014 — Commercial Product Naming: FM Command

**Status:** ACCEPTED
**Data:** 24/09/2026
**Autoridade:** Nova FM Tecnologia
**Produto:** FM Command
**Identificador técnico/histórico:** FM Control Center / FMCC
**Domínio oficial:** `fmcommand.com.br`

## Contexto

O produto foi concebido e implementado sob o nome técnico **FM Control Center**, abreviado **FMCC**. Após o fechamento e certificação da F21, a Nova FM Tecnologia registrou o domínio `fmcommand.com.br` e definiu **FM Command** como nome comercial oficial do produto.

O nome técnico FMCC já está incorporado de forma ampla e rastreável em repositório, prefixos de banco, variáveis de ambiente, workflows, documentação histórica, serviços e artefatos operacionais.

## Decisão

Adotar **FM Command** como identidade comercial oficial e nome apresentado ao usuário.

A relação de nomenclatura passa a ser:

- **FM Command** — nome comercial oficial do produto;
- **Nova FM Tecnologia** — marca-mãe;
- **fmcommand.com.br** — domínio comercial oficial registrado;
- **FM Control Center / FMCC** — identificador técnico, histórico e de engenharia preservado.

## Regras de aplicação

### Deve usar FM Command

- interface apresentada ao usuário;
- metadata/título do produto;
- materiais comerciais;
- comunicação institucional atual;
- documentação vigente quando se referir ao nome comercial;
- Visual Premium Final;
- domínio e identidade pública.

### Deve preservar FMCC / FM Control Center quando tecnicamente apropriado

- nome do repositório atual;
- prefixos de tabelas e schemas;
- variáveis de ambiente;
- namespaces internos;
- nomes de workflows e gates;
- IDs técnicos e service identifiers;
- caminhos já contratados;
- commits, PRs e relatórios históricos;
- documentos históricos cuja alteração prejudicaria rastreabilidade.

Não haverá renomeação destrutiva apenas por branding.

## Não decisão

Este ADR não autoriza:

- troca de arquitetura;
- reconstrução do frontend;
- alteração de contratos;
- rename de banco/tabelas;
- alteração de variáveis de ambiente;
- mudança do service id `fm-control-center`;
- apontamento DNS ou cutover de produção;
- deploy de produção;
- início automático do Visual Premium Final.

## Migração visual

O Visual Premium Final deverá usar **FM Command** como identidade primária desde o início, preservando a arquitetura funcional certificada.

## Compatibilidade

Referências históricas a **FM Control Center** continuam válidas e devem ser interpretadas como referências ao mesmo produto hoje comercialmente denominado **FM Command**.
