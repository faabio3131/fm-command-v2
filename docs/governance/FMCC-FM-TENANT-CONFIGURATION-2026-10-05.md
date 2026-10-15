# FM Command — Configuração do tenant Nova FM Tecnologia

Data-base: 2026-10-05
Atualização operacional: 2026-10-06

## Regra arquitetural

O FM Command permanece um único SaaS comercial genérico. A Nova FM Tecnologia é uma organização/tenant configurada dentro do produto, não uma variante de código.

- Código-base único.
- Nenhum fork FM vs. comercial.
- Marca do fornecedor: FM Tecnologia / FM Command.
- Nome da empresa usuária vem do tenant autenticado.
- Integrações opcionais só aparecem quando configuradas no tenant.
- Segredos permanecem por referência; nenhum token é persistido em config ou código.

## Baseline comercial protegido

Baseline anterior certificado e mergeado:
`8f1c9f79f3a056393509d414b5670c2415413eb2`

Proteção de genericidade promovida e atualmente em main:
`fcc0f9f2ea64875c3fce66784aa5e2c77e351237`

Tag local de referência:
`fm-command-internal-layer-certified-2026-10-05`

## Estado real do tenant Nova FM Tecnologia

Organização:
- Nova FM Tecnologia: existente e ativa.
- Proprietário: existente com papel `owner`.

Produtos ativos:
- Kordena — slug `kordena`.
- IRON — slug `iron`.
- CampaIA — slug `campaia`.
- NFCore — slug `nfcore`.

Auditoria read-only do banco confirmou:
- os quatro produtos pertencem ao tenant Nova FM Tecnologia;
- os quatro estão com status `active`;
- eventos `product.create` possuem `result=success`;
- IRON, CampaIA e NFCore foram cadastrados pela autoridade autenticada do Command;
- nenhuma mutação SQL foi utilizada para cadastrar os produtos.

## Estado das integrações

### Kordena

- Source: `Kordena Commercial`.
- Tipo: `kordena-commercial-v1`.
- Status: `healthy`.
- Segredo: referência `env:FMCC_KORDENA_CONTROL_PLANE_TOKEN`.
- Sync mode: `pull`.
- Freshness: 300 segundos.
- Mapping: `kordena-commercial-v1`.
- Classificação: `CONNECTED`.

Auditoria do runtime Kordena confirmou anteriormente:
- endpoint `/v1/control-plane/fmcc/snapshot` operacional;
- projection KCA-12 presente no deploy;
- geração de facts exclui deliberadamente clientes `internal_test`;
- zero facts continua sendo um estado factual possível quando não há contas comerciais externas elegíveis;
- nenhum filtro deve ser removido para fabricar dados no Command.

### IRON

- Produto: cadastrado e ativo.
- Sources registradas: 0.
- Connector FM Command: não implementado no CURRENT.
- Runtime externo: frontend e backend existem no Render.
- Classificação: `UNSUPPORTED` no connector runtime atual do Command.

Não registrar source até existir contrato governado IRON -> Command, connector, health, sync e provenance reais.

### CampaIA

- Produto: cadastrado e ativo.
- Sources registradas: 0.
- Connector FM Command: não implementado no CURRENT.
- Repositório possui Web/backend/health e workflow de release Cloud Run.
- Runtime externo final não foi homologado nesta auditoria.
- Classificação: `UNSUPPORTED` no connector runtime atual do Command.

Não registrar source até existir runtime homologado, contrato governado CampaIA -> Command, connector, health, sync e provenance reais.

### NFCore

- Produto: cadastrado e ativo.
- Sources registradas: 0.
- Connector FM Command: não implementado no CURRENT.
- Staging Railway existe com API, Portal e PostgreSQL online.
- Worker foi observado com 0/1 processo running.
- API readiness e Portal responderam HTTP 200.
- Staging publicado não representa ainda a main CURRENT; a reconciliação Web segue em andamento.
- Classificação: `UNSUPPORTED` no connector runtime atual do Command.

Não registrar source até o NFCore CURRENT estar reconciliado e homologado e existir contrato/connector governado para o Command.

Detalhes reproduzíveis:
`docs/governance/FMCC-RUNTIME-INTEGRATION-STATUS-2026-10-06.md`.

## Proteção de genericidade implementada

- Dashboard usa o nome real da organização autenticada.
- `Nova FM Tecnologia` não faz parte do branding global do produto-base.
- FM Tecnologia permanece somente como marca do fornecedor.
- Kordena no menu, Configurações e atalhos da Home é feature tenant-scoped.
- Busca Global recebe a mesma feature map e não inventa navegação Kordena para tenant sem a integração.
- Produto/source podem continuar pesquisáveis quando existirem, mesmo que um módulo opcional esteja desabilitado.
- Nenhuma credencial ou configuração específica da Nova FM foi hardcoded.

## Certificação técnica da proteção de genericidade

Na tranche que originou o CURRENT:
- Typecheck: PASS.
- Lint: PASS.
- Testes focados pós-correção: 16/16 PASS.
- Suíte integral: 82/82 arquivos, 342/342 testes PASS.
- Production build: PASS.
- 46 páginas/rotas geradas.
- `git diff --check`: PASS.

## Próximas ações

Concluído:
1. Promover a proteção de genericidade via PR/CI/merge.
2. Cadastrar IRON no tenant Nova FM Tecnologia pela autoridade autenticada do Command.
3. Cadastrar CampaIA no mesmo tenant pela mesma autoridade.
4. Cadastrar NFCore no mesmo tenant pela mesma autoridade.
5. Certificar por leitura os quatro produtos e a trilha `product.create`.

Pendente e condicionado ao readiness de cada produto:
1. Definir/confirmar contrato governado de integração para IRON, CampaIA e NFCore.
2. Implementar connectors no FM Command sem acoplamento a tenant específico.
3. Registrar source somente após contrato, endpoint e secret reference estarem definidos.
4. Homologar health/sync/provenance de cada source.
5. Manter dados ausentes como indisponíveis; nunca criar fatos ou métricas de demonstração como se fossem reais.
