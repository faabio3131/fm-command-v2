export type ReceivableTransactionType = "payment" | "refund";
export type ReceivableTransactionStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "refunded";
export type ReceivableReconciliationStatus =
  | "not_checked"
  | "in_sync"
  | "repaired"
  | "failed";

export interface ReceivableTransaction {
  readonly billingTransactionId: string;
  readonly fmCustomerId: string;
  readonly customerDisplayName: string;
  readonly productAccountId: string;
  readonly subscriptionId: string;
  readonly tenantId: string | null;
  readonly providerCode: string;
  readonly transactionType: ReceivableTransactionType;
  readonly status: ReceivableTransactionStatus;
  readonly amount: string | null;
  readonly currency: string | null;
  readonly reconciliationStatus: ReceivableReconciliationStatus;
  readonly providerOccurredAt: string | null;
  readonly updatedAt: string;
  readonly provenanceRefs: readonly string[];
}

export interface PastDueSubscription {
  readonly subscriptionId: string;
  readonly fmCustomerId: string;
  readonly customerDisplayName: string;
  readonly productAccountId: string;
  readonly tenantId: string | null;
  readonly planCode: string;
  readonly contractedAmount: string;
  readonly currency: string;
  readonly currentPeriodEnd: string | null;
  readonly provenanceRefs: readonly string[];
}

export interface ProductReceivablesOverview {
  readonly status: "available" | "unavailable";
  readonly reason:
    | "available"
    | "source_not_configured"
    | "upstream_unavailable";
  readonly product: {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
  };
  readonly asOf: string | null;
  readonly sourceAuthority: string | null;
  readonly counts: {
    readonly transactions: number;
    readonly pendingPayments: number;
    readonly succeededPayments: number;
    readonly failedPayments: number;
    readonly refunds: number;
    readonly pastDueSubscriptions: number;
    readonly reconciliationAttention: number;
    readonly excludedInternalTestTransactions: number;
    readonly excludedUnboundTransactions: number;
  };
  readonly transactions: readonly ReceivableTransaction[];
  readonly pastDueSubscriptions: readonly PastDueSubscription[];
  readonly coverage: {
    readonly invoices: "unavailable";
    readonly openBalance: "unavailable";
    readonly dueDate: "unavailable";
    readonly delinquencyAmount: "pending_semantics" | "unavailable";
    readonly note: string;
  };
}

export class ReceivablesContractError extends Error {
  constructor(code = "finance.receivables_contract_invalid") {
    super(code);
  }
}
