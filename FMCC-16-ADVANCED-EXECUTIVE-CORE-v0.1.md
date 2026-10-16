# FM CONTROL CENTER — F16 CORE EXECUTIVO AVANÇADO

**Fase:** F16 — 88% → 91%  
**Branch:** `feat/fmcc-f16-f19-advanced-intelligence-readiness`  
**Baseline:** `main@9632dd3871790a8b709fa5bc11211b9649b943fa`  
**Status:** CURRENT DISCOVERY + SYSTEM DESIGN

## 1. CURRENT confirmado

O CURRENT já possui:
- FMCC Cognitive Vertical Core com planejamento por catálogo autorizado;
- Core Gateway tenant/product scoped;
- Metric Registry e Metric Engine como autoridade factual;
- `MetricService.query()` e histórico recente por produto;
- Product Intelligence com comparação temporal determinística;
- Financial, Growth, Operations e Customer Intelligence;
- Provenance em MetricView;
- Audit Ledger e auditoria de consultas do Core;
- fail-closed quando não existe valor governado;
- Render Preview homologado até F15.

O CURRENT não possui:
- contrato próprio de Executive Analysis;
- composição determinística multi-domínio;
- semântica canônica de anomalia;
- semântica canônica de risco;
- forecast engine;
- score executivo mágico;
- threshold empresarial aprovado para classificar severidade;
- série temporal suficiente comprovada para previsões reais.

## 2. Decisão F16

F16 evoluirá incrementalmente a arquitetura existente:

`Metric Registry/Engine → Executive Analysis Service → API/UI → Core`

Nenhum cálculo determinístico será delegado ao LLM.

O Core continuará responsável apenas por interpretação, contextualização, correlação textual e recomendação baseada em fatos/evidências recebidos.

## 3. Advanced Analysis Contract

Cada sinal deve carregar:
- `metricId`;
- `productId/productSlug` quando aplicável;
- estado;
- valor atual;
- valor anterior quando disponível;
- delta determinístico quando compatível;
- unidade/moeda;
- período/as-of;
- freshness;
- quality;
- provenance;
- classificação epistemológica.

Classificações:
- `fact`;
- `inference`;
- `recommendation`;
- `forecast`;
- `unavailable`.

## 4. Variação

Variação só existe quando:
- dois valores governados estão disponíveis;
- unidade é compatível;
- moeda é compatível;
- as referências temporais são distintas;
- valores são decimais válidos.

A camada determinística pode calcular:
- direção: increased/decreased/unchanged;
- delta absoluto textual exato;
- período atual/anterior.

Percentual só será calculado se a política de denominador/arredondamento estiver explicitamente definida. Até lá, não inferir.

## 5. Correlação

Correlação nesta fase significa somente composição conjunta de múltiplos fatos governados para análise cognitiva.

Não significa causalidade estatística.

O Core não pode afirmar causa sem evidência explícita.

## 6. Anomalia

Sem baseline, janela temporal e threshold aprovados:
- `anomaly.status = insufficient_evidence`.

F16 não cria threshold arbitrário.

## 7. Risco

Sem política de risco aprovada:
- `risk.status = insufficient_evidence`.

O Core pode descrever sinais factuais, mas não inventar score ou classe de risco.

## 8. Recomendações

Recomendações devem:
- referenciar evidências;
- separar fato de interpretação;
- não executar ação;
- não alterar autoridade determinística;
- ser auditáveis.

## 9. Forecast

Forecast exige:
- série temporal suficiente;
- granularidade compatível;
- qualidade conhecida;
- horizonte definido;
- método documentado;
- representação de incerteza.

Enquanto essas condições não estiverem comprovadas:
- `forecast.status = insufficient_evidence`;
- nenhum número previsto é produzido.

## 10. Tenant/Product scope

- tenant vem de identidade/autorização server-side;
- produtos são resolvidos pelo Product Registry do tenant;
- slug não autorizado falha fechado;
- nenhuma análise mistura tenants;
- comparação multi-produto preserva evidence por produto.

## 11. Provenance

Toda saída factual/derivada preserva a união das `provenanceRefs` utilizadas.

Ausência de provenance suficiente impede promoção do resultado a fato governado.

## 12. API/UI

Criar superfície executiva avançada proporcional para:
- resumo de sinais disponíveis;
- variações governadas;
- anomalia: estado/insuficiência;
- risco: estado/insuficiência;
- forecast: estado/insuficiência;
- proveniência;
- estados unavailable/pending.

Nenhuma interface deve esconder incerteza.

## 13. Core

O Core poderá consumir Analysis Evidence Packs governados.

Se nenhum fato estiver disponível:
- responder indisponibilidade;
- não chamar síntese factual como se houvesse dados.

Se houver fatos parciais:
- deixar explícito que a análise é parcial;
- não completar lacunas com suposição.

## 14. Segurança e auditoria

- `metric:read` continua requisito mínimo;
- tenant/product scopes server-side;
- consultas avançadas auditadas;
- nenhum secret/PII em prompts ou respostas;
- provider failure permanece fail-closed.

## 15. Gate F16

Exigir:
- unit tests;
- multi-metric grounding;
- multi-domain composition;
- tenant/product isolation;
- period/currency compatibility;
- missing/pending semantics;
- provenance;
- no-fabrication;
- anomaly/risk/forecast fail-closed;
- malformed/provider failure;
- audit;
- lint;
- typecheck;
- build;
- CI;
- Preview proporcional.

## 16. Evidência de execução

Implementação realizada na PR #15 sobre a baseline certificada da `main`.

Entregas comprovadas:
- Executive Analysis Service governado;
- composição multi-domínio a partir do Metric Engine;
- variação determinística compatível;
- correlação tratada como composição de evidências, nunca causalidade automática;
- anomaly/risk/forecast em `insufficient_evidence` sem contratos suficientes;
- API `/api/intelligence/executive`;
- UI `/dashboard/intelligence`;
- auditoria e guardrails epistemológicos;
- nenhum cálculo determinístico delegado ao LLM.

Gate de engenharia:
- **Foundation Gate #228 — SUCCESS**
- HEAD certificado: `7b37af8190da9571db19d20f971d5f0dccc8a127`
- 33 test files PASS;
- 115 tests PASS;
- 0 FAIL;
- lint/typecheck/migrations/build/Docker/dependency audit PASS.

Estado: **IMPLEMENTADA E CERTIFICADA EM CI**.

A homologação visual/funcional do candidate da tranche permanece consolidada no gate de Preview F16–F19.
