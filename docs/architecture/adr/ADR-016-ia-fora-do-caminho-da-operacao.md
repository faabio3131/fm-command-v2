# ADR-016 — A operação do cliente nunca depende da IA

**Status:** PROPOSED
**Data:** 15/10/2026
**Autoridade:** FM Solution Architect, aguardando aprovação do Diretor Executivo
**Produto:** FM Command V2 (regra proposta para todos os SaaS da FM)

## Contexto

Na V1, a rota `/api/core/query` faz duas chamadas seguidas ao modelo, o planejamento e a síntese, dentro de uma única requisição, com limite de 30 segundos, um só provedor e sem modelo reserva. A busca global tem limite de uso por minuto; a rota do core não tem. No Kordena (fm-ai-platform), as rotas com IA são assíncronas mas chamam funções que esperam a resposta bloqueando o processo, e o PDV, o KDS e essas rotas estão no mesmo aplicativo. Isso é leitura de código; nenhum teste de carga foi feito.

## Decisão

Painéis, alertas, cobrança e integrações da V2 não chamam a IA diretamente e não compartilham processo com as rotas que a usam. Toda tarefa de IA entra como trabalho e devolve o resultado por evento ou consulta. A falha ou a lentidão de qualquer provedor nunca derruba a operação.

## Consequências

Positivas: a operação continua mesmo com todos os provedores fora do ar. Negativas: respostas de IA passam a ser assíncronas para o usuário, com aviso de progresso.

## Condições de revisão

Revisar com os números da etapa de medição.
