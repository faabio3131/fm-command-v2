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

## Implementação da etapa 2 (15/10/2026)

- Regras puras em `src/domain/organization/unit-hierarchy.ts`: matriz única, regiões em qualquer profundidade (limite de 8 níveis, contando a subárvore ao mover), filial sem filhos, sem ciclo, país (ISO 3166), fuso (IANA) e moeda (ISO 4217) opcionais por unidade.
- Escopo por pessoa: dono e administrador veem tudo; os demais papéis veem só as unidades concedidas e as descendentes; concessão na matriz equivale a todas; sem concessão, nada, nem dado no nível da empresa. Empresa sem árvore de unidades segue sem restrição (compatível com a V1). Pedir uma unidade a um `MetricService` sem resolvedor de escopo falha fechado.
- Banco (migração 0012): `fmcc_org_unit`, `fmcc_unit_grant` e `unit_id` em `fmcc_canonical_fact` e `fmcc_metric_value`. Chaves compostas (empresa, unidade) fazem o próprio banco recusar unidade de outra empresa, mesmo sem passar pelo aplicativo. Também no banco: uma matriz por empresa, matriz sem pai, formato de país e de moeda.
- Edições da árvore são serializadas por empresa (trava no banco), e dois movimentos simultâneos que formariam ciclo resultam em um só vencedor.
- Leitura de métrica sem unidade devolve só dado da empresa (unidade nula); com unidade, só dessa unidade. Não há soma entre unidades: consolidação é da Fase 2.

### O que ainda não existe

- Nenhuma API, tela ou rota cria unidades ou concede acesso; só o repositório. As rotas e páginas herdadas da V1 (cerca de 19 pontos que montam `MetricService`) ainda não usam o escopo. **Antes de existir qualquer entrada que crie unidades, todas elas precisam usar o resolvedor de escopo** (requisito da etapa 9).
- Ciclo, profundidade e "filial sem filhos" são garantidos pelo aplicativo com trava por empresa; o banco não os garante (escrita direta no banco os contorna). Um gatilho no banco pode fechar isso.
- Quem pode conceder acesso (`member:manage`) é checagem do chamador futuro, não do repositório.
- A revisão do isolamento foi uma passada adversarial minha, não de um segundo agente.

## Consequências

Positivas: atende empresas com várias unidades. Negativas: mexe no modelo de dados e nas permissões, e deve entrar na Fase 1, antes de haver dados de clientes.

## Riscos e mitigação

Erro de escopo entre unidades tem impacto alto. Mitigação: testes de isolamento entre unidades, como os testes entre tenants da V1.

## Condições de revisão

Revisar ao validar o primeiro cliente com filiais.
