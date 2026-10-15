import { describe, expect, it } from "vitest";
import { ProductReceivablesService } from "@/application/finance/product-receivables-service";
import type { SourceRepository } from "@/domain/integration/contracts";
import type { ProductRepository } from "@/domain/products/contracts";
import {
  PermissionDeniedError,
  type TenantContext,
} from "@/domain/security/tenant-context";
import {
  KORDENA_COMMERCIAL_SOURCE_TYPE,
  KordenaCommercialConnectorError,
  type KordenaCommercialSnapshot,
} from "@/infrastructure/integration/kordena-commercial-connector";

const owner: TenantContext = {
  tenantId: "tenant-a",
  userId: "owner-a",
  role: "owner",
  correlationId: "corr-a",
};

const product = {
  id: "product-kordena",
  tenantId: "tenant-a",
  slug: "kordena",
  name: "Kordena",
  status: "active" as const,
};

const source = {
  id: "source-kordena",
  tenantId: "tenant-a",
  productId: product.id,
  name: "Kordena Commercial",
  sourceType: KORDENA_COMMERCIAL_SOURCE_TYPE,
  authoritativeDomain: "commercial",
  status: "healthy" as const,
  syncMode: "pull" as const,
  secretRef: "env:FMCC_KORDENA_CONTROL_PLANE_TOKEN",
  config: { baseUrl: "https://kordena.example.test" },
  mappingVersion: "v1",
};

function products(): ProductRepository {
  return {
    async findById(tenantId, productId) {
      return tenantId === product.tenantId && productId === product.id
        ? product
        : null;
    },
    async findBySlug(tenantId, slug) {
      return tenantId === product.tenantId && slug === product.slug
        ? product
        : null;
    },
    async list(tenantId) {
      return tenantId === product.tenantId ? [product] : [];
    },
    async create() {
      throw new Error("not used");
    },
  };
}

function sources(withSource = true): SourceRepository {
  return {
    async findById(tenantId, sourceId) {
      return withSource &&
        tenantId === source.tenantId &&
        sourceId === source.id
        ? source
        : null;
    },
    async list(tenantId) {
      return withSource && tenantId === source.tenantId ? [source] : [];
    },
    async create() {
      throw new Error("not used");
    },
  };
}

function canonicalSnapshot(): KordenaCommercialSnapshot {
  return {
    schema_version: "kordena.fmcc.commercial.v1",
    product_code: "KORDENA",
    as_of: "2026-10-03T20:00:00Z",
    customers: [
      {
        fm_customer_id: "customer-1",
        display_name: "Restaurante Exemplo",
        account_class: "external",
      },
      {
        fm_customer_id: "customer-internal",
        display_name: "Homologação FM",
        account_class: "internal_test",
      },
    ],
    product_accounts: [],
    trials: [],
    subscriptions: [
      {
        subscription_id: "sub-past-due",
        fm_customer_id: "customer-1",
        product_account_id: "account-1",
        tenant_id: "product-tenant-1",
        plan_code: "KORDENA_PLAN_B",
        contracted_amount: "149.90",
        currency: "BRL",
        status: "past_due",
        current_period_end: "2026-10-01T00:00:00Z",
      },
      {
        subscription_id: "sub-internal",
        fm_customer_id: "customer-internal",
        product_account_id: "account-internal",
        tenant_id: "product-tenant-internal",
        plan_code: "KORDENA_PLAN_A",
        contracted_amount: "99.90",
        currency: "BRL",
        status: "past_due",
        current_period_end: "2026-10-02T00:00:00Z",
      },
    ],
    billing_transactions: [
      {
        billing_transaction_id: "tx-success",
        provider_code: "MERCADO_PAGO_SUBSCRIPTIONS",
        subscription_id: "sub-past-due",
        fm_customer_id: "customer-1",
        product_account_id: "account-1",
        product_code: "KORDENA",
        tenant_id: "product-tenant-1",
        transaction_type: "payment",
        status: "succeeded",
        amount: "149.90",
        currency: "BRL",
        reconciliation_status: "in_sync",
        provider_occurred_at: "2026-10-03T10:00:00Z",
        updated_at: "2026-10-03T10:01:00Z",
      },
      {
        billing_transaction_id: "tx-failed",
        provider_code: "MERCADO_PAGO_SUBSCRIPTIONS",
        subscription_id: "sub-past-due",
        fm_customer_id: "customer-1",
        product_account_id: "account-1",
        product_code: "KORDENA",
        tenant_id: "product-tenant-1",
        transaction_type: "payment",
        status: "failed",
        amount: "149.90",
        currency: "BRL",
        reconciliation_status: "failed",
        provider_occurred_at: "2026-10-03T11:00:00Z",
        updated_at: "2026-10-03T11:01:00Z",
      },
      {
        billing_transaction_id: "tx-internal",
        provider_code: "MERCADO_PAGO_SUBSCRIPTIONS",
        subscription_id: "sub-internal",
        fm_customer_id: "customer-internal",
        product_account_id: "account-internal",
        product_code: "KORDENA",
        tenant_id: "product-tenant-internal",
        transaction_type: "payment",
        status: "succeeded",
        amount: "99.90",
        currency: "BRL",
        reconciliation_status: "in_sync",
        provider_occurred_at: "2026-10-03T12:00:00Z",
        updated_at: "2026-10-03T12:01:00Z",
      },
      {
        billing_transaction_id: "tx-unbound",
        provider_code: "MERCADO_PAGO_SUBSCRIPTIONS",
        subscription_id: null,
        fm_customer_id: null,
        product_account_id: null,
        product_code: "KORDENA",
        tenant_id: null,
        transaction_type: "payment",
        status: "pending",
        amount: null,
        currency: null,
        reconciliation_status: "not_checked",
        provider_occurred_at: null,
        updated_at: "2026-10-03T13:01:00Z",
      },
    ],
    entitlements: [],
    catalog: [],
    summary: {},
    facts: [],
    coverage: {
      delinquency_amount: "pending_governed_semantics",
    },
  };
}

function service(
  snapshot: KordenaCommercialSnapshot = canonicalSnapshot(),
  withSource = true,
) {
  return new ProductReceivablesService(
    products(),
    sources(withSource),
    {
      async snapshot() {
        return snapshot;
      },
    },
  );
}

describe("R7 Product Receivables", () => {
  it("compõe somente transações comerciais canônicas e exclui INTERNAL_TEST/unbound", async () => {
    const result = await service().overview(owner, product.id);

    expect(result.status).toBe("available");
    expect(result.transactions.map((item) => item.billingTransactionId)).toEqual([
      "tx-failed",
      "tx-success",
    ]);
    expect(result.counts).toMatchObject({
      transactions: 2,
      succeededPayments: 1,
      failedPayments: 1,
      pastDueSubscriptions: 1,
      reconciliationAttention: 1,
      excludedInternalTestTransactions: 1,
      excludedUnboundTransactions: 1,
    });
    expect(result.pastDueSubscriptions).toHaveLength(1);
    expect(result.pastDueSubscriptions[0].fmCustomerId).toBe("customer-1");
  });

  it("não transforma falha, past_due ou valor contratado em fatura/saldo/inadimplência", async () => {
    const result = await service().overview(owner, product.id);

    expect(result.coverage).toEqual({
      invoices: "unavailable",
      openBalance: "unavailable",
      dueDate: "unavailable",
      delinquencyAmount: "pending_semantics",
      note: expect.stringContaining("não são convertidos"),
    });
    expect(result.pastDueSubscriptions[0].contractedAmount).toBe("149.90");
    expect(result.coverage.note).toContain("valor inadimplente");
  });

  it("falha fechado se o snapshot tentar cruzar o escopo do produto", async () => {
    const snapshot = {
      ...canonicalSnapshot(),
      product_code: "IRON" as "KORDENA",
    };

    await expect(service(snapshot).overview(owner, product.id)).rejects.toThrow(
      "finance.receivables_product_scope_mismatch",
    );
  });

  it("retorna indisponível sem fabricar zeros financeiros quando a fonte não existe", async () => {
    const result = await service(canonicalSnapshot(), false).overview(
      owner,
      product.id,
    );

    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("source_not_configured");
    expect(result.coverage.openBalance).toBe("unavailable");
    expect(result.coverage.note).toContain("não presume");
  });

  it("retorna indisponível quando o upstream canônico falha", async () => {
    const result = await new ProductReceivablesService(
      products(),
      sources(),
      {
        async snapshot() {
          throw new KordenaCommercialConnectorError(
            "integration.kordena_snapshot_unavailable",
          );
        },
      },
    ).overview(owner, product.id);

    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("upstream_unavailable");
  });

  it("restringe a leitura de recebíveis a owner/admin", async () => {
    await expect(
      service().overview({ ...owner, role: "analyst" }, product.id),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
