# FM CONTROL CENTER — F18 PREMIUM UX/UI

**Fase:** F18 — 93% → 95%  
**Branch:** `feat/fmcc-f16-f19-advanced-intelligence-readiness`  
**Baseline interna:** F17 Gate #237 — SUCCESS  
**Status:** AUDITORIA VISUAL + DESIGN SYSTEM TARGET

## 1. Auditoria visual CURRENT

Pontos positivos:
- aplicação web única;
- dark theme consistente;
- cards e grids responsivos básicos;
- labels nos formulários;
- estados unavailable/pending explícitos;
- Core com voz e feedback;
- fluxos autenticados já funcionais.

Gaps:
- tokens visuais mínimos;
- hierarquia ainda parecida com UI de engenharia/fundação;
- home exibe fase histórica antiga;
- links internos não têm tratamento visual uniforme;
- painéis secundários sem estilo canônico;
- dashboard não resume “o que precisa da minha atenção”;
- Core não oferece atalhos executivos;
- foco visível não é padronizado globalmente;
- reduced motion não está definido;
- mobile precisa de refinamento para ações e cards;
- linguagem técnica pode ganhar hierarquia sem esconder provenance.

## 2. Direção visual

Identidade:
- executiva;
- sóbria;
- premium;
- alta legibilidade;
- tecnologia sem estética de painel genérico;
- superfícies com profundidade controlada;
- tipografia responsiva;
- foco em sinal/decisão/proveniência.

Não alterar:
- contratos;
- APIs;
- semântica;
- segurança;
- tenancy;
- Metric Engine;
- Core authority boundaries.

## 3. Design tokens

Consolidar:
- background layers;
- surface tiers;
- text primary/secondary/subtle;
- borders;
- accent;
- positive/warning/danger/information;
- spacing;
- radii;
- shadows;
- focus ring;
- typography scale;
- content widths.

## 4. Experiência executiva

Dashboard principal deve expor rapidamente:
- alertas ativos;
- cobertura de métricas governadas;
- produtos ativos;
- acesso ao Core;
- módulos Finance/Growth/Operations/Customers;
- inteligência avançada;
- alertas/automações.

Sem criar score geral artificial.

## 5. Core UX

Adicionar:
- atalhos de perguntas executivas;
- feedback de loading;
- evidence block mais legível;
- distinção visual entre resposta e indisponibilidade;
- foco/teclado;
- responsividade;
- voz preservada.

## 6. Alerts UX

Refinar:
- regra;
- severidade;
- ocorrência;
- status;
- ações disponíveis;
- empty states;
- feedback;
- preview sem sugerir execução crítica.

## 7. Responsividade

Breakpoints proporcionais:
- desktop;
- notebook;
- tablet;
- mobile.

Evitar:
- overflow horizontal;
- botões pequenos;
- cards estreitos ilegíveis;
- cabeçalhos quebrados;
- grids rígidos.

## 8. Acessibilidade

Incluir:
- focus-visible global;
- labels existentes preservadas;
- aria-live/status;
- contraste adequado;
- semantic sections;
- control size mínimo;
- reduced motion;
- hover não obrigatório para compreensão;
- keyboard navigation.

## 9. Gate F18

Exigir:
- UI premium consistente;
- nenhuma regressão funcional;
- contratos preservados;
- desktop/tablet/mobile coerentes;
- focus/reduced-motion;
- Core UX;
- alerts UX;
- testes;
- lint/typecheck/build;
- CI;
- Preview visual/funcional.

## 10. Evidência de execução

A F18 evoluiu a mesma aplicação comercial, sem fork e sem segunda UI.

Entregas comprovadas:
- design tokens e superfícies premium;
- experiência executiva com central de atenção;
- refinamento da entrada do produto;
- Core UX refinado;
- Alerts UX refinado;
- grids/cards e ações responsivas;
- focus-visible;
- aria-live/status onde aplicável;
- reduced-motion;
- feedback acessível;
- testes de regressão UI.

Gate de engenharia:
- **Foundation Gate #244 — SUCCESS**
- HEAD certificado: `84f1db731d81e7fb5bf15768b8376d567da73ccd`
- 37 test files PASS;
- 128 tests PASS;
- 0 FAIL;
- lint/typecheck/migrations/build/Docker/dependency audit PASS.

Estado: **IMPLEMENTADA E CERTIFICADA EM CI**.

A validação visual/funcional real do candidate será consolidada no Preview da tranche antes do veredito final.
