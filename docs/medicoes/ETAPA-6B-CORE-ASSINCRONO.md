# Etapa 6B — Pergunta ao Core assíncrona, com aviso de progresso

**Data:** 15/10/2026 · **Dados brutos:** `etapa-6b-resultados.json` · **Reprodução:** `next build` e `npx tsx scripts/load/async-core-proof.ts`

## Decisão do Diretor
Em 15/10/2026 o Diretor aprovou que a pergunta ao Core passe a ser assíncrona, com aviso de progresso, por proteger a operação (ADR-016). O provedor real e o teto de gasto ficam para depois.

## O que mudou
- `POST /api/core/query` agora **enfileira** e responde `202` com `id` em poucos milissegundos. Não chama modelo algum, então o processo de operação o atende sozinho.
- `GET /api/core/query/{id}` devolve `queued`, `running`, `succeeded` (com a resposta) ou `failed` (só código público). **Só quem enviou enxerga**: outra pessoa, outra empresa ou id inexistente dão o mesmo 404; sem login, 401.
- O **worker** roda no processo de IA (ou no processo único `all`), nunca no de operação. Liga sozinho; `FMCC_CORE_WORKER=off` desliga; `FMCC_CORE_WORKER_CONCURRENCY` (padrão 4) e `FMCC_CORE_WORKER_MAX_PER_TENANT` (padrão 3) ajustam.
- O modelo usado vem da **política do banco** (ADR-017: principal, reserva, disjuntor); se não há rota configurada, usa o modelo único por variável de ambiente, como na V1.
- Limites: 3 consultas abertas por pessoa e 40 por empresa (acima disso, `429`); prazo de 120 s; 2 tentativas.
- Tela: acompanha o andamento ("na fila", "analisando", segundos decorridos), com textos nos catálogos pt-BR e en-US.
- `FMCC_CORE_QUERY_MODE=sync` restaura o comportamento síncrono da V1 (usado só como volta atrás).

## Segurança
O servidor autenticado grava usuário, papel e correlação na fila no momento do envio; a empresa vem da coluna da fila, não do texto enviado. O navegador não escolhe empresa nem papel. Erros internos nunca chegam à tela (teste com texto sensível).

## Prova (2 processos reais, provedores simulados, 2 CPUs compartilhadas)
| Cenário | Resultado |
|---|---|
| Pergunta simples | envio em 47 ms (202); passa por na fila → analisando → pronta em ~1 s; uso gravado |
| Isolamento e limites | outra pessoa 404, sem login 401; 2 envios aceitos e os 3 seguintes recusados com 429 |
| Provedor principal fora do ar (503) | pergunta concluída pelo reserva, uso gravado no reserva |
| Processo de IA derrubado (SIGKILL) com pergunta na fila | envio aceito em 17 ms; consulta fica `queued`; **108 sondas de `/api/ready` da operação, 0 falhas**; ao voltar a IA, a pergunta é respondida |
Mais 8 testes de integração (validação, idempotência, limites, isolamento, execução, repetição, erro permanente, prazo).

## Limites (o que NÃO está provado)
- **A síntese pelo provedor não foi exercitada ponta a ponta:** o banco de teste não tem métricas governadas, então o Core respondeu "dados indisponíveis" (resposta própria do Core) e só a chamada de planejamento foi ao provedor. A rota de síntese está coberta em teste de unidade e pelo mesmo roteador, mas falta uma prova com dados reais.
- Provedor simulado; sem chave nem provedor real; sem medição de custo real.
- Entrega "pelo menos uma vez": uma reentrega repete as chamadas de IA e a auditoria.
- A tela consulta a cada 1–2 s (não há empurrão do servidor; "ao vivo" é a etapa 10). Voz, histórico e cancelamento da consulta pelo usuário não foram alterados nem criados.
- O limite por pessoa/empresa é conferido antes de enfileirar, sem trava: envios simultâneos podem passar do limite por poucas unidades.
- O papel do usuário é o do momento do envio; se mudar nos segundos seguintes, a consulta roda com o papel antigo.
- A prova da etapa 4 (`two-process-proof.ts`) agora força o modo síncrono para continuar medindo o mesmo caminho.
