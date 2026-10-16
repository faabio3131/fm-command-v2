# ADR-016 — A operação do cliente nunca depende da IA

**Status:** PROPOSED
**Data:** 15/10/2026
**Autoridade:** FM Solution Architect, aguardando aprovação do Diretor Executivo
**Produto:** FM Command V2 (regra proposta para todos os SaaS da FM)

## Contexto

Na V1, a rota `/api/core/query` faz duas chamadas seguidas ao modelo, o planejamento e a síntese, dentro de uma única requisição, com limite de 30 segundos, um só provedor e sem modelo reserva. A busca global tem limite de uso por minuto; a rota do core não tem. No Kordena (fm-ai-platform), as rotas com IA são assíncronas mas chamam funções que esperam a resposta bloqueando o processo, e o PDV, o KDS e essas rotas estão no mesmo aplicativo. Isso é leitura de código. A medição da etapa 1 (`docs/medicoes/ETAPA-1-CARGA-IA.md`) mostrou que o Command, em Node, não trava o processo com até 400 pedidos de IA simultâneos contra um provedor simulado; o limite é a cota do provedor, sem reserva nem repetição. O risco de bloqueio do processo vem do Kordena (Python) e ainda não foi medido. Rota com banco e provedor real também não foram medidos.

## Decisão

Painéis, alertas, cobrança e integrações da V2 não chamam a IA diretamente e não compartilham processo com as rotas que a usam. Toda tarefa de IA entra como trabalho e devolve o resultado por evento ou consulta. A falha ou a lentidão de qualquer provedor nunca derruba a operação.

## Consequências

Positivas: a operação continua mesmo com todos os provedores fora do ar. Negativas: respostas de IA passam a ser assíncronas para o usuário, com aviso de progresso.

## Implementação da etapa 4 (15/10/2026)
`FMCC_PROCESS_ROLE` = `all` | `operation` | `ai`. Em `operation`, `/api/core/query` é repassada ao processo de IA por uma ponte com limite de simultâneos (32), disjuntor (5 falhas, 15 s aberto, uma sonda em meia-abertura) e tempo máximo (35 s); só cookie, content-type, accept-language e x-correlation-id seguem; 4xx passam sem contar no disjuntor. Em `ai`, `src/proxy.ts` serve apenas `/api/core/*` e rotas de saúde. Prova em `docs/medicoes/ETAPA-4-ISOLAMENTO-IA.md`: operação sem falha com IA morta e com provedor travado. Limites: prova de disponibilidade e não de velocidade, 2 CPUs, provedor simulado, valores do limite não calibrados. A resposta continua síncrona nesta etapa; a assíncrona via fila vem na etapa 5 (ADR-018).

## Atualização da etapa 6B (15/10/2026)
O Diretor aprovou a resposta assíncrona. `POST /api/core/query` agora só enfileira (202) e o processo de operação o atende sem a ponte; o worker roda no processo de IA. A ponte da etapa 4 permanece apenas para `FMCC_CORE_QUERY_MODE=sync`. Detalhes e prova em `docs/medicoes/ETAPA-6B-CORE-ASSINCRONO.md`.

## Condições de revisão

Revisar com os números da etapa de medição.
