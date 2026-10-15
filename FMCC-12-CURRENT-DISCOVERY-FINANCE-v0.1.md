# FM CONTROL CENTER — F12 CURRENT DISCOVERY FINANCE

**Baseline certificado:** `main@2a276f4c57577bf0236ae134311705f294d31b21`  
**Branch:** `feat/fmcc-f12-f15-business-operations`  
**PR:** #12 — OPEN/DRAFT  
**Fase:** F12 — Financeiro e Unit Economics  
**Estado:** CURRENT DISCOVERY CONCLUÍDO

## 1. Fatos confirmados

O CURRENT já possui:
- `fmcc_source_definition` tenant-scoped e opcionalmente product-scoped;
- `fmcc_canonical_fact` genérico, tenant/product-scoped, com provenance;
- `fmcc_metric_value` com valor textual decimal, moeda, período/as-of, freshness, quality, sourceAuthority e provenance refs;
- Metric Registry versionado;
- Metric Engine determinístico com soma decimal baseada em `bigint`, sem floating point binário;
- recusa explícita de agregação multi-moeda sem política FX;
- Product Registry canônico;
- Core cognitivo product-aware que recebe apenas métricas registradas e valores governados.

## 2. Receita

Autoridade factual atual: fontes configuradas via Integration Fabric → Canonical Facts → Metric Engine.

Métricas implementadas:
- `billing.gross_billed` ← `billing.invoice`;
- `revenue.cash_collected` ← `payment.settled`.

A distinção entre faturado e recebido já existe. Não há semântica canônica implementada para MRR/ARR.

## 3. Pagamentos

Existe contrato genérico para facts e connector pull/webhook/hybrid, com idempotência por sync execution.  
Não existe provider de pagamento específico conectado no repositório. Portanto:
- não declarar provider real;
- não declarar webhook real;
- não declarar reconciliação financeira real;
- valores permanecem indisponíveis até ingestão autorizada.

## 4. Inadimplência

`receivable.delinquent_amount` existe apenas como target executivo `pending_semantics`.  
Não há CURRENT canônico para due date/status de cobrança/valor vencido. F12 pode definir contrato factual mínimo, mas não produzir valor sem fonte.

## 5. Custos

Não existe fonte real versionada para:
- Render;
- PostgreSQL;
- provider cognitivo;
- storage;
- custos operacionais.

F12 pode definir fact types e métricas governadas para ingestão futura. É proibido hardcodar preços ou presumir faturas externas.

## 6. Margem e resultado

O CURRENT não possui cobertura suficiente hoje para afirmar margem ou lucro/prejuízo.  
É tecnicamente possível construir cálculo determinístico derivado sobre:
- caixa recebido;
- custo de infraestrutura;
- custo operacional;
desde que os três estejam disponíveis, na mesma moeda e em período compatível.

Na ausência de qualquer entrada: `unavailable`.  
Moeda/período incompatível: `incompatible`.

## 7. Unit economics

Não há evidência suficiente para CAC, LTV ou payback.  
ARPU também não deve ser derivado de assinaturas ativas sem regra temporal/populacional aprovada.

Estado: `pending_semantics`.

## 8. Gaps e dependências

- providers financeiros reais;
- fonte de custos;
- regra de inadimplência;
- semântica MRR/ARR;
- regras de unit economics;
- política FX;
- política de arredondamento para percentuais derivados.

## 9. Decisão

F12 será implementada sem novo ledger financeiro paralelo.

Fluxo vigente:
`Source → Integration Fabric → Canonical Facts → Metric Registry/Engine → Financial Intelligence → API/UI/Core`.

Os novos contratos usarão a infraestrutura canônica existente e falharão fechados quando a fonte não existir.
