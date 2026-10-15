import type { SourceRepository } from "@/domain/integration/contracts";
import {
  ReceivablesContractError,
  type PastDueSubscription,
  type ProductReceivablesOverview,
  type ReceivableReconciliationStatus,
  type ReceivableTransaction,
  type ReceivableTransactionStatus,
  type ReceivableTransactionType,
} from "@/domain/finance/receivables";
import type { ProductRepository } from "@/domain/products/contracts";
import {
  requirePermission,
  type TenantContext,
} from "@/domain/security/tenant-context";
import {
  KORDENA_COMMERCIAL_SOURCE_TYPE,
  KordenaCommercialConnectorError,
  type KordenaCommercialSnapshot,
} from "@/infrastructure/integration/kordena-commercial-connector";
import { ProductRegistryService } from "@/application/products/product-registry-service";

type SnapshotReader = {
  snapshot(
    context: {
      tenantId: string;
      correlationId: string;
      timeoutMs: number;
    },
    source: Awaited<ReturnType<SourceRepository["findById"]>> extends infer T
      ? Exclude<T, null>
      : never,
  ): Promise<KordenaCommercialSnapshot>;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReceivablesContractError();
  }
  return value as Record<string, unknown>;
}

function stringField(
  row: Record<string, unknown>,
  key: string,
  options: { nullable?: boolean } = {},
): string | null {
  const value = row[key];
  if (value === null && options.nullable) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new ReceivablesContractError(
      `finance.receivables_contract_invalid:${key}`,
    );
  }
  return value.trim();
}

function isoField(
  row: Record<string, unknown>,
  key: string,
  options: { nullable?: boolean } = {},
): string | null {
  const value = stringField(row, key, options);
  if (value === null) return null;
  if (Number.isNaN(new Date(value).getTime())) {
    throw new ReceivablesContractError(
      `finance.receivables_contract_invalid:${key}`,
    );
  }
  return value;
}

function amountField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !/^\d+(?:\.\d{1,2})?$/.test(value.trim())
  ) {
    throw new ReceivablesContractError(
      `finance.receivables_contract_invalid:${key}`,
    );
  }
  return value.trim();
}

function enumField<T extends string>(
  row: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const value = stringField(row, key);
  if (!allowed.includes(value as T)) {
    throw new ReceivablesContractError(
      `finance.receivables_contract_invalid:${key}`,
    );
  }
  return value as T;
}

function currencyField(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !/^[A-Z]{3}$/.test(value.trim().toUpperCase())
  ) {
    throw new ReceivablesContractError(
      `finance.receivables_contract_invalid:${key}`,
    );
  }
  return value.trim().toUpperCase();
}

const TRANSACTION_TYPES = ["payment", "refund"] as const;
const TRANSACTION_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "refunded",
] as const;
const RECONCILIATION_STATUSES = [
  "not_checked",
  "in_sync",
  "repaired",
  "failed",
] as const;

export class ProductReceivablesService {
  constructor(
    private readonly products: ProductRepository,
    private readonly sources: SourceRepository,
    private readonly snapshotReader: SnapshotReader,
  ) {}

  async overview(
    context: TenantContext,
    productId: string,
  ): Promise<ProductReceivablesOverview> {
    requirePermission(context, "receivable:read");

    const product = await new ProductRegistryService(this.products).get(
      context,
      productId,
    );
    const base = {
      product: {
        id: product.id,
        slug: product.slug,
        name: product.name,
      },
    };

    const sources = await this.sources.list(context.tenantId);
    const source = sources.find(
      (candidate) =>
        candidate.tenantId === context.tenantId &&
        candidate.productId === product.id &&
        candidate.sourceType === KORDENA_COMMERCIAL_SOURCE_TYPE,
    );

    if (!source) {
      return this.unavailable(base.product, "source_not_configured");
    }

    let snapshot: KordenaCommercialSnapshot;
    try {
      snapshot = await this.snapshotReader.snapshot(
        {
          tenantId: context.tenantId,
          correlationId: context.correlationId,
          timeoutMs: 8_000,
        },
        source,
      );
    } catch (error) {
      if (error instanceof KordenaCommercialConnectorError) {
        return this.unavailable(base.product, "upstream_unavailable");
      }
      throw error;
    }

    const expectedProductCode = product.slug.toUpperCase();
    if (snapshot.product_code !== expectedProductCode) {
      throw new ReceivablesContractError(
        "finance.receivables_product_scope_mismatch",
      );
    }

    const customerById = new Map<
      string,
      { displayName: string; internalTest: boolean }
    >();
    for (const raw of snapshot.customers) {
      const row = record(raw);
      const fmCustomerId = stringField(row, "fm_customer_id") as string;
      const displayName = stringField(row, "display_name") as string;
      const accountClass = stringField(row, "account_class") as string;
      customerById.set(fmCustomerId, {
        displayName,
        internalTest: accountClass === "internal_test",
      });
    }

    const subscriptionById = new Map<
      string,
      {
        fmCustomerId: string;
        productAccountId: string;
        tenantId: string | null;
        status: string;
        planCode: string;
        contractedAmount: string;
        currency: string;
        currentPeriodEnd: string | null;
      }
    >();

    for (const raw of snapshot.subscriptions) {
      const row = record(raw);
      const subscriptionId = stringField(row, "subscription_id") as string;
      const currency = currencyField(row, "currency");
      if (!currency) throw new ReceivablesContractError();
      const contractedAmount = amountField(row, "contracted_amount");
      if (contractedAmount === null) throw new ReceivablesContractError();
      subscriptionById.set(subscriptionId, {
        fmCustomerId: stringField(row, "fm_customer_id") as string,
        productAccountId: stringField(row, "product_account_id") as string,
        tenantId: stringField(row, "tenant_id", { nullable: true }),
        status: stringField(row, "status") as string,
        planCode: stringField(row, "plan_code") as string,
        contractedAmount,
        currency,
        currentPeriodEnd: isoField(row, "current_period_end", {
          nullable: true,
        }),
      });
    }

    let excludedInternalTestTransactions = 0;
    let excludedUnboundTransactions = 0;
    const transactions: ReceivableTransaction[] = [];

    for (const raw of snapshot.billing_transactions) {
      const row = record(raw);
      const productCode = row.product_code;
      if (productCode !== expectedProductCode) continue;

      const fmCustomerId =
        typeof row.fm_customer_id === "string" && row.fm_customer_id.trim()
          ? row.fm_customer_id.trim()
          : null;
      const productAccountId =
        typeof row.product_account_id === "string" &&
        row.product_account_id.trim()
          ? row.product_account_id.trim()
          : null;
      const subscriptionId =
        typeof row.subscription_id === "string" && row.subscription_id.trim()
          ? row.subscription_id.trim()
          : null;

      if (!fmCustomerId || !productAccountId || !subscriptionId) {
        excludedUnboundTransactions += 1;
        continue;
      }

      const customer = customerById.get(fmCustomerId);
      if (!customer) {
        throw new ReceivablesContractError(
          "finance.receivables_customer_binding_missing",
        );
      }
      if (customer.internalTest) {
        excludedInternalTestTransactions += 1;
        continue;
      }

      const amount = amountField(row, "amount");
      const currency = currencyField(row, "currency");
      if ((amount === null) !== (currency === null)) {
        throw new ReceivablesContractError(
          "finance.receivables_amount_currency_mismatch",
        );
      }

      const billingTransactionId = stringField(
        row,
        "billing_transaction_id",
      ) as string;

      transactions.push({
        billingTransactionId,
        fmCustomerId,
        customerDisplayName: customer.displayName,
        productAccountId,
        subscriptionId,
        tenantId: stringField(row, "tenant_id", { nullable: true }),
        providerCode: stringField(row, "provider_code") as string,
        transactionType: enumField<ReceivableTransactionType>(
          row,
          "transaction_type",
          TRANSACTION_TYPES,
        ),
        status: enumField<ReceivableTransactionStatus>(
          row,
          "status",
          TRANSACTION_STATUSES,
        ),
        amount,
        currency,
        reconciliationStatus: enumField<ReceivableReconciliationStatus>(
          row,
          "reconciliation_status",
          RECONCILIATION_STATUSES,
        ),
        providerOccurredAt: isoField(row, "provider_occurred_at", {
          nullable: true,
        }),
        updatedAt: isoField(row, "updated_at") as string,
        provenanceRefs: [
          `source:${source.id}`,
          `billing_transaction:${billingTransactionId}`,
        ],
      });
    }

    const pastDueSubscriptions: PastDueSubscription[] = [];
    for (const [subscriptionId, subscription] of subscriptionById) {
      if (subscription.status !== "past_due") continue;
      const customer = customerById.get(subscription.fmCustomerId);
      if (!customer || customer.internalTest) continue;
      pastDueSubscriptions.push({
        subscriptionId,
        fmCustomerId: subscription.fmCustomerId,
        customerDisplayName: customer.displayName,
        productAccountId: subscription.productAccountId,
        tenantId: subscription.tenantId,
        planCode: subscription.planCode,
        contractedAmount: subscription.contractedAmount,
        currency: subscription.currency,
        currentPeriodEnd: subscription.currentPeriodEnd,
        provenanceRefs: [
          `source:${source.id}`,
          `subscription:${subscriptionId}`,
        ],
      });
    }

    transactions.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
    pastDueSubscriptions.sort((left, right) =>
      (left.currentPeriodEnd ?? "").localeCompare(right.currentPeriodEnd ?? ""),
    );

    const payments = transactions.filter(
      (transaction) => transaction.transactionType === "payment",
    );

    return {
      status: "available",
      reason: "available",
      ...base,
      asOf: snapshot.as_of,
      sourceAuthority: "kordena_commercial_control_plane",
      counts: {
        transactions: transactions.length,
        pendingPayments: payments.filter(
          (transaction) => transaction.status === "pending",
        ).length,
        succeededPayments: payments.filter(
          (transaction) => transaction.status === "succeeded",
        ).length,
        failedPayments: payments.filter(
          (transaction) => transaction.status === "failed",
        ).length,
        refunds: transactions.filter(
          (transaction) => transaction.transactionType === "refund",
        ).length,
        pastDueSubscriptions: pastDueSubscriptions.length,
        reconciliationAttention: transactions.filter(
          (transaction) =>
            transaction.reconciliationStatus === "failed" ||
            transaction.reconciliationStatus === "not_checked",
        ).length,
        excludedInternalTestTransactions,
        excludedUnboundTransactions,
      },
      transactions,
      pastDueSubscriptions,
      coverage: {
        invoices: "unavailable",
        openBalance: "unavailable",
        dueDate: "unavailable",
        delinquencyAmount:
          snapshot.coverage.delinquency_amount === "pending_governed_semantics"
            ? "pending_semantics"
            : "unavailable",
        note:
          "Falha de pagamento, valor contratado e assinatura past_due não são convertidos em fatura, saldo em aberto ou valor inadimplente sem autoridade canônica.",
      },
    };
  }

  private unavailable(
    product: ProductReceivablesOverview["product"],
    reason: "source_not_configured" | "upstream_unavailable",
  ): ProductReceivablesOverview {
    return {
      status: "unavailable",
      reason,
      product,
      asOf: null,
      sourceAuthority: null,
      counts: {
        transactions: 0,
        pendingPayments: 0,
        succeededPayments: 0,
        failedPayments: 0,
        refunds: 0,
        pastDueSubscriptions: 0,
        reconciliationAttention: 0,
        excludedInternalTestTransactions: 0,
        excludedUnboundTransactions: 0,
      },
      transactions: [],
      pastDueSubscriptions: [],
      coverage: {
        invoices: "unavailable",
        openBalance: "unavailable",
        dueDate: "unavailable",
        delinquencyAmount: "unavailable",
        note:
          "Sem fonte canônica disponível, o Command não presume recebíveis, faturas ou inadimplência.",
      },
    };
  }
}
