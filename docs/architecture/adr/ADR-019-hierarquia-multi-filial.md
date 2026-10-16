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

## Implementação da etapa 9, parte A (16/10/2026): escopo em toda leitura

- **Porta única** `createMetricService()` (`src/application/metrics/metric-composition.ts`): monta o `MetricService` sempre com o resolvedor de escopo. Os 19 pontos herdados da V1 (8 rotas, 8 páginas, 3 composições) passaram a usá-la.
- **Resolvedor** `createUnitScopeResolver()`: consulta o banco uma vez por requisição (guardado pelo objeto de contexto) e uma concessão revogada vale na requisição seguinte.
- **Achado que não estava na lista:** o feed de atividades, a busca global e as notificações liam fatos e auditoria direto do banco, sem unidade. Agora a consulta exige `unitScope` (campo obrigatório no tipo): fatos só aparecem se a unidade estiver no escopo; fato sem unidade e eventos de auditoria são dado da empresa e só aparecem para quem enxerga tudo.
- `UnitAccessDeniedError` passou a ser uma `PermissionDeniedError`: as rotas que já respondem 403 para permissão negada respondem o mesmo para unidade negada.
- **Trava permanente por teste** (`metric-service-composition.unit.test.ts`): falha se alguém montar `new MetricService(...)` ou `new PostgresMetricStore()` fora da porta única, ou ler as tabelas de fatos/valores fora dos arquivos conhecidos.
- Empresa sem árvore de unidades segue sem restrição (comportamento da V1); verificado.
- **Efeito a conhecer:** em empresa COM árvore de unidades, quem não enxerga tudo e pede métrica sem informar unidade recebe 403 na API; nas telas, o painel abre sem métricas e as demais telas de métricas mostram "sem acesso ao nível da empresa" (nunca erro 500). As telas atuais não pedem unidade; elas só passam a mostrar números por filial com a parte B (seletor de unidade, consolidação e ranking).
- Ainda aberto: a ingestão de fatos não grava unidade (fica nula = nível da empresa); definir como cada fonte informa a filial é parte B/etapa 10.

### O que ainda não existe

- Nenhuma API, tela ou rota cria unidades ou concede acesso; só o repositório. As rotas e páginas herdadas da V1 (19 pontos) já usam o escopo desde a etapa 9, parte A (ver abaixo). **Nenhuma entrada que crie unidades pode existir antes de a decisão A2 (abaixo) ser tomada e de os itens da parte B estarem fechados.**
- Ciclo, profundidade e "filial sem filhos" são garantidos pelo aplicativo com trava por empresa; o banco não os garante (escrita direta no banco os contorna). Um gatilho no banco pode fechar isso.
- Quem pode conceder acesso (`member:manage`) é checagem do chamador futuro, não do repositório.
- A revisão do isolamento foi uma passada adversarial minha, não de um segundo agente.

## Consequências

Positivas: atende empresas com várias unidades. Negativas: mexe no modelo de dados e nas permissões, e deve entrar na Fase 1, antes de haver dados de clientes.

## Riscos e mitigação

Erro de escopo entre unidades tem impacto alto. Mitigação: testes de isolamento entre unidades, como os testes entre tenants da V1.

## Condições de revisão

Revisar ao validar o primeiro cliente com filiais.

### Correções da revisão independente da parte A (16/10/2026)

- `MetricService` exige o resolvedor de escopo no construtor (não existe mais serviço sem escopo); testes usam `tests/helpers/unrestricted-scope.ts`.
- Alertas ainda não têm unidade: seus valores são dado do nível da empresa. Quem não tem acesso a esse nível recebe lista vazia em alertas, busca e notificações.
- Telas de métricas, `/api/metrics/overview` e `src/app/dashboard/error.tsx`: negação vira 403 ou aviso, não 500.
- Core: a negação de permissão ou de unidade não vira "argumento inválido"; o worker relê o papel ATUAL da pessoa (quem saiu da empresa é negado).
- **Decisão pendente (A2), de Fábio:** dados de fonte externa sem unidade (resumo comercial do Kordena, saúde operacional) contam como "dado da empresa"? Se sim, passam a exigir acesso ao nível da empresa. Até a decisão, continuam visíveis para quem tem `commercial:read`; por isso nenhuma entrada que crie unidades deve existir ainda.
- Abertos (baixo): o resolvedor consulta o banco uma vez por serviço montado, não uma vez por requisição; `inArray` com dezenas de milhares de unidades.
