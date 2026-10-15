# CME-09 — Registro de fontes e providers corporativos

**Data da reconciliação:** 04/10/2026
**Baseline:** FM Command pós-CME-08
**Escopo:** Cronograma Mestre CME-09 — Fontes e Providers Corporativos

## Regra de verdade

Este registro separa quatro fatos diferentes:

1. fonte cadastrada;
2. connector implementado;
3. runtime realmente conectado e sincronizando;
4. métrica semanticamente autorizada.

Nenhum desses estados implica automaticamente o seguinte.

Estados usados neste registro:

- `CONNECTED`: runtime real comprovado com health + sync + dados válidos;
- `READY_TO_CONNECT`: connector e contratos internos existem, mas runtime real ainda depende de configuração/credencial/homologação;
- `SEMANTICS_PENDING`: existem dados candidatos, mas a métrica/uso não possui contrato semântico aprovado;
- `PROVIDER_UNDECIDED`: provider/autoridade externa ainda não foi escolhido;
- `EXTERNAL_BLOCKER`: depende de configuração/credencial/sistema externo para avançar;
- `ROADMAP`: não obrigatório para o escopo comercial atual.

## CURRENT interno confirmado

O FM Command já possui:

- Source Registry tenant-scoped;
- secret-by-reference;
- Connector Runtime;
- timeout;
- retry com backoff;
- idempotência;
- deduplicação de canonical facts;
- cursor/checkpoint de sync;
- canonical ingestion;
- provenance;
- RBAC;
- tenant scope;
- health por connector;
- sync execution persistida;
- safe logging;
- fail-closed em source/tenant inválido;
- UI de Fontes e Integrações.

Correções CME-09 adicionadas neste bloco:

- persistência do último health conhecido na source existente;
- leitura do último sync bem-sucedido e da última tentativa;
- exposição desses estados na Central de Fontes;
- Audit Ledger para cadastro, health e sync;
- Kordena `429`/5xx classificado como transitório para o retry governado existente;
- testes de isolamento do estado operacional.

Nenhuma nova tabela foi criada.

## Connector real disponível no código

### Kordena Commercial

**source type:** `kordena-commercial-v1`
**domínio declarado:** `commercial`
**secretRef dedicado:** `env:FMCC_KORDENA_CONTROL_PLANE_TOKEN`
**modo:** pull
**produto:** Kordena
**status CME-09:** `READY_TO_CONNECT`

Controles CURRENT confirmados:

- tenant de controle dedicado;
- allowlist HTTPS de origins;
- token por referência;
- timeout/AbortController;
- retry governado para timeout, 429 e 5xx;
- validação estrutural do snapshot;
- idempotência de sync;
- deduplicação de canonical facts;
- cursor/checkpoint;
- provenance;
- health;
- last successful sync;
- Audit Ledger;
- RBAC e tenant isolation;
- comandos comerciais com idempotency key;
- fail-closed para URL insegura, secretRef incorreto, origem não autorizada e payload inválido.

**Importante:** este registro NÃO declara Kordena como `CONNECTED`. A conexão real, credenciais, health e sync em runtime pertencem ao CME-10.

## Matriz corporativa de cobertura

| Prioridade CME-09 | Domínio | CURRENT / autoridade candidata | Estado | Motivo / próximo gate |
|---|---|---|---|---|
| 1 | Billing / invoices | Kordena possui billing transactions para Kordena; não existe ledger canônico de invoice/open balance/due date confirmado | READY_TO_CONNECT + PROVIDER_UNDECIDED | CME-10 pode homologar fatos Kordena; autoridade de invoice completa ainda precisa ser definida |
| 2 | Pagamentos | Kordena Commercial publica transações/pagamentos governados do produto Kordena | READY_TO_CONNECT | Homologar runtime real no CME-10 |
| 3 | Subscriptions / trials | Kordena Commercial possui trials, subscriptions e fatos comerciais | READY_TO_CONNECT | Homologar runtime real no CME-10 |
| 4 | Inadimplência | Kordena possui estado `past_due`; valor em aberto/due date não são autoridade canônica confirmada | READY_TO_CONNECT + SEMANTICS_PENDING | Homologar estado no CME-10; contrato financeiro detalhado permanece pendente |
| 5 | Custos de infraestrutura / FinOps | KCA-13 expõe infraestrutura como indisponível quando source não está configurada | PROVIDER_UNDECIDED | Escolher autoridade FinOps corporativa antes de conectar |
| 6 | Custos operacionais | Nenhuma autoridade corporativa real confirmada | PROVIDER_UNDECIDED | Requer decisão de sistema/autoridade financeira |
| 7 | CRM / leads | Nenhum provider corporativo real confirmado no CURRENT | PROVIDER_UNDECIDED | Requer decisão de CRM/autoridade comercial |
| 8 | Telemetria de produto | Kordena possui observabilidade comercial parcial; não existe autoridade corporativa universal de product telemetry confirmada | PROVIDER_UNDECIDED | Definir provider/contrato por produto |
| 9 | Incidentes / erros | Operational Health existe como read model; provider consolidado de observabilidade não foi autorizado | PROVIDER_UNDECIDED + SEMANTICS_PENDING | Definir autoridade de observabilidade e semântica de `service.error.rate` |
| 10 | Suporte | Nenhuma autoridade de tickets/suporte confirmada | PROVIDER_UNDECIDED | Requer decisão de sistema de suporte |

## Data classification

A auditoria do CURRENT não encontrou uma taxonomia corporativa formal versionada de classificação de dados que autorize atribuir unilateralmente rótulos como `confidential`, `restricted` ou equivalentes a cada connector.

Portanto:

```text
DATA_CLASSIFICATION_POLICY = EXTERNAL_BLOCKED / POLICY_REQUIRED
```

Controles que continuam obrigatórios mesmo antes dessa taxonomia:

- secrets nunca em config bruto;
- PII não deve aparecer em logs, busca global ou superfícies agregadas;
- Audit Ledger usa metadata sanitizada;
- tenant isolation obrigatório;
- source authority e provenance preservados;
- raw payload não é exposto como UX executiva.

## Scopes mínimos

Scopes internos FM Command já são governados por RBAC:

- leitura de Source Registry: `source:read`;
- cadastro/configuração: `source:write`;
- health: `integration:read`;
- sync: `integration:write`.

Scopes externos específicos de providers não são inventados. Eles só poderão ser registrados quando o provider real for escolhido e sua política de autenticação estiver confirmada.

## Reconciliação, replay e fail-safe

O Connector Runtime atual possui:

- cursor antes/depois;
- retry controlado;
- backoff;
- idempotency key escopada por source;
- replay de chamada concluída retornando `duplicate`;
- execução em andamento retornando `in_progress`;
- restart governado de execução `failed`;
- dedupe de facts por tenant + source + externalId + mappingVersion;
- erro normalizado sem persistir mensagem externa contendo segredo;
- timeout;
- rate-limit awareness quando o connector classifica o erro como transitório;
- last successful sync;
- status de última tentativa;
- health persistido.

Limitação honesta: um provider não pode ser declarado reconciliado fim-a-fim até existir runtime real e contrato de recuperação/paginação próprio desse provider.

## Gate CME-09

```text
INTEGRATION_FABRIC_INTERNAL = PASS após CI verde
KORDENA_CONNECTOR_CODE = READY_TO_CONNECT
KORDENA_RUNTIME = DEFER_TO_CME_10
CORPORATE_PROVIDER_COVERAGE = PARTIAL
UNDECIDED_PROVIDERS = EXPLICIT
DATA_CLASSIFICATION_POLICY = EXTERNAL_BLOCKED / POLICY_REQUIRED
FALSE_CONNECTED_CLAIMS = 0
```

O CME-09 pode ser encerrado internamente quando as correções deste bloco passarem os gates do repositório. Os providers não escolhidos permanecem blockers explícitos e não impedem o início do CME-10 para o Kordena e scheduler já previstos no Cronograma Mestre.
