# CME-08 — Registro de governança das 8 semânticas executivas pendentes

**Data da reconciliação:** 04/10/2026
**Baseline FM Command:** `main@e18378a38ab712851b4446544860243884a5a2ce`
**Cronograma:** CME-08 — Resolução das 8 Semânticas Executivas Pendentes
**Veredito do bloco:** `EXTERNAL_BLOCKED / BUSINESS_SEMANTICS_REQUIRED`

## 1. Regra de autoridade

Este registro NÃO promove nenhuma métrica para `implemented`.

A ordem de autoridade aplicada foi:

1. CURRENT real do FM Command;
2. ADRs vigentes do FM Command;
3. documentação funcional vigente;
4. CURRENT real do Kordena onde existe fonte candidata;
5. decisões humanas/corporativas ainda necessárias.

O `Metric Registry` e o `Metric Engine` continuam como autoridades factuais do FM Command.
Uma fórmula válida para o produto Kordena não se torna automaticamente a semântica corporativa universal da Nova FM.

Regras preservadas:

- `missing != zero`;
- nenhuma fórmula sem decisão canônica;
- nenhuma soma/conversão multi-moeda sem política FX;
- nenhum denominador implícito;
- nenhum provider vira autoridade apenas por existir;
- nenhuma métrica muda de `pending_semantics` para `implemented` sem aprovação explícita, teste determinístico e provenance.

## 2. Evidências CURRENT

### FM Command

- `src/domain/metrics/registry.ts` mantém exatamente as oito métricas deste registro em `pending_semantics`.
- ADR-007 exige Metric Registry versionado + Metric Engine determinístico e proíbe materializar definição pendente.
- ADR-012 mantém FX como `DEFERRED`; valores financeiros permanecem separados por moeda.

### Kordena — evidência candidata, não aprovação corporativa

CURRENT consultado: `faabio3131/fm-ai-platform`, branch `staging/kordena-premium`.

Arquivos de evidência:

- `application/fmcc_commercial_projection.py`
- `application/commercial_observability.py`

O Kordena exclui contas `internal_test` das projeções comerciais governadas e publica provenance/source authority para as métricas que calcula.

## 3. Resumo executivo

| Métrica | CURRENT | Evidência candidata | Pendência para promoção |
|---|---|---|---|
| `trial.active.count` | `pending_semantics` | Kordena possui critério determinístico de trial ativo | Aprovação corporativa da definição |
| `trial.conversion.rate` | `pending_semantics` | Kordena possui coorte rolling 30d + denominador explícito | Aprovação corporativa de coorte/janela |
| `subscription.logo_churn.rate` | `pending_semantics` | Kordena possui gross logo churn 30d reconstruído por eventos | Aprovação corporativa de churn |
| `revenue.mrr` | `pending_semantics` | Kordena possui MRR contratual por moeda | Aprovação corporativa de elegibilidade e autoridade financeira |
| `revenue.arr` | `pending_semantics` | Kordena possui ARR contratual por moeda | Aprovação corporativa de derivação/elegibilidade |
| `finance.operating_result` | `pending_semantics` | Nenhuma definição corporativa suficiente localizada | Autoridade contábil + fórmula |
| `finance.operating_margin.rate` | `pending_semantics` | Nenhuma definição corporativa suficiente localizada | Autoridade contábil + denominador |
| `service.error.rate` | `pending_semantics` | Existe `service.error.count`, mas não taxa canônica | Autoridade de observabilidade + denominador/janela |

---

## 4. `trial.active.count`

**ID:** `trial.active.count`
**Versão canônica:** não atribuída; decisão pendente
**Status:** `EXTERNAL_BLOCKED / BUSINESS_SEMANTICS_REQUIRED`

- **Pergunta empresarial:** ainda não aprovada formalmente como contrato corporativo.
- **Fórmula candidata Kordena:** contar trials não-`internal_test` com `status == active`, `ends_at` presente e `ends_at > as_of`.
- **Unidade candidata:** count.
- **Moeda:** não aplicável.
- **Período/grain candidato:** estado atual em `as_of`.
- **Timezone candidato:** UTC no boundary Kordena.
- **Dimensões corporativas:** pendentes de aprovação.
- **Inclusões candidatas:** trials comerciais externos ativos.
- **Exclusões candidatas:** `internal_test`; trials expirados/revogados/inativos.
- **Coorte/denominador:** não aplicável à contagem; população corporativa ainda precisa ser aprovada.
- **Cancelamentos/refunds:** não aplicável.
- **Fonte candidata:** Kordena `fm_commercial_platform` para o produto Kordena; autoridade corporativa multi-produto ainda não definida.
- **Freshness/quality:** source-governed; contrato corporativo pendente.
- **Proveniência candidata:** `fm_commercial_trials_v1` + `fm_customers_v1`.
- **FX:** não aplicável.
- **Ausente:** nunca converter ausência em zero.
- **Autoridade de aprovação:** decisão humana de negócio da Nova FM ainda requerida.

## 5. `trial.conversion.rate`

**ID:** `trial.conversion.rate`
**Versão canônica:** não atribuída; decisão pendente
**Status:** `EXTERNAL_BLOCKED / BUSINESS_SEMANTICS_REQUIRED`

- **Pergunta empresarial:** ainda não aprovada formalmente como contrato corporativo.
- **Fórmula candidata Kordena:** trials iniciados na coorte rolling de 30 dias que possuem `converted_at <= as_of` / total de trials iniciados na mesma coorte × 100.
- **Unidade candidata:** percent.
- **Moeda:** não aplicável.
- **Período candidato:** rolling 30 dias.
- **Timezone candidato:** UTC.
- **Dimensões corporativas:** pendentes.
- **Inclusões candidatas:** trials não-`internal_test` iniciados dentro da janela.
- **Exclusões candidatas:** `internal_test`.
- **Coorte/denominador candidato:** trials cujo `started_at` pertence à janela rolling de 30 dias.
- **Cancelamentos/refunds:** não aplicável.
- **Fonte candidata:** Kordena `fm_commercial_platform` apenas para Kordena.
- **Freshness/quality:** source-governed; Kordena marca valor calculável como verified.
- **Proveniência candidata:** `fm_commercial_trials_v1` + `fm_customers_v1`.
- **FX:** não aplicável.
- **Ausente:** coorte vazia => `unavailable`, nunca 0%.
- **Autoridade de aprovação:** decisão humana corporativa sobre coorte/janela ainda requerida.

## 6. `subscription.logo_churn.rate`

**ID:** `subscription.logo_churn.rate`
**Versão canônica:** não atribuída; decisão pendente
**Status:** `EXTERNAL_BLOCKED / BUSINESS_SEMANTICS_REQUIRED`

- **Pergunta empresarial:** ainda não aprovada formalmente.
- **Fórmula candidata Kordena:** gross logo churn de 30 dias = assinaturas que estavam ativas imediatamente antes da janela e emitiram `subscription.canceled` durante a janela / base ativa inicial × 100.
- **Unidade candidata:** percent.
- **Moeda:** não aplicável.
- **Período candidato:** rolling 30 dias.
- **Timezone candidato:** UTC.
- **Dimensões corporativas:** pendentes.
- **Inclusões candidatas:** base ativa reconstruída por eventos canônicos.
- **Exclusões candidatas:** clientes `internal_test`.
- **Coorte/denominador candidato:** base de subscriptions ativas imediatamente antes do início da janela.
- **Cancelamentos:** evento `subscription.canceled` dentro da janela.
- **Refunds:** não fazem parte da fórmula candidata de logo churn.
- **Fonte candidata:** Kordena `fm_commercial_platform` / commercial outbox para Kordena.
- **Freshness/quality:** reconciled quando calculável.
- **Proveniência candidata:** `fm_commercial_outbox_v1` + `fm_customers_v1`.
- **FX:** não aplicável.
- **Ausente:** base inicial vazia => `unavailable`, nunca 0%.
- **Autoridade de aprovação:** decisão humana corporativa de churn ainda requerida.

## 7. `revenue.mrr`

**ID:** `revenue.mrr`
**Versão canônica:** não atribuída; decisão pendente
**Status:** `EXTERNAL_BLOCKED / BUSINESS_SEMANTICS_REQUIRED`

- **Pergunta empresarial:** deve representar receita recorrente contratada mensal, sem confundir com faturamento, caixa ou reconhecimento contábil; contrato corporativo ainda pendente.
- **Fórmula candidata Kordena:** subscriptions atuais em `active`; período mensal => `contracted_amount` integral; período anual => `contracted_amount / 12`.
- **Unidade candidata:** currency_per_month.
- **Moeda:** valores separados por moeda.
- **Período/grain candidato:** estado contratual atual em `as_of`.
- **Timezone candidato:** UTC.
- **Dimensões candidatas:** currency; demais dimensões corporativas pendentes.
- **Inclusões candidatas:** subscriptions ativas com períodos mensais/anuais suportados.
- **Exclusões candidatas:** `internal_test`; períodos de billing não suportados são excluídos explicitamente e degradam quality para partial.
- **Coorte/denominador:** não aplicável.
- **Cancelamentos:** subscription não ativa não entra na fórmula candidata.
- **Refunds:** não são usados para MRR contratual na fórmula candidata; política corporativa precisa confirmar.
- **Fonte candidata:** Kordena `fm_commercial_platform` para o produto Kordena.
- **Freshness/quality:** verified quando todos os períodos ativos são suportados; partial quando há período não suportado.
- **Proveniência candidata:** `fm_commercial_subscriptions_v1` + `fm_customers_v1`.
- **FX:** ADR-012 proíbe conversão automática; moedas permanecem separadas.
- **Ausente:** ausência de fonte/contrato não vira 0.
- **Autoridade de aprovação:** negócio + autoridade financeira corporativa ainda requeridos.

## 8. `revenue.arr`

**ID:** `revenue.arr`
**Versão canônica:** não atribuída; decisão pendente
**Status:** `EXTERNAL_BLOCKED / BUSINESS_SEMANTICS_REQUIRED`

- **Pergunta empresarial:** contrato corporativo de receita recorrente anual ainda pendente.
- **Fórmula candidata Kordena:** subscriptions atuais em `active`; período mensal => `contracted_amount × 12`; período anual => `contracted_amount` integral.
- **Unidade candidata:** currency_per_year.
- **Moeda:** separada por moeda.
- **Período/grain candidato:** estado contratual atual em `as_of`.
- **Timezone candidato:** UTC.
- **Dimensões candidatas:** currency.
- **Inclusões/exclusões:** mesmas fronteiras candidatas do MRR.
- **Coorte/denominador:** não aplicável.
- **Cancelamentos/refunds:** política corporativa ainda deve validar elegibilidade; fórmula Kordena usa apenas subscriptions ativas.
- **Fonte candidata:** Kordena `fm_commercial_platform` para Kordena.
- **Freshness/quality:** mesma política candidata do MRR.
- **Proveniência candidata:** `fm_commercial_subscriptions_v1` + `fm_customers_v1`.
- **FX:** sem conversão automática conforme ADR-012.
- **Ausente:** ausência não vira 0.
- **Autoridade de aprovação:** negócio + autoridade financeira corporativa ainda requeridos.

## 9. `finance.operating_result`

**ID:** `finance.operating_result`
**Versão canônica:** não atribuída
**Status:** `EXTERNAL_BLOCKED / BUSINESS_SEMANTICS_REQUIRED`

- **Pergunta empresarial:** não aprovada.
- **Fórmula:** não definida canonicamente.
- **Unidade/moeda:** pendentes.
- **Período/timezone:** pendentes.
- **Dimensões:** pendentes.
- **Inclusões/exclusões:** pendentes; não é autorizado assumir receita menos custos existentes como “lucro”.
- **Coorte/denominador:** não aplicável.
- **Cancelamentos/refunds:** tratamento pendente.
- **Fonte autoritativa:** autoridade contábil/financeira corporativa não identificada.
- **Freshness/quality:** pendentes.
- **Proveniência:** pendente.
- **FX:** ADR-012 continua `DEFERRED`.
- **Ausente:** indisponível/pending; nunca zero.
- **Autoridade de aprovação:** autoridade contábil/financeira humana requerida.

## 10. `finance.operating_margin.rate`

**ID:** `finance.operating_margin.rate`
**Versão canônica:** não atribuída
**Status:** `EXTERNAL_BLOCKED / BUSINESS_SEMANTICS_REQUIRED`

- **Pergunta empresarial:** não aprovada.
- **Fórmula:** não definida; numerador e denominador não podem ser inferidos.
- **Unidade candidata:** percent, ainda não promovida.
- **Moeda:** depende do contrato do numerador/denominador e política FX.
- **Período/timezone:** pendentes.
- **Dimensões:** pendentes.
- **Inclusões/exclusões:** pendentes.
- **Coorte/denominador:** denominador corporativo não definido.
- **Cancelamentos/refunds:** pendentes.
- **Fonte autoritativa:** autoridade contábil/financeira não identificada.
- **Freshness/quality/proveniência:** pendentes.
- **FX:** ADR-012 `DEFERRED`.
- **Ausente:** indisponível/pending; nunca 0%.
- **Autoridade de aprovação:** autoridade contábil/financeira humana requerida.

## 11. `service.error.rate`

**ID:** `service.error.rate`
**Versão canônica:** não atribuída
**Status:** `EXTERNAL_BLOCKED / BUSINESS_SEMANTICS_REQUIRED`

- **Pergunta empresarial:** não aprovada.
- **Fórmula:** não definida.
- **Numerador disponível parcialmente:** o FM Command já possui `service.error.count`, mas isso não define a taxa.
- **Denominador:** não definido.
- **Unidade candidata:** percent/rate, ainda não promovida.
- **Período/timezone:** não definidos.
- **Serviço/escopo:** não definido.
- **Dimensões:** pendentes.
- **Inclusões/exclusões:** pendentes.
- **Fonte autoritativa:** observabilidade corporativa consolidada ainda não definida.
- **Freshness/quality/proveniência:** dependem da autoridade de observabilidade.
- **FX:** não aplicável.
- **Ausente:** indisponível/pending; nunca 0%.
- **Autoridade de aprovação:** autoridade operacional/observabilidade humana requerida.

## 12. Decisão de gate CME-08

Após revalidar CURRENT, ADRs e Kordena:

- nenhuma das oito possui aprovação corporativa completa suficiente para promoção;
- cinco possuem **semântica candidata específica do Kordena**, preservada como evidência;
- três continuam sem definição suficiente;
- o código deve continuar fail-closed em `pending_semantics`;
- nenhuma alteração no Metric Engine é autorizada neste bloco;
- nenhuma conversão FX é autorizada;
- nenhuma métrica deve receber valor sintético para “fechar” o cronograma.

**Resultado formal:**

```text
CME-08
INTERNAL_RECONCILIATION = PASS
SEMANTIC_PROMOTION = EXTERNAL_BLOCKED
BLOCKER = BUSINESS_SEMANTICS_REQUIRED
```

Este blocker não impede a continuidade dos itens internamente resolvíveis do Cronograma Mestre. O próximo item é **CME-09 — Fontes e Providers Corporativos**.
