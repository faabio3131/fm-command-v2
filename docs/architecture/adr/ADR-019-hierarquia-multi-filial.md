# ADR-019 — Estrutura de matriz, filiais e regiões

**Status:** PROPOSED
**Data:** 15/10/2026
**Autoridade:** FM Solution Architect, aguardando aprovação do Diretor Executivo
**Produto:** FM Command V2
**Relacionado:** ADR-002, ADR-012

## Contexto

O ADR-002 isola cada empresa cliente por `tenant_id` em esquema compartilhado. Esse desenho não prevê unidades dentro de uma empresa. Clientes como uma transportadora com filiais pelo país ou uma indústria com várias plantas precisam consolidar e comparar unidades, e restringir o acesso por unidade.

## Decisão

1. A V2 passa a ter uma hierarquia de unidades dentro de cada tenant (empresa, regiões e filiais), com qualquer profundidade.
2. Todo valor de métrica guarda a unidade de origem.
3. A permissão é por unidade: o gerente de uma filial vê só a sua, a diretoria vê todas.
4. Consolidação, ranking entre filiais e filtro por região entram junto com os gráficos da Fase 2.
5. Várias moedas seguem o ADR-012: sem conversão automática, valores separados por moeda, até haver política cambial aprovada por cliente, com fonte e horário da cotação registrados.
6. Exigências de empresa grande (login único corporativo, banco dedicado, contrato de nível de serviço) ficam como opções a validar antes de prometer a esse porte de cliente.

## Consequências

Positivas: atende empresas com várias unidades. Negativas: mexe no modelo de dados e nas permissões, e deve entrar na Fase 1, antes de haver dados de clientes.

## Riscos e mitigação

Erro de escopo entre unidades tem impacto alto. Mitigação: testes de isolamento entre unidades, como os testes entre tenants da V1.

## Condições de revisão

Revisar ao validar o primeiro cliente com filiais.
