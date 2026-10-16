# Asaas Sandbox manual preflight — FM Command

This is a **non-payment** workflow intentionally requiring manual invocation.

- Workflow: `.github/workflows/billing-asaas-sandbox-preflight.yml`.
- PostgreSQL 18 is temporary; never connects to Render.
- Requires GitHub Actions environment `billing-sandbox` and secret `FMCC_ASAAS_SANDBOX_API_KEY` (set in GitHub UI, not committed or pasted into chat).
- Requires input `PREFLIGHT_ONLY`; does not call Asaas, create customers, issue Pix, capture funds, or confirm payments.
- Configure environment approval restrictions and branch restrictions before using any secret. Do not give PR code from outside contributors permission to access credentials.
- **GitHub caveat:** workflows with `workflow_dispatch` generally must exist on the default branch to be launched from Actions UI. This file on PR #63 is preparatory; do not merge the uncertified Billing PR merely to make the button available.
- Actual Pix Sandbox issuance requires a separately reviewed, opt-in workflow with fake customer data, verified provider status, guarded ledger reconciliation, evidence capture and unique test run ID. The backend must not create a second charge when network outcome is uncertain.
- Never move Render's key into code; GitHub cannot automatically read Render's environment secret.

Status: `PREFLIGHT_WORKFLOW_CREATED_NOT_RUN`.
