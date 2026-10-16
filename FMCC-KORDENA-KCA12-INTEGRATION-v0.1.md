# FMCC — Kordena Commercial Control Plane — KCA-12

Status: MERGED BASELINE + HARDENING CANDIDATE / exact-head recertification required.

Original KCA-12 base: `main` @ `9632dd3871790a8b709fa5bc11211b9649b943fa`.

Current reconciled main: `175f4847eba16b7361929d35a780dc22a39ff95b`.

## Architectural reconciliation

The FM Control Center owns its Vertical Cognitive Core. Historical Kordena
cross-product FMCC Core artifacts are not restored.

KCA-12 integrates Kordena through governed HTTP contracts and the existing FMCC
Integration Fabric. FMCC must not read or write the Kordena database directly.

## Scope

- Kordena commercial source connector;
- health and pull synchronization through ConnectorRuntime;
- secret-by-reference;
- canonical facts/provenance;
- governed Kordena commercial read surface;
- owner/admin password reauthentication before commercial mutation;
- server-to-server command forwarding to Kordena canonical Commercial Platform;
- tenant isolation, RBAC and audit.

KCA-G12 remains open until exact-head tests/CI and cross-repository evidence are
green.


## Runtime contract

The Kordena connector is fail-closed unless all of these controls are present:

- `FMCC_KORDENA_CONTROL_TENANT_ID`: the single internal FMCC tenant allowed to
  consume or administer the Kordena commercial source;
- `FMCC_KORDENA_ALLOWED_ORIGINS`: comma-separated HTTPS origins accepted for
  Kordena server-to-server calls;
- `FMCC_KORDENA_CONTROL_PLANE_TOKEN`: dedicated secret value resolved only by
  the source reference `env:FMCC_KORDENA_CONTROL_PLANE_TOKEN`.

The Kordena runtime must receive the same secret value through its own
`FM_AI_FMCC_CONTROL_PLANE_TOKEN` configuration. The secret itself is never
stored in source configuration, browser state, repository files or audit
metadata.

## Security invariants

- a source owned by another FMCC tenant is denied;
- even a tenant-owned source is denied unless the current tenant equals the
  configured internal control tenant;
- insecure or non-allowlisted origins are denied before the service token is
  sent;
- unrelated environment secret references are denied;
- commercial writes require `commercial:write`, owner/admin role and fresh
  password reauthentication;
- publish operations require canonical preview/diff before the UI enables
  confirmation;
- Kordena remains the mutation authority: FMCC forwards commands to
  `AplicacaoCatalogoComercialV1` and never writes Kordena tables directly.


## Functional certification evidence

Candidate funcional FMCC:

`5d4843d4bd5ac403c59a0d491413f4482a0318f9`

Cross-repository Kordena candidate:

`b35ba198ecd9a667f0473829c16562e2474a1f31`

Evidence on the FMCC candidate:

- FMCC Foundation Gate: SUCCESS;
- 33 test files PASS;
- 118 tests PASS;
- KCA-12 Kordena connector: 6 tests PASS;
- KCA-12 commercial security: 3 tests PASS;
- lint: PASS;
- TypeScript: PASS;
- migration/schema verification: PASS;
- versioned migration application: PASS;
- Next production build: PASS;
- Docker image build without runtime secrets: PASS;
- runtime dependency audit at HIGH threshold: PASS;
- 4 moderate transitive advisories were reported by npm audit; no HIGH/CRITICAL
  gate failure exists.

The connector additionally fails closed for incomplete snapshots so contract drift
cannot be rendered as a false zero.

The Kordena candidate is certified with 202 targeted tests, 1803 full Python
tests, 16 Web Node tests, 7/7 GitHub Actions SUCCESS and Vercel SUCCESS.

KCA-G12 is certified on the functional candidates. This documentation commit
creates a new FMCC HEAD and must itself pass the Foundation Gate before the
cross-repository documentary closure is considered final.


## Reconciliation with F16-F19 CURRENT

While KCA-12 remained in Draft, FMCC `main` legitimately advanced with the
F16-F19 advanced intelligence/alerts certification at:

`175f4847eba16b7361929d35a780dc22a39ff95b`

The KCA-12 branch was therefore reconciled without reset, force push or
destructive rebase.

A non-destructive merge commit with both histories as parents was created:

`b973958448d64c09bfb018b66836f7418970bb70`

Conflicting surfaces were reconciled conservatively:

- dashboard preserves F16 intelligence/alerts surfaces and adds only the
  Kordena Commercial KCA-12 entry;
- RBAC preserves F16 `alert:read`, `alert:write`, `action:prepare` and
  adds KCA-12 `commercial:read` / `commercial:write`;
- no F16-F19 capability, test, security control or documentation was removed.

### Exact-head certification on the reconciled functional HEAD

FMCC Foundation Gate: **SUCCESS**.

Evidence on `b973958448d64c09bfb018b66836f7418970bb70`:

- lint: PASS;
- TypeScript: PASS;
- schema generation/no drift: PASS;
- migrations: PASS;
- 42 test files PASS;
- 154 tests PASS;
- KCA-12 Kordena connector: 6 tests PASS;
- KCA-12 commercial security: 3 tests PASS;
- F19 adversarial coverage remains green;
- high-confidence secret scan: PASS — 212 tracked files checked;
- Next production build: PASS;
- runtime smoke: PASS;
- Docker image build without runtime secrets: PASS;
- runtime dependency audit at HIGH threshold: PASS;
- 4 moderate transitive advisories remain reported by npm audit; no
  HIGH/CRITICAL gate failure exists.

PR #16 is again mergeable against the current `main`.

This documentation update creates a new candidate HEAD and must itself pass the
FMCC Foundation Gate. The PR check on that exact HEAD is the final documentary
evidence and does not require another content-only commit.


## Hardening posterior na tranche de finalização

Após o merge KCA-12 na `main` em
`378eefdb7d2e2a99054382686e52227afb245f53`, a tranche de finalização do FMCC
adiciona controles complementares sem transferir autoridade comercial para o
FMCC:

- publicação de plano, preço e promoção classificada como ação de alto risco;
- prévia obrigatória no servidor, não apenas na interface;
- aprovação efêmera vinculada a tenant, usuário, fonte, ação, recurso e hash do
  payload de publicação;
- token de aprovação de uso único, armazenado somente como hash no Audit Ledger;
- expiração da aprovação e rejeição de replay;
- superfície comercial principal em pt-BR;
- ausência preservada como indisponível, nunca convertida silenciosamente em
  zero;
- Central de Fontes e Integrações para cadastro, saúde e sincronização
  governados;
- Browser E2E para jornadas críticas;
- automação interna de avaliação de alertas sem efeitos externos críticos.

A integração real continua fail-closed enquanto URL allowlisted, tenant de
controle e segredo runtime reais não estiverem configurados.

A promoção desta tranche exige novo Foundation Gate no HEAD reconciliado após
incorporar a `main` atual sem force push nem rebase destrutivo.
