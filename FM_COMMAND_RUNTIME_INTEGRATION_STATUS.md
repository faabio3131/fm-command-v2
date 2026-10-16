# FM Command — Runtime Integration Status

Data: 2026-10-06
Baseline auditado: `main@370897af04fafe6729dd3f6f22e75337e32f3014`

## Preview do Command

- Render service: `fmcc-preview-web`
- deploy: `dep-db2hbbc9v7es73c64jpg`
- status: `live`
- SHA: `370897af04fafe6729dd3f6f22e75337e32f3014`
- version: exact SHA
- health: ok
- readiness: ready

## Tenant Nova FM Tecnologia

| Produto | Registry | Source no Command | Connector | Estado de integração |
|---|---|---|---|---|
| Kordena | ativo | Kordena Commercial | KordenaCommercialConnector | CONNECTED |
| IRON | ativo | nenhuma | nenhum | UNSUPPORTED / EXTERNAL_BLOCKED |
| CampaIA | ativo | nenhuma | nenhum | UNSUPPORTED / EXTERNAL_BLOCKED |
| NFCore | ativo | nenhuma | nenhum | UNSUPPORTED / EXTERNAL_BLOCKED |

## Kordena

Source:

- type: `kordena-commercial-v1`
- status: `healthy`
- sync mode: `pull`
- secret: somente por referência `env:FMCC_KORDENA_CONTROL_PLANE_TOKEN`
- freshness: 300 s
- mapping: `kordena-commercial-v1`

Último sync real observado:

- status: `completed`
- started: `2026-10-06T15:39:25.488301Z`
- completed: `2026-10-06T15:39:26.938Z`
- error_code: null

Estado de dados:

- canonical facts: 0
- metric values: 0

Classificação correta:

```text
KORDENA_CONNECTION = CONNECTED
KORDENA_DATASET = EMPTY
MISSING_TO_ZERO = PROHIBITED
```

## IRON

Evidência conhecida:

- frontend e backend externos existem no Render;
- backend possui health/metrics/observability próprios.

Falta no Command:

- contrato governado IRON -> Command;
- connector registrado;
- source;
- health/sync/provenance homologados.

Não registrar source arbitrária, pois o runtime atual falharia com connector não registrado.

## CampaIA

Evidência conhecida:

- repositório possui Web/backend/health;
- workflow Cloud Run existe;
- runtime externo final não foi homologado na auditoria.

Falta:

- runtime homologado;
- contrato governado;
- connector;
- source;
- health/sync/provenance.

## NFCore

Staging externo conhecido:

- Railway `FM NFCORE Staging`;
- API e Portal online na inspeção anterior;
- PostgreSQL online;
- worker observado sem processo contínuo naquele snapshot.

O staging publicado estava defasado em relação ao CURRENT em reconciliação. Por decisão de projeto, ele não é autoridade final enquanto a reconciliação Web não terminar.

Falta:

- concluir NFCore CURRENT;
- publicar/certificar runtime reconciliado;
- definir contrato NFCore -> Command;
- implementar adapter/connector;
- registrar/homologar source.

## Scheduler

Último schedule observado:

- workflow `FMCC Governed Alert Automation`;
- run `37448909910`;
- conclusion SUCCESS;
- runtime config validation SUCCESS;
- governed alert evaluation SUCCESS.

## Veredito

```text
KORDENA = CONNECTED
IRON = EXTERNAL_BLOCKED
CAMPAIA = EXTERNAL_BLOCKED
NFCORE = EXTERNAL_BLOCKED
FALSE_CONNECTED_CLAIMS = 0
```
