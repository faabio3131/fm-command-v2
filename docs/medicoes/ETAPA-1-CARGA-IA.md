# Etapa 1 — Medição da carga no caminho da IA (Command V2)

**Data:** 15/10/2026 · **Dados brutos:** `etapa-1-resultados.json` · **Como repetir:** `npx tsx scripts/load/ai-path-load.ts`

## O que foi medido e o que não foi

Medido: o código real do Command (adaptador `OpenAiCompatibleCognitiveModel` e núcleo `FmccVerticalCognitiveCore`: planejamento, leitura simulada de 5 ms, síntese) em um único processo Node, contra um provedor de IA simulado em `localhost`.

**Não medido:** provedor real (latência, cota, erros), rede, banco de dados, autenticação, a rota HTTP do Next, o Kordena e o AtendeVendeIA (Python). Os tempos do provedor simulado (planejamento 800 ms, síntese 1.500 ms, variação de até 200 ms) e o limite de 20 chamadas simultâneas do cenário B são hipóteses minhas, não números de provedor.

Ambiente: Node 22.22 (o projeto pede Node 24), 2 CPUs, 8 GB de memória. Um ambiente de produção diferente muda os números.

## Resultados

**A. Provedor sem limite.** Cada pergunta faz duas chamadas seguidas ao provedor.

| Simultâneas | Pedidos | Falhas | p50 | p95 | p99 | Pedidos/s | Memória |
|---|---|---|---|---|---|---|---|
| 1 | 5 | 0 | 2,52 s | 2,59 s | 2,59 s | 0,4 | 101 MB |
| 10 | 50 | 0 | 2,53 s | 2,64 s | 2,69 s | 3,9 | 101 MB |
| 50 | 150 | 0 | 2,51 s | 2,67 s | 2,70 s | 19,1 | 117 MB |
| 100 | 300 | 0 | 2,54 s | 2,66 s | 2,71 s | 37,7 | 137 MB |
| 200 | 600 | 0 | 2,53 s | 2,68 s | 2,74 s | 74,9 | 157 MB |
| 400 | 1.200 | 0 | 2,55 s | 2,76 s | 2,81 s | 148,1 | 204 MB |

O tempo de resposta quase não muda com a carga: o nosso código gasta pouco tempo próprio e quase todo o tempo é espera do provedor. A memória cresce com o número de conexões abertas.

**B. Provedor com cota de 20 chamadas simultâneas.**

| Simultâneas | Falhas | Respostas 429 do provedor | Pedidos/s |
|---|---|---|---|
| 10 | 0% | 0 | 3,8 |
| 20 | 0% | 0 | 7,7 |
| 50 | 60% | 90 | 7,7 |
| 100 | 80% | 240 | 7,7 |

Acima da cota o sistema não enfileira nem repete: cada chamada recusada vira erro para o usuário (a rota devolve 503). A vazão para de crescer no limite do provedor. Isso confirma, no código, o que o ADR-017 descreve: um só provedor, sem reserva.

**C. Provedor com 5% de erros 503.** 10% dos pedidos falharam, quase o dobro, porque cada pergunta depende de duas chamadas e nenhuma é repetida (10% é o esperado: 1 − 0,95²).

**D. Tempo limite.** Com limite de 1 s e síntese de 1,5 s, 100% dos pedidos falharam como "indisponível". Em produção o limite do adaptador é de 30 s.

**E. Painel no mesmo processo.** Uma consulta de saúde a cada 50 ms, sem e com 200 pedidos de IA simultâneos:

| | p50 | p95 | p99 | Máximo | Atraso do laço de eventos (p99) |
|---|---|---|---|---|---|
| Sem carga de IA | 1,0 ms | 1,3 ms | 1,4 ms | 4,3 ms | 10,7 ms |
| Com carga de IA | 0,8 ms | 2,2 ms | 9,2 ms | 62,1 ms | 14,0 ms |

A carga de IA aumentou a cauda (um pico de 62 ms), mas não travou o painel.

**Custo de entrada:** o planejador envia o catálogo inteiro de métricas em toda pergunta: 2.792 bytes, cerca de 700 tokens estimados (17 métricas). Cresce com o catálogo.

## O que isso muda no plano

1. **A hipótese de que o Command bloqueia o processo não se confirmou.** No Command (Node), as chamadas de IA são esperas assíncronas e o processo aguentou 400 simultâneas sem travar. O risco de bloqueio descrito no ADR-016 vem do Kordena (Python, endpoints assíncronos chamando código bloqueante), e isso **não foi medido aqui**. A etapa 4 continua válida pelo isolamento de falha, mas a urgência no Command é menor do que eu supunha; no Kordena precisa de medição própria.
2. **O gargalo do Command é o provedor, não o processo.** A cota do provedor define o teto (cenário B) e uma falha dele vira erro direto (cenários B, C e D). Isso sustenta as etapas 5 e 6: fila com limite por cliente, repetição e reserva.
3. **A rota real ainda não foi medida.** Falta medir banco (leituras de métricas, auditoria gravada em cada consulta e tamanho do pool de conexões) e autenticação sob carga. Pode aparecer um gargalo que aqui não aparece.
4. **Falta medir com provedor real**, com chave e orçamento definidos pelo Diretor Executivo, para obter latência e cota verdadeiras.

## Limites desta medição

Servidor e cliente de carga rodam na mesma máquina e disputam as mesmas 2 CPUs, o que favorece números piores para o nosso código, não melhores. Cada nível rodou poucas vezes; não há repetição estatística. Use os números como ordem de grandeza.
