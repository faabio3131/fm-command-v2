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

## Implementação da etapa 6 (15/10/2026)
**O que existe:** tabelas `fmcc_ai_provider`, `fmcc_ai_route`, `fmcc_ai_tenant_policy` e `fmcc_ai_usage` (migração 0015); `ProviderRouter` (linha do cliente vence a padrão, peso entre provedores do mesmo nível, limite de simultâneas e disjuntor por provedor, reserva em falha transitória ou recusa do provedor, lista de provedores permitidos por empresa); adaptador `OpenAiCompatibleProvider`; executor de fila `createAiTaskHandler`; uso e custo gravados por chamada.

**Segredos:** o banco guarda só `env://AI_KEY_NOME`; a chave vive na variável de ambiente do serviço de IA. O prefixo `AI_KEY_` é obrigatório (impede apontar para `DATABASE_URL` etc.). Endereços internos, de nuvem (metadados) e `http` são recusados; redirecionamento não é seguido. `FMCC_AI_ALLOW_LOCAL_PROVIDERS=1` libera `localhost` só em teste e desenvolvimento.

**Como ligar um provedor (exemplo, sem chave real):** inserir uma linha em `fmcc_ai_provider` (`enabled=true`), uma linha em `fmcc_ai_route` por tipo de tarefa com `role` primary/reserve, e definir a variável `AI_KEY_...` no serviço de IA. Chave e cota próprias por tarefa = um provedor por tarefa com variável própria. Mudanças valem em até 5 s, sem reiniciar.

**Custo:** gravado em milionésimos da unidade menor (tokens x preço por milhão), exato. Arredondar cada chamada para 1 centavo multiplicaria o custo real por dezenas. Tokens estimados (provedor não informou) ficam marcados.

**Revisão independente (autorizada pelo Diretor para dinheiro e segurança):** um revisor que não viu o trabalho achou 4 defeitos e 3 pontos menores, todos tratados: disjuntor preso depois de cancelamento, segredo apontando para variável arbitrária e endereços internos, uso gravado sem chave de idempotência e sem log de falha, caminho da URL descartado; recusa por conteúdo (403) não abre mais o disjuntor de todos; estouro de custo não gera segunda chamada paga.

**Limites:** só o adaptador compatível com OpenAI (sem Gemini); nenhum provedor real foi chamado; não há tela nem API para administrar provedores e rotas (hoje é SQL); a verificação de endereço olha o nome/IP escrito, não resolve DNS (sem proteção contra DNS malicioso); o disjuntor vale por processo, não é compartilhado entre processos; se o teto de simultâneas mudar com chamadas em andamento, a contagem recomeça (pico breve acima do limite); uma tarefa reentregue depois de perder a posse faz nova chamada paga e grava nova linha de uso (é custo real); `/api/core/query` ainda é síncrona e usa o provedor único da V1 — a ligação à fila é decisão de produto (resposta passa a ser assíncrona); o tipo "decisão" tem rota mas a avaliação de modelos é a etapa 7.

## Condições de revisão

Revisar com os resultados das etapas de medição e de decisões rápidas.
