# Cronograma de execução da V2 — de 0 a 100%

**Status:** PROPOSTA, aguardando a leitura do Diretor Executivo. Regras de execução: `AGENTS.md`.

## Como ler

- O percentual é o peso de cada etapa no total, não horas de trabalho. A etapa conta quando está entregue em PR com os testes verdes.
- Nenhuma data foi prometida. A ordem é a sequência; cada etapa é uma branch e um PR empilhado sobre a anterior.
- 🛑 marca o ponto em que o agente para e o Diretor Executivo decide. Todo o resto segue sozinho se o teste ficar verde.
- "Verde" quer dizer typecheck, lint e testes passando. Teste de integração precisa de PostgreSQL local de teste; se o ambiente não tiver, a etapa fica marcada "sem prova de banco" e isso é dito no relatório.

## Etapas

| # | Etapa | Entrega | Prova (critério de verde) | Peso | Situação |
|---|---|---|---|---|---|
| 0 | Fundação | Repositório da V2, cópia isolada da V1, arquitetura, ADR-015 a 020, contratos do core e roteamento | PRs #1, #2 e #3, testes verdes | 8% | Em revisão |
| 1 | Medir | Teste de carga no caminho da IA com provedor simulado | Relatório com limite real de requisições e tempo de resposta | 4% | Entregue em PR (parcial): `docs/medicoes/ETAPA-1-CARGA-IA.md`. Falta rota com banco e provedor real 🛑 |
| 2 | Hierarquia de unidades | Matriz, regiões e filiais; unidade de origem em cada métrica; permissão por unidade (ADR-019) | Testes de isolamento entre unidades e entre empresas | 8% | Entregue em PR: regras, tabelas, repositório e 43 testes (17 no PostgreSQL). Sem API, tela nem rotas de V1 ligadas ao escopo (ver ADR-019) |
| 3 | Idiomas e perfil | Arquivos de tradução pt-BR e en-US, perfil da empresa (idioma, país, moeda, fuso), seletor de idioma por usuário | Teste que falha se houver texto fixo na interface; formatação por `Intl` | 7% | Entregue em PR (parcial): base de idiomas, perfil, seletor, menu, topo e tela de entrada traduzidos. Cerca de 770 textos fixos nas demais telas herdadas seguem em português, travados por uma catraca que só deixa o número cair; migram junto com cada tela refeita (etapa 9 em diante). Revisão do inglês por pessoa nativa 🛑 |
| 4 | IA fora da operação | Rotas com IA em processo próprio (ADR-016) | Painel e alertas sem lentidão com a IA sob carga simulada | 6% | Entregue em PR (parcial): papéis de processo, ponte com limite e disjuntor, prova com 3 servidores reais e provedor simulado (`docs/medicoes/ETAPA-4-ISOLAMENTO-IA.md`). Prova disponibilidade, não velocidade; máquina de 2 CPUs; sem provedor real nem Kordena |
| 5 | Fila de trabalho | Fila no banco com worker, prioridade, limite por cliente e repetição (ADR-018) | Nenhuma tarefa perdida sob falha provocada | 8% | Pendente |
| 6 | Provedores de IA | Adaptadores, política salva no banco por tarefa e por cliente, limite e disjuntor (ADR-017) | Falha de um provedor não derruba a tarefa; testes com provedor simulado | 8% | Pendente; chave real 🛑 |
| 7 | Decisões rápidas | Tipo de tarefa "decisão" com avaliação em dados sintéticos | Concordância, custo e tempo contra o planejador atual | 3% | Pendente; escolha do modelo 🛑 |
| 8 | Cobrança configurável | Interface única de meio de cobrança, Asaas como um provedor, assinatura e planos em moeda por país | Troca de provedor por configuração, sem mudar código | 6% | Pendente; conta e preços 🛑 |
| 9 | Ver (Fase 2) | Gráficos em cada tela, painéis do cliente, consolidação e ranking entre filiais, filtro por região | Números do gráfico iguais aos do motor de métricas; "Indisponível" nunca vira zero. Pré-requisito: todas as rotas e páginas que criam `MetricService` passam a usar o escopo de unidades antes de existir qualquer API ou tela que crie unidades | 14% | Pendente |
| 10 | Ao vivo (Fase 3) | Números e alertas atualizando sem recarregar a página | Atualização dentro do tempo-alvo em teste | 8% | Pendente |
| 11 | Orquestrador e agentes | Piloto em uma funcionalidade, com orçamento por agente e confirmação humana | Tarefas dentro do orçamento; nenhuma ação sem confirmação | 6% | Pendente; funcionalidade do piloto 🛑 |
| 12 | Agir (Fase 4) | Alertas por e-mail e WhatsApp, relatórios agendados, exportação | Envio em ambiente de teste; recibo de cada envio | 7% | Pendente; provedor de e-mail e WhatsApp 🛑 |
| 13 | Abrir (Fase 5) | Conectores para qualquer empresa e pacotes por setor (transporte, indústria) | Um conector de ponta a ponta com dados sintéticos | 5% | Pendente |
| 14 | Pré-lançamento | Revisão de segurança, testes de ponta a ponta, documentação, homologação | Todos os testes verdes; checklist de lançamento fechado | 2% | Pendente |
| — | Lançamento 🛑 | Mesclar em `main`, publicar, domínio, primeiro país, primeiros clientes | Aprovação expressa do Diretor Executivo | — | Sempre decisão sua |

Soma dos pesos: 100%. Hoje: etapas 0, 1 (parcial), 2 e 3 (parcial) entregues em PR, 27% em PR, 0% em produção.

## Base reaproveitada: Core Base

O Core Base (`FM-Core-Base-`, cópia isolada do fm-ai-platform no ponto 5a17b0c8) é a base pronta das etapas 5, 6 e 7. Como a V2 segue o ADR-013 (o produto tem o seu core, só a fundação é compartilhada), o aproveitamento é por porte, não por cópia do projeto:

- Das regras do roteador (prioridade, reserva só em falha transitória, recusa de dois provedores no mesmo nível), da política de repetição e da caixa de entrada de eventos com fila de falhas, cada comportamento vira um teste na V2 antes de ser portado para TypeScript. O Core Base serve de gabarito: os mesmos casos de teste valem para as duas implementações.
- A tabela de preços e o controle de custo da IA (FinOps) vêm junto, ligados ao evento de uso e custo que já existe nos contratos.
- Fica de fora o que é do serviço Python (FastAPI, RBAC próprio), porque a V2 já tem autenticação e permissão.
- Se o Diretor Executivo preferir rodar o Core Base como serviço separado chamado por API, isso reverte o ADR-013 e o ADR-015 e acopla versão, disponibilidade e custo entre produtos. É decisão dele, não do agente.

## Decisões que só o Diretor Executivo pode tomar

- Aprovar as sete regras do core como regra constitucional e os ADR-015 a 020 (hoje PROPOSED).
- Mesclar os PRs em `main`, na ordem, e publicar.
- Nome e domínio da V2; modelo de preço (por empresa, não por leitor).
- Chaves reais de IA, cobrança, WhatsApp e e-mail, e a escolha de cada provedor depois da avaliação.
- Funcionalidade do piloto de agentes (sugestão: análise do Command V2).
- Padrões do mercado global (Command V2 primeiro, Estados Unidos primeiro, autoatendimento com cartão) e o lançamento em cada país.
- Advogado e contador para a venda no exterior.

## Riscos do próprio cronograma

- A cadeia de PRs empilhados cresce a cada etapa. Quanto mais tarde a primeira revisão, maior a revisão. Sugestão: mesclar em `main` na ordem a cada poucas etapas.
- Os pesos são estimativa de proporção, não de esforço; as etapas 9 e 12 podem crescer ao serem detalhadas.
- Nada foi medido ainda. A etapa 1 pode mudar a ordem das etapas 4 a 6.
