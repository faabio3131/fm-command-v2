# ADR-017 — Roteamento de IA por tarefa e por cliente, com provedores e cobrança configuráveis

**Status:** PROPOSED
**Data:** 15/10/2026
**Autoridade:** FM Solution Architect, aguardando aprovação do Diretor Executivo
**Produto:** FM Command V2

## Contexto

O Command V1 usa um provedor de IA definido por variável de ambiente, sem modelo reserva. O roteador do Core Base escolhe por prioridade entre 3 tipos de tarefa, passa ao reserva só em falha transitória, recusa dois provedores no mesmo nível e tem os adaptadores compatível com OpenAI e Gemini. A configuração é do serviço inteiro, e não por cliente. A V1 usa o Asaas como meio de cobrança.

## Decisão

1. O roteamento é uma tabela configurável por tipo de tarefa, com linhas por cliente que substituem a padrão. A linha mais específica vence.
2. Provedores no mesmo nível dividem a carga por peso. Cada provedor tem limite de chamadas simultâneas e disjuntor.
3. Cada tipo de tarefa tem um principal e um reserva. Chave e cota próprias por tarefa isolam o pico de uma tarefa das outras.
4. A tabela de cada cliente pode listar provedores permitidos. Sem provedor permitido disponível, a tarefa falha com aviso.
5. Existe o tipo de tarefa "decisão", com resposta tipada (escolha, nota ou sim/não) e probabilidade. Qualquer modelo barato pode cumpri-la; o Jev é só um candidato a adaptador, após teste com dados sintéticos.
6. Meios de cobrança seguem o mesmo princípio: uma interface única, e o provedor (hoje o Asaas) é configurável sem mudar código.
7. A escolha do provedor é feita pela política configurada, nunca por uma IA.

## Consequências

Positivas: um cliente grande pode ter provedores dedicados, e nenhum provedor vira ponto único de falha. Negativas: mais configuração e uma bateria de avaliação por tarefa antes de escolher provedores.

## Riscos e mitigação

Provedores novos exigem revisão de privacidade antes de receber dados de cliente. Mitigação: o primeiro teste usa dados sintéticos.

## Condições de revisão

Revisar com os resultados das etapas de medição e de decisões rápidas.
