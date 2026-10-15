# Etapa 4 — IA fora da operação: prova com dois processos

**Data:** 15/10/2026 · **Dados brutos:** `etapa-4-resultados.json` · **Reprodução:** `npx tsx scripts/load/two-process-proof.ts saida.json`

## O que foi feito
O mesmo aplicativo agora sobe em três papéis (`FMCC_PROCESS_ROLE`): `all` (padrão, igual à V1), `operation` (nunca chama o modelo; repassa `/api/core/query` ao processo de IA) e `ai` (só atende `/api/core/*`, `/api/health`, `/api/ready`, `/api/version`; o resto responde 404). A ponte entre os dois tem limite de simultâneos, disjuntor e tempo máximo; quando recusa, responde 503 com `retry-after`.

## Como foi medido
Três servidores reais (`next start`, portas 3200/3201/3202), PostgreSQL local de teste, provedor de IA **simulado** (plano 800 ms, síntese 1500 ms), sessão autenticada real. Uma sonda pede `/api/ready` da operação a cada 50 ms durante cada cenário.

| Cenário | Sondas da operação | Observação |
|---|---|---|
| S1 — um processo faz tudo | 204 × 200, 0 falhas, p50 5,5 ms, p95 119 ms | 1.261 pedidos de IA, todos 200 |
| S2 — dois processos, mesma carga | 58 × 200, 0 falhas, p50 192 ms, p95 389 ms | 789 × 200, 4.617 × 503 (limite da ponte) |
| S3 — IA derrubada (SIGKILL aos 8 s, religada aos 20 s) | 102 × 200, 0 falhas, p95 407 ms | erro de IA em 12 ms após a queda; primeiro sucesso 3,8 s após religar |
| S4 — provedor travado | 51 × 200, 0 falhas, p95 579 ms | 11.476 pedidos, todos 503 rápidos (p50 147 ms) |

Também confirmado: o processo de IA responde 404 para páginas da operação.

## O que a prova mostra
- A operação **nunca deixou de responder**, nem com o processo de IA morto nem com o provedor travado (0 falhas em 211 sondas nesses cenários).
- Com a IA fora, os pedidos de IA falham **rápido** (12 ms), em vez de ficarem pendurados.
- A IA volta a atender sozinha, sem reiniciar a operação.

## O que a prova NÃO mostra (limites)
- **Latência não melhorou.** Na sonda, S2 ficou *mais lenta* que S1 (p50 192 ms contra 5,5 ms). Os cenários não são comparáveis em carga: o gerador recebe 503 rápidos e dispara muito mais pedidos (5.406 contra 1.261), e tudo roda em **uma máquina de 2 CPUs** que o gerador, os três servidores e o banco disputam. O ganho provado é de **disponibilidade**, não de velocidade.
- S1 não teve cenário de falha: não medi o que acontece com um processo único quando o provedor trava, então a comparação "antes × depois" na queda é argumento de projeto, não número.
- A taxa alta de 503 é o limite de 32 simultâneos funcionando como desenhado, mas o valor 32 não foi calibrado.
- Provedor simulado, Node 22 (o projeto pede 24), sem rede real entre processos, sem Kordena (Python) — o risco de bloqueio dele segue não medido.
- A primeira execução desta prova travou por cerca de 8 minutos sem causa identificada; a repetição, com marcadores de progresso e encerramento limitado, terminou normalmente.

## Em produção
Nada foi publicado. Para usar os dois processos é preciso subir um segundo serviço com `FMCC_PROCESS_ROLE=ai` e apontar a operação para ele (`FMCC_AI_SERVICE_URL`); o exemplo está em `deploy/render.blueprint.example.yaml` (apenas modelo, sujeito à aprovação do ambiente).
