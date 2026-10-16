# Etapa 7 — Decisões rápidas (tipo de tarefa "decisão") e avaliação em dados sintéticos

**Data:** 15/10/2026 · **Dados brutos:** `etapa-7-resultados.json` · **Reprodução:** `npx tsx scripts/eval/decision-eval.ts`

## Leia primeiro: o que esta medição prova e o que não prova
- **Modelos SIMULADOS.** Acerto, confiança e tempo vêm de parâmetros que eu declarei (`SIM` no script) com semente fixa. Os números de acerto e tempo **não medem a qualidade de nenhum modelo real**; eles provam que o mecanismo (tipo de tarefa, limite de confiança, escalada) e o método de medir funcionam.
- **O que é real:** o conjunto de 48 casos escritos à mão, o tamanho dos prompts (o prompt do planejador atual foi capturado do código real; o da decisão rápida é o que o sistema envia) e a conta de custo, exata em micro-unidades. Tokens são estimados em 1 por 4 caracteres; o provedor real informa o número exato.
- **Preços ilustrativos** (US$ 3/15 e US$ 0,25/1,25 por milhão de tokens): não são a tabela vigente de ninguém. Trocar pelo preço real é mudar duas linhas.
- **Amostra pequena** (48 perguntas, 16 métricas): serve para comparar o desenho, não para prometer percentuais.
- **O Core ainda não usa a decisão rápida.** Esta etapa entrega o tipo de tarefa e a avaliação. Ligar o atalho no fluxo da pergunta só deve acontecer depois da medição com modelo real.

## Decisão do Diretor (15/10)
Modelo da decisão rápida: **Haiku** (família Claude, pequeno). Sem chave e sem gasto nesta etapa; a chave entra pelo ambiente com teto de gasto quando ele definir.

## O que foi entregue
- **Tipo de tarefa `decision`** na fila e no roteamento por política do banco (ADR-017). Pedido fechado: escolha entre opções, sim/não ou nota. Resposta tipada com **confiança**.
- **Opções e intervalo vêm do pedido, nunca do eco do modelo**: opção inventada, nota fora do intervalo ou confiança inválida viram saída inválida (a fila repete; esgotadas as tentativas, `dead`; nunca vira decisão).
- **Limite de confiança** (padrão 0,8): abaixo dele a resposta vem marcada `needsHuman` para escalar (planejador completo ou pessoa). Quem escala é quem chamou.
- Pedido inválido vai direto para `dead`, sem chamar provedor. Uso e custo gravados por tentativa (5.500 micro-centavos num caso de 120 tokens de entrada e 20 de saída a 25/125).
- **Comparador** (`decision-eval.ts`): acerto, concordância com o planejador, taxa de escalada, acerto dos aceitos, **erro com confiança alta**, custo, tempo (médio e p95) e a **cascata** (rápido primeiro, planejador só nos de baixa confiança).

## Resultado da simulação (limite 0,8)
| | Planejador (grande) | Decisão rápida (pequeno) | Cascata |
|---|---|---|---|
| Acerto | 100% | 85% (fáceis 100%, difíceis 56%) | 94% |
| Tokens de entrada por pergunta | ~969 | ~357 | — |
| Custo por 1.000 perguntas | ~US$ 3,81 | ~US$ 0,12 | ~US$ 0,44 |
| Tempo médio / p95 | 1,8 s | 0,4 s | 0,5 s / 2,0 s |

- A decisão rápida concordou com o planejador em 85% dos casos; 8% foram escalados; entre os que aceitou, acertou 93%.
- **3 de 48 (6%) foram aceitos com confiança alta e estavam errados.** É o risco que decide se o atalho vale: no limite 0,9 caem para 1, mas a escalada sobe para 44% e o custo da cascata sobe para ~US$ 1,79 por mil.
- Parte da economia vem de enviar menos texto (357 contra 969 tokens), que é um fato dos prompts, não da simulação. O resto depende do modelo real.

## Limites e próximos passos
- Nada aqui foi medido com modelo real; a calibração da confiança do Haiku (o quanto ele "sabe que não sabe") só se vê com a chave. **Recomendação:** não ligar o atalho no fluxo do Core antes dessa medição e de uma amostra maior, e só se o erro com confiança alta ficar abaixo do que o Diretor aceitar.
- A comparação é "qual métrica responde à pergunta" (uma escolha). O planejador real também escolhe várias métricas, capacidades e produtos; essa parte não é coberta.
- Modelo reserva da decisão rápida fica para quando a chave entrar.
