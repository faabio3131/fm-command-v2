export function assertNoPreviousPayment(list) {
  if (!list || typeof list !== "object" || !Array.isArray(list.data) ||
      !Number.isSafeInteger(list.totalCount) || list.totalCount < 0) {
    throw new Error("billing.provider_duplicate_check_unavailable");
  }
  if (list.totalCount !== 0 || list.data.length !== 0) {
    throw new Error("billing.provider_invoice_already_present");
  }
}
