# FM Command V2: visão, decisões e estado

Este documento existe para que quem chegar ao projeto (pessoa ou agente, em qualquer conversa nova) saiba o que o V2 precisa ser sem depender de histórico de conversa. **Em caso de dúvida, vale este documento, depois o `README.md`, o `AGENTS.md`, o cronograma e os ADRs.** Mudanças de direção do Diretor Executivo entram aqui na hora.

## O que o V2 é

- O **FM Command V2 é a evolução do FM Command comercial**: um produto para ser vendido a empresas clientes da FM Tecnologia. **Não é o Command de uso interno da FM** (esse é o V1, que segue como está, em `FM-CONTROL-CENTER`).
- **Não tem relação com nenhum produto da FM** (Kordena, Iron Fit, AtendeVendeIA, NFCore etc.). Nenhum código, tela, integração ou regra específica desses produtos pode existir no V2. O cliente conecta as próprias fontes de dados por configuração.
- Multissetor desde a origem; **multi-filial** (matriz, filiais, regiões) como requisito central; **mercado global**, começando pelos países de língua inglesa, vendido online em autoatendimento; português e inglês.
- Gráficos em cada tela, números ao vivo, alertas e ações governadas com aprovação humana, IA que explica com evidência, voz (mais útil para diretor e administrativo).
- Objetivo comercial: estar no nível da concorrência e passar à frente dela.

## Regras de ouro do produto

1. Dado ausente **nunca** vira zero: "Indisponível" é um estado explícito.
2. Todo número tem fonte e proveniência; as métricas oficiais vêm do motor determinístico, não do modelo de IA.
3. Isolamento entre empresas e entre unidades em toda leitura.
4. IA fora da operação: se a IA cair, o produto continua; a IA nunca autoriza nada.
5. Nada fixo no código que dependa de cliente, país, banco, provedor de IA ou setor: tudo isso é configuração.

## Decisões do Diretor Executivo (15 e 16/10/2026)

- **Cobrança configurável:** como a FM recebe mensalidades não pode ficar presa a um banco. O banco é escolhido por moeda e país, com **vários provedores por rota em ordem de prioridade**, e **as taxas de cada banco** (boleto, PIX, cartão etc., fixo, percentual, mínimo, máximo e vigência) são tabela de configuração. O mesmo vale para como cada cliente do produto recebe dos clientes dele.
- **Mercado-alvo:** todos os países de língua inglesa. O **comprador paga o imposto sobre a venda** (preço mais imposto). **Quem calcula, cobra e repassa o imposto foi adiado** (processador direto com a FM recolhendo, ou intermediário que assume a venda). Questões fiscais e jurídicas passam por contador e advogado.
- **Modelo de IA para decisão rápida:** Haiku, sem custo agora (sem chave real). Chave real e teto de gasto só quando o Diretor definir provedor e teto, e sempre pelo ambiente, nunca pelo chat.
- **Voz:** parte 1 (ditar e ouvir pelo navegador) entregue; parte 2 (voz de provedor profissional) depois.
- **Fusão de PRs:** só com o "pode mesclar" expresso do Diretor, uma por vez, na ordem.
- **Revisão em inglês:** feita por IA; revisão por pessoa nativa antes de cobrar clientes.

## Estado (16/10/2026)

Etapas 0 a 8D entregues como PRs empilhados (#1 a #17), nenhuma mesclada. A etapa 9, parte A (escopo de unidades em toda leitura), está na PR #14. Veja o cronograma para o detalhe e os relatórios em `docs/medicoes/`.

## Pendências que dependem do Diretor

- Quem recolhe o imposto sobre a venda e qual fornecedor de pagamento internacional (segundo adaptador real).
- Preços e planos; conta de teste do provedor; produção.
- Chave de IA e teto de gasto; revisão nativa do inglês.
- O relatório "FM Command V2: Mercado e lacunas", citado no README, **não está no repositório nem no Drive**. Ou é recuperado, ou a pesquisa de concorrência é refeita com fontes citadas. As etapas ainda não feitas (tradução das telas, gráficos, ao vivo, agir, abrir) devem ser reordenadas a partir dela.

## Limpeza do código herdado (decisão de 16/10/2026)

O V2 nasceu como cópia isolada da V1 e trouxe código específico de produtos da FM. A limpeza em andamento tira esse código do V2, em etapas pequenas e com testes verdes a cada uma, sem tocar a V1 e sem apagar tabelas do banco sem ordem do Diretor. Os itens que podem ser recurso do produto comercial (cobrança por produto do cliente, recebível por produto, fontes configuráveis) são separados e mostrados antes de qualquer exclusão. Inventário e justificativas ficam em `docs/medicoes/`.
