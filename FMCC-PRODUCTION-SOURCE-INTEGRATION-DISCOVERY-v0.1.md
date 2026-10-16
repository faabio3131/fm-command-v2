# FMCC — Production Source Integration Discovery v0.3

Status: CURRENT DISCOVERY RECONCILIADO — GOVERNED / NÃO HOMOLOGADO EM PRODUÇÃO

Baseline histórica integrada antes da F21:
`main@e6d6e9b33f126d210651a4adbb3ed14ed12b0492`

Branch histórica de execução F21:
`feat/fmcc-f21-readiness-pre-premium-final`

F20:
- PR #22 MERGED/CLOSED;
- Foundation Gate #434 SUCCESS;
- Preview Deployment Gate #3 SUCCESS no SHA exato da main.

Current Kordena KCA-13:
- PR `faabio3131/fm-ai-platform#130`: MERGED;
- merge commit: `05c65c16ef380158b4602780511a9997e08cb5bb`;
- candidate final reportado: `72cb89feadc2930bf08a22d57edd31afc9bb7c54`;
- target branch Kordena: `staging/kordena-premium`;
- Kordena Commercial Gate: SUCCESS;
- WP-031 Master Gate: SUCCESS;
- WP-031L Regression Channel Parity: SUCCESS;
- Commercial Runtime Readiness V1: SUCCESS.

Preview FMCC — evidência histórica pré-F21:
- Render Preview source: `e6d6e9b`;
- exact SHA automation: PASS;
- branch: `main`;
- health: PASS;
- readiness: PASS;
- unauthenticated dashboard protection: PASS.

Fechamento F21 posterior:
- PR #23 MERGED/CLOSED em `edb5b872587c02ee41824dc9f593d9cf0d7c4ea2`;
- Foundation #442 SUCCESS;
- F21 Readiness #8 SUCCESS;
- Preview Deployment #4 attempt 2 SUCCESS no SHA exato;
- health/readiness/auth protection — PASS.

Nomenclatura comercial posterior:
- **FM Command** adotado como nome comercial oficial;
- PR #24 MERGED/CLOSED;
- `main@c7bfca5ab77034a3376bb34434afc20a7c971423` homologada no Preview pelo Deployment Gate #5 attempt 2.

F21:
- candidate pré-documental `9f7a59072e75d9d3a5d3824e6a3ec12d2d9cc859`;
- Foundation #436 SUCCESS;
- Cognitive #111 SUCCESS;
- F21 Readiness #2 SUCCESS;
- exact final documentation HEAD Preview: SATISFEITO posteriormente pelo Preview Deployment #4 attempt 2 no merge SHA de F21.

## Objetivo

Mapear o que já possui autoridade/fonte real, o que está tecnicamente pronto para conexão e o que continua bloqueado por semântica, provider, credencial ou decisão empresarial.

Este documento NÃO converte observabilidade read-only em fato canônico do Metric Engine.

## Regras

- SOURCE AUTHORITY → Integration Fabric → Canonical Facts → Metric Registry → Metric Engine → Intelligence → Core.
- Missing != zero.
- Observability/read model != canonical fact.
- Snapshot aggregate != canonical event fact.
- Métrica somente pode ser marcada CONNECTED no Metric Engine quando existir:
  1. autoridade real;
  2. source real registrada;
  3. autenticação válida;
  4. health/sync comprovados;
  5. fato canônico compatível;
  6. proveniência;
  7. semântica aprovada;
  8. cálculo determinístico;
  9. evidência de execução no ambiente homologado.
- Credencial inexistente = EXTERNAL_BLOCKER.
- Semântica pendente = SEMANTICS_PENDING.
- Provider não escolhido = PROVIDER_UNDECIDED.
- Observabilidade disponível pode alimentar UI/Core read-only sem automaticamente satisfazer o Metric Engine.

## Fonte real descoberta — Kordena Commercial Control Plane

Boundary governado:
`/v1/control-plane/fmcc`

Autoridade:
Kordena Commercial Platform.

Acesso:
HTTP governado; FMCC não lê/escreve diretamente o banco operacional do Kordena.

Fatos canônicos atualmente publicados pelo snapshot comercial:
- `customer.created`
- `trial.started`
- `trial.converted`
- `trial.expired`
- `subscription.activated`
- `subscription.cancelled`
- `payment.settled`
- `payment.failed`
- `entitlement.changed`

KCA-13 adiciona observabilidade/read model governado:
- signup_started
- signup_completed
- tenant_provisioned
- trial_started
- trial_active
- trial_expiring
- trial_expired
- trial_converted
- conversion_rate
- subscription_active
- past_due
- churn
- mrr
- arr
- payment_success
- payment_failure
- antiabuse
- health
- finops
- alerts
- tracing
- coverage

Regras KCA-13 validadas no FMCC:
- schema version `kordena.observability.kca13.v1`;
- INTERNAL_TEST excluído;
- provenance_refs não vazios;
- source_authority não vazio;
- definition não vazia;
- alertas determinísticos bem formados;
- tracing exige correlation ID governado;
- coverage explícito;
- contrato inválido → fail-closed;
- ausência → indisponível, nunca zero inventado;
- Core consome a capability como read-only.

## Matriz das 24 métricas executivas

| metric_id | Semântica FMCC | Contrato necessário | Fonte/observabilidade descoberta | Status CURRENT | Observação |
|---|---|---|---|---|---|
| trial.starts.count | implemented | fact `trial.started` | Kordena fact | READY_TO_CONNECT | Fato canônico compatível. Falta source/runtime real e sync homologado. |
| trial.active.count | pending_semantics | definição as-of aprovada | KCA-13 `trial_active` | SEMANTICS_PENDING | Read model existe, mas Metric Registry não possui definição canônica final. |
| trial.conversion.rate | pending_semantics | coorte + janela + população | KCA-13 `conversion_rate` | SEMANTICS_PENDING | Read model governado disponível; não promover ao Metric Engine sem semântica oficial. |
| subscription.active.count | implemented | fact `subscription.active` | KCA-13 `subscription_active`; snapshot publica `subscription.activated` | SEMANTICS_PENDING | Evento activated não equivale a estado ativo as-of. |
| subscription.cancelled.count | implemented | fact `subscription.cancelled` | Kordena fact | READY_TO_CONNECT | Fato compatível. Falta runtime/source/sync real. |
| subscription.logo_churn.rate | pending_semantics | coorte + janela + denominador | KCA-13 `churn` | SEMANTICS_PENDING | KCA-13 resolve read model, não o contrato canônico do Metric Engine. |
| revenue.mrr | pending_semantics | definição MRR aprovada | KCA-13 `mrr` por moeda | SEMANTICS_PENDING | Disponível para leitura governada; sem FX inventado. Registry continua pendente. |
| revenue.arr | pending_semantics | definição ARR aprovada | KCA-13 `arr` por moeda | SEMANTICS_PENDING | Disponível para leitura governada; Registry continua pendente. |
| billing.gross_billed | implemented | fact `billing.invoice` | Nenhuma fonte canônica compatível | PROVIDER_UNDECIDED | Kordena atual não publica billing.invoice. |
| revenue.cash_collected | implemented | fact `payment.settled` | Kordena fact | READY_TO_CONNECT | Fato compatível com amount/currency. |
| receivable.delinquent_amount | implemented | fact `receivable.delinquent` | KCA-13 `past_due` é observabilidade, não valor monetário canônico | PROVIDER_UNDECIDED | Ainda falta autoridade de inadimplência monetária. |
| cost.infrastructure.total | implemented | fact `cost.infrastructure` | KCA-13 declara infra FinOps unavailable | PROVIDER_UNDECIDED | Não estimar custo de infraestrutura. |
| cost.operating.total | implemented | fact `cost.operating` | Nenhuma fonte aprovada | PROVIDER_UNDECIDED | Necessita fonte financeira/operacional real. |
| finance.operating_result | pending_semantics | composição financeira oficial | Serviços F12 existem | ARCHITECTURAL_RECONCILIATION | Registry executivo continua pendente. |
| finance.operating_margin.rate | pending_semantics | fórmula/base aprovada | Nenhuma | SEMANTICS_PENDING | Não inferir fórmula silenciosamente. |
| lead.created.count | implemented | fact `lead.created` | Nenhum CRM aprovado | PROVIDER_UNDECIDED | Não inventar CRM/attribution. |
| incident.count | implemented | fact `incident.opened` | KCA-13 health/alerts são read model | PROVIDER_UNDECIDED | Health/alert != incidente canônico. |
| job.failure.count | implemented | fact `job.failed` | Scheduler/CI existem, sem source authority canônica aprovada | READY_FOR_INTERNAL_ADAPTER | F21 investigou o boundary; não existe autoridade interna aprovada que permita criar canonical facts silenciosamente. |
| integration.failure.count | implemented | fact `integration.failed` | ConnectorRuntime existe, sem source authority canônica aprovada | READY_FOR_INTERNAL_ADAPTER | F21 investigou o boundary; criar a source authority sem decisão explícita seria fabricação de autoridade. |
| service.error.count | implemented | fact `service.error` | Logs/health existem, sem fonte canônica aprovada | PROVIDER_UNDECIDED | Log genérico não vira fato automaticamente. |
| service.error.rate | pending_semantics | população + janela | Nenhuma | SEMANTICS_PENDING | Exige denominador e janela. |
| usage.active_users.dau | implemented | fact `usage.active_user.day` | Nenhuma telemetria SaaS canônica conectada | PROVIDER_UNDECIDED | Cada SaaS deve emitir fato governado. |
| usage.engagement.events | implemented | fact `usage.engagement_event` | Nenhuma telemetria SaaS canônica conectada | PROVIDER_UNDECIDED | Não inferir de logs. |
| support.ticket.open.count | implemented | fact `support.ticket.opened` | KCA-13 coverage externo | PROVIDER_UNDECIDED | Necessita fonte de suporte real. |

## Cobertura Kordena disponível para UI/Core

O KCA-13 pode alimentar leitura governada no painel Kordena e no Core para:
- cadastros iniciados/concluídos;
- organizações provisionadas;
- trials;
- conversão;
- assinaturas;
- past due;
- churn;
- MRR/ARR por moeda;
- pagamentos;
- health;
- alertas;
- tracing;
- AI FinOps existente;
- coverage explícito.

Isso NÃO altera silenciosamente o estado semântico do Metric Registry.

## Configuração runtime FMCC necessária para Kordena

Confirmado no CURRENT do código:

- `FMCC_KORDENA_CONTROL_TENANT_ID`
- `FMCC_KORDENA_ALLOWED_ORIGINS`
- `FMCC_KORDENA_CONTROL_PLANE_TOKEN`

A source deve usar exatamente:
`env:FMCC_KORDENA_CONTROL_PLANE_TOKEN`

O valor real:
- não pertence ao repositório;
- não pertence à config JSON da source;
- não pode aparecer em logs;
- não pode aparecer no browser;
- não pode aparecer no Audit Ledger.

## Scheduler de Alertas

CURRENT de aplicação:
`FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET`

CURRENT do workflow:
- `FMCC_AUTOMATION_BASE_URL` como repository/environment variable;
- `FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET` como secret.

Status:
**READY_TO_CONFIGURE / EXTERNAL_BLOCKER**

Sem os valores de runtime:
- workflow permanece fail-closed;
- nenhuma execução agendada real é declarada ativa;
- nenhuma execução simulada é aceita como evidência.

## Status operacional das fontes

### Kordena

Arquitetura/contrato: CERTIFIED.

Preview FMCC: CERTIFIED no SHA exato.

Kordena KCA-13: MERGED e gates verdes.

Integração real FMCC ↔ Kordena:
**READY_TO_CONNECT / EXTERNAL_BLOCKER**

Ainda falta evidência real de:
1. tenant de controle configurado;
2. origin allowlist configurada;
3. segredo compartilhado configurado em ambos os runtimes;
4. source real cadastrada no tenant correto;
5. health real;
6. sync real;
7. canonical facts persistidos;
8. provenance persistida;
9. Metric Engine recompute das métricas compatíveis;
10. Core/UI comparados contra os mesmos dados reais.

### Outros domínios

Ainda sem provider/authority empresarial aprovada:
- billing invoices;
- inadimplência monetária;
- FinOps infraestrutura;
- custos operacionais;
- CRM/leads;
- incidentes;
- job telemetry canônica;
- integration failure facts;
- service error facts;
- usage/engagement;
- suporte.

Status:
**PROVIDER_UNDECIDED** ou **SEMANTICS_PENDING**, conforme a matriz.

## Reconciliation F21

A F21 confirmou que os blockers de source/semântica permanecem externos ou de autoridade, não defeitos a serem mascarados por código.

Especificamente:
- Kordena permanece READY_TO_CONNECT / CREDENTIAL_REQUIRED até runtime real;
- scheduler permanece READY_TO_CONFIGURE / RUNTIME_SECRET_REQUIRED;
- providers empresariais não escolhidos permanecem PROVIDER_UNDECIDED;
- métricas sem contrato canônico permanecem SEMANTICS_PENDING;
- os dois candidatos a internal adapter não foram promovidos porque o CURRENT não define source authority canônica interna aprovada;
- missing continua diferente de zero;
- read model continua diferente de canonical fact.

Nenhum status CONNECTED foi promovido sem evidence real.

## Critério histórico pré-F20

A tranche funcional pode seguir para auditoria independente quando:
- CURRENT pós-merge estiver verde;
- Preview SHA exato estiver comprovado;
- Source Coverage estiver reconciliada;
- blockers externos estiverem explicitamente classificados;
- nenhuma source não homologada for chamada de CONNECTED;
- nenhuma métrica read-only for promovida indevidamente a Metric Engine.

Esses critérios estão atendidos documentalmente neste v0.3.

## External blockers a carregar para F20/F21

1. Kordena runtime real FMCC.
2. Scheduler runtime real.
3. Providers empresariais ainda não escolhidos para domínios listados.
4. Semânticas executivas ainda `pending_semantics`.

Esses blockers não podem ser “corrigidos” por implementação silenciosa.

## Veredito pré-auditoria

**FINAL FUNCTIONAL TRANCHE CERTIFIED — READY FOR AUDIT**

Com a ressalva:
- produção não autorizada;
- sources externas ainda não homologadas como CONNECTED;
- blockers acima devem permanecer visíveis em F20/F21 e no release candidate.


## Veredito F21 de source coverage

**SOURCE COVERAGE RECONCILED — NO FABRICATION**

O fechamento técnico F21 não depende de converter blockers externos em dados fictícios. Eles permanecem explicitamente carregados para a tranche Final Visual Premium / Audit final / release readiness e devem ser resolvidos somente quando as respectivas credenciais, decisões de provider ou semânticas empresariais forem fornecidas pela autoridade competente.
