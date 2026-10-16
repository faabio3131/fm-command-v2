# CME-10 — Kordena e Scheduler de Alertas — Certificação Runtime

**Data:** 04/10/2026
**Baseline main certificada:** `f2b817ec2f5e6e4124a0dbe2f10f2e27ece0a9c3`
**Cronograma:** CME-10 — Kordena e Scheduler de Alertas

## Regra de verdade

Esta certificação separa explicitamente:

1. código/contrato interno;
2. conexão runtime real;
3. disponibilidade real de dados;
4. métricas semanticamente autorizadas.

Conexão real não implica que o provider possua fatos no instante da sincronização.
Dataset vazio não é convertido em zero de negócio.

---

# 1. Preview exact-SHA

Serviço Render:

```text
workspace = My Workspace
service = fmcc-preview-web
url = https://fmcc-preview-web.onrender.com
branch = main
autoDeploy = off
```

O auto-deploy estava desligado e o Preview permanecia no SHA antigo
`ba82e70ccda0d106af22fafdffac3e4f986443ac`.

Foi executado deploy manual governado e, depois da correção CME-10, o Preview
foi atualizado para:

```text
gitCommit = f2b817ec2f5e6e4124a0dbe2f10f2e27ece0a9c3
gitBranch = main
/api/health = ok
/api/ready = ready
FMCC Preview Deployment Gate = PASS
```

Workflow de exact-SHA:

```text
run = 37216501941
conclusion = success
```

**Resultado:** PASS.

---

# 2. Kordena — autoridade e runtime

Backend real confirmado no Railway:

```text
project = diplomatic-expression
environment = production
service = fm-ai-platform
domain = https://fm-ai-platform-production.up.railway.app
state = online
replicas = 1/1
recentFailures = 0
criticalWarnings = 0
```

Variável de autoridade presente no backend:

```text
FM_AI_FMCC_CONTROL_PLANE_TOKEN = PRESENT / VALUE REDACTED
```

O valor não foi exibido nem copiado para documentação.

Teste externo sem token:

```text
/healthz = HTTP 200
/v1/control-plane/fmcc/health sem token = HTTP 401
```

Isso comprova que o control plane está disponível e a rota privada permanece
protegida.

---

# 3. Source Registry real

A source real do Preview está vinculada ao produto Kordena ativo:

```text
sourceType = kordena-commercial-v1
authoritativeDomain = commercial
baseUrl = https://fm-ai-platform-production.up.railway.app
syncMode = pull
mappingVersion = kordena-commercial-v1
freshnessSeconds = 300
secretRef = PRESENT
product slug = kordena
product status = active
tenant source count = 1
```

O bootstrap foi configurado no Render com:

- `FMCC_KORDENA_RUNTIME_BOOTSTRAP=true`;
- `FMCC_KORDENA_RUNTIME_BOOTSTRAP_VERIFY=true`;
- `FMCC_KORDENA_CONTROL_TENANT_ID`;
- `FMCC_KORDENA_ALLOWED_ORIGINS`;
- `FMCC_KORDENA_BASE_URL`.

O token continua server-side por referência.

---

# 4. Gap encontrado e corrigido durante a homologação

O primeiro runtime check em 04/10 confirmou health real, porém retornou:

```text
syncStatus = duplicate
ingested = 0
```

A causa era uma idempotency key fixa histórica:

```text
kf03-kordena-runtime-bootstrap-v1
```

Isso impedia um novo startup de provar um sync realmente fresco.

Correção implementada e mergeada na PR #53:

- correlation ID por UUID;
- idempotency key por execução;
- retry da mesma execução continua idempotente;
- startups posteriores podem fazer revalidação fresca.

Merge:

```text
PR #53
main = f2b817ec2f5e6e4124a0dbe2f10f2e27ece0a9c3
Foundation = PASS
F21 = PASS
```

---

# 5. Kordena — health e sync frescos

No deploy pós-merge do exact SHA:

```text
event = kordena_runtime_bootstrap_verified
timestamp = 2026-10-04T16:23:45Z
syncStatus = completed
ingested = 0
```

Banco Preview:

```text
source status = healthy
sync status = completed
sync started = 2026-10-04T16:23:43.742741Z
sync completed = 2026-10-04T16:23:45.470Z
error_code = null
cursor_after = 2026-10-04T16:23:43.754883+00:00
idempotency scope = bootstrap-v2 + per-run UUID
```

**Resultado de conexão:** CONNECTED.

---

# 6. Canonical facts e métricas

Após o sync fresco:

```text
canonical_fact_count = 0
metric_value_count = 0
```

O resultado não é tratado como erro de conexão porque:

- health autenticado passou;
- snapshot contratual válido passou;
- sync fresco terminou `completed`;
- cursor foi persistido;
- nenhum erro foi registrado;
- o connector retornou zero fatos no snapshot atual.

Classificação correta:

```text
KORDENA_CONNECTION = CONNECTED
KORDENA_CANONICAL_DATASET = EMPTY
KORDENA_CANONICAL_FACT_COUNT = 0
KORDENA_METRIC_VALUE_COUNT = 0
KORDENA_DERIVED_METRICS = UNAVAILABLE / NO_CANONICAL_FACTS
MISSING_TO_ZERO = PROHIBITED
```

Não existe proveniência de fato inventada porque não existe fato canônico para
persistir. A trilha do sync e sua correlação permanecem persistidas.

---

# 7. Scheduler — configuração runtime

Workflow:

```text
FMCC Governed Alert Automation
.github/workflows/fmcc-alert-automation.yml
cron = 17 * * * *
```

Antes do CME-10, execuções apareciam como `success`, porém o passo funcional
era ignorado por ausência de:

- `FMCC_AUTOMATION_BASE_URL`;
- `FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET`.

No CME-10:

- `FMCC_AUTOMATION_BASE_URL` foi configurada no GitHub Actions;
- um scheduler secret de alta entropia foi criado;
- o mesmo secret foi configurado no Preview Render;
- o valor do secret não foi exibido na documentação nem nos logs;
- GitHub Actions mascara o valor como `***`.

---

# 8. Scheduler — execução real

Execução controlada:

```text
GitHub Actions run = 37216031287
trigger = workflow_dispatch
conclusion = success
status = completed
tenants = 4
rulesEvaluated = 2
occurrencesCreated = 0
unavailable = 2
clear = 0
incompatible = 0
failures = 0
```

A avaliação real foi executada via:

```text
POST /api/internal/automation/alerts/evaluate
Authorization = Bearer [MASKED]
Idempotency-Key = gha-37216031287-1
X-Correlation-ID = gha-37216031287-1
```

O scheduler preservou `unavailable` e não criou ocorrência falsa.

---

# 9. Scheduler — idempotência runtime

Foi executado um teste controlado com a mesma chave duas vezes:

Primeira chamada:

```text
status = completed
tenants = 4
rulesEvaluated = 2
occurrencesCreated = 0
unavailable = 2
failures = 0
```

Segunda chamada:

```text
status = duplicate
tenants = 0
rulesEvaluated = 0
occurrencesCreated = 0
failures = 0
```

Audit Ledger contém somente um ciclo:

```text
alert.automation.started
alert.automation.completed
```

A chamada duplicada não criou novo ciclo de avaliação.

**Resultado:** PASS.

---

# 10. Scheduler — autenticação, retry e recovery

Cobertura interna certificada:

- sem scheduler secret => HTTP 503 fail-closed;
- secret incorreto => HTTP 401;
- secret correto => execução autorizada;
- run ID inválido => rejeitado;
- idempotência;
- PostgreSQL advisory lock;
- run recente => duplicate;
- run stale > 10 min => restarted;
- falha terminal => retry governado;
- run concluído => nunca reinicia;
- caller HTTP possui retry;
- caller HTTP possui timeout;
- correlation ID preservado;
- Audit Ledger para started/restarted/failed/completed.

A recuperação stale foi certificada por teste PostgreSQL, sem fabricar uma falha
runtime apenas para demonstrá-la.

---

# 11. Testes CME-10

Bateria dirigida antes da homologação externa:

```text
28/28 PASS
```

Inclui:

- scheduler route auth;
- AlertAutomationService;
- Kordena runtime bootstrap;
- Kordena connector;
- KCA-13 observability;
- Kordena retry 503/429;
- governance CME-10.

Correção PR #53:

- Foundation PASS;
- F21 PASS;
- Browser E2E PASS;
- runtime smoke PASS;
- secret scan PASS;
- build PASS.

---

# 12. Gate final CME-10

```text
PREVIEW_EXACT_SHA = PASS
PREVIEW_HEALTH = PASS
PREVIEW_READINESS = PASS

KORDENA_BACKEND = ONLINE
KORDENA_AUTH_BOUNDARY = PASS
KORDENA_SOURCE_REGISTRATION = PASS
KORDENA_HEALTH = HEALTHY
KORDENA_SYNC_FRESH = COMPLETED
KORDENA_IDEMPOTENCY = PASS
KORDENA_TIMEOUT_ABORT = PASS
KORDENA_RETRY_429_5XX = PASS
KORDENA_AUDIT_SYNC_STATE = PASS
KORDENA_CANONICAL_DATASET = EMPTY
KORDENA_METRICS = UNAVAILABLE / NO_CANONICAL_FACTS
KORDENA_CONNECTED = TRUE

SCHEDULER_CONFIG = PASS
SCHEDULER_AUTH = PASS
SCHEDULER_REAL_EXECUTION = PASS
SCHEDULER_RULE_EVALUATION = PASS
SCHEDULER_IDEMPOTENCY_RUNTIME = PASS
SCHEDULER_RETRY_TIMEOUT = PASS
SCHEDULER_STALE_RECOVERY = PASS (POSTGRES TEST)
SCHEDULER_LOGS = PASS
SCHEDULER_AUDIT_TRAIL = PASS
SCHEDULER_FALSE_ALERTS = 0
SCHEDULER_ACTIVE = TRUE

FALSE_CONNECTED_CLAIMS = 0
MISSING_TO_ZERO = 0
SECRET_DISCLOSURES = 0

CME_10_FINAL = PASS
```

## Próximo item do Cronograma Mestre

**CME-11 — Visual Premium Final**, somente após merge e pós-merge desta
certificação.
