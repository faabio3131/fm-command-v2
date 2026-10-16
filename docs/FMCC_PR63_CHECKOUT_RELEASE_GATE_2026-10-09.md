# FM Command — PR #63 Checkout Kordena R$ 1,00 — Release Gate (2026-10-09)

Status: **NO-GO for real money / PREVIEW-ONLY candidate pending security gates.**

## Verified facts
- Render web service `fmcc-preview-web` (srv-danhfirtqb8s73bug4ag) is on `main`, auto-deploy OFF; last live deployment is commit `d83098ce26cf4b66f36e1ff5e9eadecddfb3a44f` from 2026-10-06, before checkout work.
- PR #63 branch: `feat/central-billing-attribution-20261008`, checkout screen `/dashboard/billing`, protected pilot preflight, issuance and reconcile routes.
- Render `fmcc_preview` had 6 migrations, 7 Billing tables; seeded 1 BRL pilot invoice was confirmed previously with `pending`, gateway `disabled`, no payment.
- Isolated Windows PostgreSQL `fmcc_billing_ci` schema tests passed: two recovery tests; 17 provider unit tests passed earlier.
- Full Webpack build run on local project completed with exit 0, targeted lint 0 errors/1 warning. Browser-local login initially failed owing to stale DB password in running Next process. No claim of UI E2E certification.
- No real Pix issued; no main merge/deploy occurred in this task.

## Blocking gates before the first real Pix
1. **Provider uncertainty path**: if `POST /payments` succeeds but response is lost, local invoice stays `creating`; the checkout POST declines retries but operator workflow needs a documented and tested provider-reference lookup/recovery that cannot create a second charge. A read-only provider reconciliation check alone is insufficient without an operational recovery entry point.
2. **Customer-creation uncertainty**: if `POST /customers` succeeds but response is lost, retry must perform a fresh reference lookup and handle provider eventual consistency. Never blindly duplicate buyer records.
3. **Production configuration**: validate the FM Tecnologia Asaas credential via read-only preflight and ensure the account is the actual receivable destination. Keep `FMCC_PILOT_PIX_ISSUANCE_ENABLED=NO` until explicit release authorization.
4. **End-to-end session/authorization**: test active owner's login on already-published Render session, deny unauthenticated/nonowner/other tenant, verify CSRF/origin requirements, no payment API calls in preview-only mode. Owner still needs password step-up for issuing.
5. **Provider event/webhook verification**: verify signature/secret, idempotence, tenant/amount/currency/reference matching and settlement status. Polling must be called explicit manual reconciliation, not represented as auto-webhook confirmation.
6. **A payment-level recovery screen**: GET pending payment and QR after reload without creating a second charge. Current UI only retains returned payment ID in React state and loses it on refresh.
7. **Fresh isolated E2E tests**, final lint/typecheck/build and CI green on exact release commit.
8. **Deployment gate**: `fmcc-preview-web` tracks `main` and auto-deploy is off. Publication to the existing logged-in URL therefore requires an authorized merge plus deliberate Render deploy (or approved isolated staging strategy). The preview deployment also shares a live DB context; never turn on production Pix inadvertently.

## Controlled release sequence
- Complete blocking fixes/tests in PR #63; keep Draft until verified.
- Make preview-only checkout visible under current authenticated Render login, with issuer hard-disabled even if database gateway is enabled.
- Validate route, navigation, admin access, tenant scoping, visual, logs and no Asaas POST.
- Obtain explicit GO for real-money R$ 1 pilot. Verify no provider payment by externalReference and local invoice pending.
- Enable gateway/flag briefly with audit/rollback and make exactly one authorized checkout POST. Capture provider ID, QR, pay from an external banking app; verify provider finality and local invoice paid.
- Disable flag immediately after pilot; preserve receipt and reconciliation report.

**Safety**: Do not merge, deploy, enable real gateway or issue a payment on this documentation alone.
