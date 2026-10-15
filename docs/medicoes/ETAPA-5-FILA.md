# Etapa 5 — Fila de trabalho no PostgreSQL

**Data:** 15/10/2026 · **Dados brutos:** `etapa-5-resultados.json` · **Reprodução:** `npx tsx scripts/load/queue-throughput.ts 60000 8` e `npx tsx scripts/load/queue-flood.ts 50000`

## O que foi feito
Tabela `fmcc_work_item` (migração 0014) e `PostgresWorkQueue` (ADR-018): entrada idempotente por (empresa, chave), prioridade 0–100, prazo, `SKIP LOCKED`, posse por prazo (lease) com renovação, **limite de tarefas simultâneas por empresa**, repetição com espera exponencial e variação, estados finais registrados (`succeeded`, `dead`, `expired`) e *fencing*: quem perdeu a posse não consegue gravar resultado. `processOne`/`runWorker` executam tarefas por tipo; `PermanentTaskError` manda direto para `dead`.

## Prova de "nenhuma tarefa perdida"
Teste de integração no PostgreSQL: 300 tarefas, 6 empresas, 8 workers, com sorteio fixo de falhas (10% o worker some sem avisar, 15% erro repetível, 5% lento a ponto de perder a posse). Resultado em todas as execuções: **300 de 300 em estado final, 0 na fila, 0 rodando, nenhuma concluída duas vezes**; 81 tarefas precisaram de mais de uma tentativa (até 6). Mais 10 testes de regra: ordem por prioridade, 8 workers disputando 60 tarefas (cada uma sai uma vez), limite por empresa, worker que morre e outro assume, morte na última tentativa, prazo vencido, entrada inválida.

## Medições (máquina de 2 CPUs, PostgreSQL 16 local, tarefa que não faz nada)
| Cenário | Resultado |
|---|---|
| Pegar + concluir, fila de 5 mil, 8 workers | ~340/s |
| Pegar + concluir, fila de 60 mil, 8 workers | 518/s, p50 15 ms, p95 24 ms |
| Enfileirar | 3,4 mil a 5 mil/s |
| Uma empresa com 50 mil tarefas de prioridade alta no limite; 30 empresas pequenas | todas atendidas; p50 4 ms, máx. 6 ms |

## Achado e correção durante a etapa
A primeira versão da consulta de "pegar tarefa" varria e ordenava a fila inteira a cada pedido (plano com leitura completa da tabela, 84 ms com 50 mil na fila); uma carga de 60 mil não terminou em 500 s. Troquei por índices parciais e uma consulta que olha só a primeira tarefa de cada empresa e ignora empresas já no limite. Depois disso o tempo não depende mais do tamanho da fila.

## Limites (o que NÃO está provado ou NÃO existe)
- **Entrega "pelo menos uma vez":** uma tarefa pode rodar mais de uma vez (worker lento perde a posse e outro assume). Quem implementa o executor precisa torná-lo idempotente. Só o registro do resultado é protegido.
- **Nada liga o worker ainda:** `runWorker` existe e é testado, mas nenhum processo o inicia e nenhuma rota enfileira. `/api/core/query` continua síncrona; a ligação vem com os provedores (etapa 6).
- **Sem ordem por cliente:** o ADR-018 cita ordenação por cliente; não foi feita. A ordem é prioridade, depois chegada.
- **Custo por número de empresas:** a consulta é proporcional ao número de empresas com tarefa na fila (testado com 31). Com milhares de empresas simultâneas, medir de novo.
- Não há limpeza de tarefas antigas, painel de fila, alerta de fila parada nem limite de tamanho da fila por empresa.
- Máquina de 2 CPUs compartilhada com o gerador de carga e o banco; PostgreSQL 16 (produção prevista é outra versão); tarefa vazia, sem IA real.
- O limite por empresa usa trava sem espera: sob disputa, um worker pode não pegar tarefa e tentar de novo no ciclo seguinte (subatende por instantes, nunca estoura o limite).
- O worker é processo confiável e enxerga todas as empresas; cada executor deve usar o `tenantId` da própria tarefa como única autoridade.
