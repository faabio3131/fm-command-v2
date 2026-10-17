# Famílias de dado: o que cada conector entrega e o que falta

Data: 17/10/2026. Proposta para o Diretor revisar (não é decisão tomada).

Tese (Diretor, 17/10/2026): os dados existem nos ERPs; o que falta é o envio. Na prática quase só duas famílias saem de um ERP: financeiro e vendas. O V2 só vira painel de saúde geral da empresa se receber mais famílias.

## Famílias

| Família | Exemplos de fato | Entregue hoje pelos conectores | Observação |
| --- | --- | --- | --- |
| Financeiro | contas a receber e a pagar, caixa, inadimplência | Sim (`finance.receivable`, `finance.payable`) em Omie, Bling, Conta Azul, só contra simulador | Nenhuma chamada a ERP real ainda |
| Vendas | faturamento, pedidos, vendas por item | Omie (opt-in, etapa 8I, só simulador): pedido faturado por período e linhas de item guardadas. Bling e Conta Azul: não | Ranking por produto: motor pronto (etapa 8J, só simulador); falta a tela e a pergunta em linguagem natural |
| Estoque | saldo, giro, ruptura | Omie (opt-in, etapa 8I, só simulador): posição por produto e itens abaixo do mínimo. Demais: não | Nomes dos métodos do Omie não conferidos |
| Fiscal | notas emitidas e recebidas, impostos | Não | Coletor fiscal é decisão em aberto; ver 8G |
| Pessoas | mão de obra, horas, folha | Não | Depende do sistema do cliente |
| Operação | produção, entregas, incidentes por setor | Só nos pacotes de setor (transporte, indústria), com dado sintético | Sem TMS/MES real |
| Clientes e atendimento | clientes ativos, chamados | Métricas internas existem; ERP do cliente não | |

## Regras que valem para todas

- Dado ausente é "Indisponível", nunca zero.
- Moedas diferentes não são somadas nem ordenadas (ADR-012).
- Todo fato guarda unidade de origem, fonte e proveniência.
- O que o sistema do cliente não entrega não é inventado: a tela diz que a família não está conectada.

## Lacunas conhecidas

- O registro de fatos não tem dimensão genérica (produto, item, profissional): o agrupamento por produto lê o campo `productRef` da linha do pedido (etapa 8J). Outras dimensões exigem declarar o campo na métrica.
- Camada de qualidade (conferência, quarentena, cobertura por filial) ainda não existe.
- As APIs oficiais dos ERPs da fila de conectores não foram conferidas quanto a quais famílias entregam.

Relacionado: pesquisa de setores (projeto Sites, `claude/setores-prioritarios-fm-command-v2-2026-10-17.md`) e pesquisa de concorrência (`claude/pesquisa-concorrencia-fm-command-v2.md`).
