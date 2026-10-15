# FM Command — External Blockers Final

Data: 2026-10-06
Baseline auditado: `main@370897af04fafe6729dd3f6f22e75337e32f3014`

## Regra

Este documento contém somente bloqueios que não podem ser resolvidos unilateralmente pelo código atual do FM Command sem inventar autoridade, provider, credencial, dado ou decisão de negócio.

Nenhum item abaixo mascara finding interno conhecido.

## Blockers

| Área | Classificação | Estado atual | O que desbloqueia |
|---|---|---|---|
| 8 semânticas executivas | BUSINESS_SEMANTICS_REQUIRED | fail-closed | aprovação humana/corporativa das definições |
| IRON -> Command | UNSUPPORTED / EXTERNAL_BLOCKED | produto cadastrado, sem source | contrato governado + connector + runtime health/sync/provenance |
| CampaIA -> Command | UNSUPPORTED / EXTERNAL_BLOCKED | produto cadastrado, runtime final não homologado | runtime homologado + contrato + connector |
| NFCore -> Command | UNSUPPORTED / EXTERNAL_BLOCKED | produto cadastrado, CURRENT em reconciliação | concluir/publish CURRENT + adapter/connector + homologação |
| Billing/invoices corporativo universal | PROVIDER_DECISION_REQUIRED | Kordena possui boundary próprio; autoridade universal não definida | definir ledger/provider corporativo |
| FinOps | PROVIDER_DECISION_REQUIRED | sem autoridade corporativa | escolher provider/contrato de custos cloud |
| Custos operacionais | PROVIDER_DECISION_REQUIRED | sem autoridade contábil universal | definir sistema/autoridade financeira |
| CRM/leads | PROVIDER_DECISION_REQUIRED | sem provider corporativo | escolher CRM/autoridade comercial |
| Telemetria universal de produto | PROVIDER_DECISION_REQUIRED | contratos parciais por produto | definir contrato/provider por produto |
| Observabilidade consolidada | PROVIDER_DECISION_REQUIRED | health interno existe; provider consolidado não definido | escolher autoridade de observabilidade |
| Suporte/tickets | PROVIDER_DECISION_REQUIRED | sem provider | escolher sistema de suporte |
| Data classification corporativa | POLICY_REQUIRED | controles técnicos existem, taxonomia formal ausente | aprovar política corporativa de classificação |

## Não são blockers internos

Os itens seguintes já foram resolvidos e não permanecem nesta lista:

- branch protection;
- Kordena runtime;
- scheduler runtime;
- onboarding server-side;
- Kordena RBAC;
- navigation RBAC;
- Source Registry guards;
- visual premium;
- viewport 1920x1080;
- capability reachability;
- dependência `source-map-js`;
- dependência `sharp`;
- PRs históricas abertas.

## Comportamento seguro enquanto bloqueado

O FM Command deve:

- exibir `Indisponível` ou `Semântica pendente`;
- não criar source fictícia;
- não inferir provider;
- não criar credencial;
- não converter ausência em zero;
- não promover métrica pendente;
- não afirmar integração `CONNECTED` sem runtime real;
- preservar provenance e autoridade.

## Veredito

```text
INTERNAL_BLOCKERS = 0
EXTERNAL_BLOCKERS = EXPLICIT
FALSE_CONNECTED_CLAIMS = 0
FALSE_METRIC_CLAIMS = 0
```
