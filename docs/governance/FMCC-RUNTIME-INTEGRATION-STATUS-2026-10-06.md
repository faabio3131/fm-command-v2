# FM Command — Runtime Integration Status

Data: 2026-10-06
Repository: `faabio3131/FM-CONTROL-CENTER`
Command main auditada: `fcc0f9f2ea64875c3fce66784aa5e2c77e351237`

## Regra de classificação

A classificação segue o Prompt Mestre de Conclusão Integral do FM Command:

- `CONNECTED`
- `READY_TO_CONNECT`
- `CREDENTIAL_REQUIRED`
- `PROVIDER_DECISION_REQUIRED`
- `BUSINESS_SEMANTICS_REQUIRED`
- `UNSUPPORTED`
- `NOT_APPLICABLE`

`CONNECTED` somente pode ser usado quando existirem source registrada, runtime configurado, health real, sync real quando aplicável, provenance, facts e métrica calculada quando aplicável.

## Tenant Nova FM Tecnologia

Auditoria read-only do banco do FM Command confirmou quatro produtos ativos no tenant:

| Produto | Slug | Produto ativo | Sources registradas |
| --- | --- | --- | ---: |
| Kordena | `kordena` | sim | 1 |
| IRON | `iron` | sim | 0 |
| CampaIA | `campaia` | sim | 0 |
| NFCore | `nfcore` | sim | 0 |

A mesma auditoria confirmou eventos `product.create` com `result=success` para Kordena, IRON, CampaIA e NFCore.

A consulta foi somente leitura. Nenhum produto ou source foi criado por SQL.

## Kordena — CONNECTED

Source real:

- nome: `Kordena Commercial`;
- tipo: `kordena-commercial-v1`;
- domínio autoritativo: `commercial`;
- status persistido: `healthy`;
- sync mode: `pull`;
- secret ref: `env:FMCC_KORDENA_CONTROL_PLANE_TOKEN`;
- freshness: 300 segundos;
- mapping version: `kordena-commercial-v1`.

O Command possui `KordenaCommercialConnector` registrado em `buildConnectorRuntime()`, com health, snapshot, pull, sync, provenance e comandos comerciais governados.

Classificação: `CONNECTED`.

## IRON — UNSUPPORTED no connector runtime CURRENT

Estado externo observado:

- frontend web no Render: `iron-macro-o-preview`;
- backend no Render: `gym-saas-backend`;
- ambos existentes e não suspensos no workspace consultado;
- backend possui health/metrics/observability próprios no repositório.

Estado no Command:

- produto registrado e ativo;
- nenhuma source registrada;
- nenhum connector IRON existe em `buildConnectorRuntime()`;
- nenhum contrato FMCC/control-plane equivalente ao Kordena foi identificado no CURRENT consultado.

Registrar uma source arbitrária agora seria incorreto: o Source Registry aceitaria o registro, mas health/sync falhariam com `integration.connector_not_registered`.

Classificação atual: `UNSUPPORTED` no runtime de connectors do FM Command.

Próximo gate para mudar de estado: contrato governado IRON -> Command + connector correspondente + health/sync/provenance reais.

## CampaIA — UNSUPPORTED no connector runtime CURRENT

Estado externo observado:

- repositório canônico contém Web, backend e endpoint de health;
- existe workflow versionado `CAMPAIA Cloud Run Release`;
- não foi observada execução de release Cloud Run no histórico consultado;
- nenhum serviço CampaIA foi encontrado no workspace Render consultado.

Estado no Command:

- produto registrado e ativo;
- nenhuma source registrada;
- nenhum connector CampaIA existe em `buildConnectorRuntime()`;
- nenhum contrato FMCC/control-plane equivalente ao Kordena foi identificado no CURRENT consultado.

Classificação atual: `UNSUPPORTED` no runtime de connectors do FM Command.

Blockers adicionais antes de conexão: runtime externo homologado + contrato governado CampaIA -> Command + connector + health/sync/provenance.

## NFCore — UNSUPPORTED no connector runtime CURRENT

Estado externo observado:

- projeto Railway: `FM NFCORE Staging`;
- `nfcore-api`: online, 1/1, deploy SUCCESS;
- `nfcore-portal`: online, 1/1, deploy SUCCESS;
- PostgreSQL: online;
- `nfcore-worker`: serviço online, 0/1 processo running no snapshot consultado;
- `GET /health/ready` da API respondeu HTTP 200 com `status=ready`;
- portal respondeu HTTP 200.

Drift conhecido:

- API/Portal implantados em `f9b5b2c5b436045947159f1e76be9303f5a95d90`;
- main auditada do NFCore em `b589f1170d002ca8d248ceb889385a8c32b989d3`;
- diferença observada: 90 commits à frente na main;
- esse drift corresponde ao trabalho de reconciliação da migração Web incompleta e não deve ser tratado como runtime final homologado.

Estado no Command:

- produto registrado e ativo;
- nenhuma source registrada;
- nenhum connector NFCore existe em `buildConnectorRuntime()`;
- NFCore possui control plane próprio no repositório, mas não foi identificado um adapter FM Command registrado no CURRENT.

Classificação atual: `UNSUPPORTED` no runtime de connectors do FM Command.

Próximo gate para mudar de estado: concluir reconciliação do NFCore, publicar/certificar o CURRENT em runtime único, definir contrato governado NFCore -> Command e implementar/homologar connector.

## Conclusão

Estado atual do portfólio Nova FM no FM Command:

| Produto | Cadastro | Runtime externo | Source FM Command | Connector FM Command | Classificação |
| --- | --- | --- | --- | --- | --- |
| Kordena | ativo | homologado para integração atual | registrada | implementado | `CONNECTED` |
| IRON | ativo | existente | não | não | `UNSUPPORTED` |
| CampaIA | ativo | não homologado nesta auditoria | não | não | `UNSUPPORTED` |
| NFCore | ativo | staging existente, CURRENT em reconciliação | não | não | `UNSUPPORTED` |

Nenhuma source de IRON, CampaIA ou NFCore deve ser registrada apenas para fazer o produto parecer conectado. O estado correto continua sendo ausência de source até existir contrato, connector, runtime, health, sync e provenance verificáveis.
