# ADR-018 — Fila de trabalho do core

**Status:** PROPOSED
**Data:** 15/10/2026
**Autoridade:** FM Solution Architect, aguardando aprovação do Diretor Executivo
**Produto:** FM Command V2
**Revisa:** ADR-011 (DEFERRED)

## Contexto

O ADR-011 adiou a fila geral até haver requisito concreto de latência, volume ou repetição assíncrona. A V1 já tem uma fila no banco no faturamento (SKIP LOCKED, posse por prazo, número de tentativas). O ADR-016 passa as tarefas de IA para fora do caminho da operação, o que cria esse requisito.

## Decisão

Introduzir uma fila de trabalho para tarefas do core, com prioridade, prazo, limite por cliente, repetição executada por worker e ordenação por cliente. A implementação parte do padrão no banco já usado no faturamento, sem novo serviço de infraestrutura. A decisão só vira ACCEPTED depois da etapa de medição, que deve mostrar se esse padrão basta para o volume esperado.

## Consequências

Positivas: tarefas não se perdem e o pico não vira espera cega. Negativas: mais um componente para operar, e um limite de escala do banco a ser medido.

## Condições de revisão

Se a medição mostrar que o banco não sustenta o volume, avaliar um serviço de fila dedicado.
