# ADR-015 — V2: core próprio do produto, fundação compartilhada por contratos

**Status:** PROPOSED
**Data:** 15/10/2026
**Autoridade:** FM Solution Architect, aguardando aprovação do Diretor Executivo
**Produto:** FM Command V2
**Relacionado:** ADR-013, EXCEPTION-001

## Contexto

O Core Base (Python) é uma cópia isolada do fm-ai-platform, criada para evoluir o core antes de os produtos o adotarem. O Command V2 é TypeScript e, pelo ADR-013, possui o seu core cognitivo com ciclo de vida próprio. Uma recomendação inicial de usar o Core Base como serviço único chamado por API por todos os produtos contraria o ADR-013 e foi descartada.

## Decisão

A V2 mantém o core cognitivo próprio do produto, no repositório e no ciclo de vida da V2. O que é compartilhado com o Core Base é a fundação permitida pelo ADR-013: contratos, padrões, adaptadores, observabilidade, segurança e avaliação. Os contratos mantidos iguais nos dois lados são o formato de tarefa na fila, a política de roteamento, a resposta tipada de decisão e o evento de uso e custo por chamada de IA.

## Consequências

Positivas: nenhum acoplamento de versão, disponibilidade ou custo entre produtos. Negativas: os mesmos contratos são implementados duas vezes, em TypeScript e em Python.

## Riscos e mitigação

Divergência entre as duas implementações. Mitigação: contratos escritos como esquemas versionados e testes de conformidade nos dois lados.

## Condições de revisão

Se um produto Python da FM precisar do mesmo core que o Core Base, avaliar uma biblioteca Python compartilhada só entre produtos Python.
