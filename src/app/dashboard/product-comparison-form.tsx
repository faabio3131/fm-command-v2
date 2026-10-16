"use client";

import { FormEvent, useState } from "react";
import { useTranslator } from "@/i18n/react/i18n-provider";
import { createLabels } from "@/presentation/labels";

type Product = { id: string; name: string; slug: string };
type ComparisonPayload = {
  metricId?: string;
  status?: "comparable" | "unavailable" | "pending_semantics" | "incompatible_currency" | "incompatible_period";
  values?: Array<{ product: Product; value: { value: string | null; unit: string; currency?: string } | null }>;
  error?: string;
};

const METRICS = ["trial.starts.count", "subscription.active.count", "subscription.cancelled.count", "billing.gross_billed", "revenue.cash_collected"] as const;

export function ProductComparisonForm({ products }: { products: readonly Product[] }) {
  const { t, locale } = useTranslator();
  const labels = createLabels(locale);
  const [result, setResult] = useState<ComparisonPayload | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const metricId = String(form.get("metricId") ?? "");
    const productA = String(form.get("productA") ?? "");
    const productB = String(form.get("productB") ?? "");
    if (!metricId || !productA || !productB || productA === productB) {
      setResult({ error: t("products.compare.pickTwo") });
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ metricId });
      params.append("productId", productA);
      params.append("productId", productB);
      const response = await fetch(`/api/products/compare?${params.toString()}`);
      const payload = await response.json() as ComparisonPayload;
      setResult(response.ok ? payload : { error: labels.compareError(payload.error) });
    } catch {
      setResult({ error: labels.compareError() });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="comparison-panel">
      <form className="comparison-form" onSubmit={submit}>
        <label>{t("products.compare.metric")}<select name="metricId" defaultValue={METRICS[0]}>{METRICS.map((id) => <option key={id} value={id}>{labels.metric(id)}</option>)}</select></label>
        <label>{t("products.compare.a")}<select name="productA" defaultValue={products[0]?.id}>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
        <label>{t("products.compare.b")}<select name="productB" defaultValue={products[1]?.id}>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
        <button className="button" type="submit" disabled={loading}>{loading ? t("products.compare.running") : t("products.compare.submit")}</button>
      </form>
      {result ? (
        <div className="comparison-result" role="status">
          {result.error ? <p className="error">{result.error}</p> : (
            <>
              <strong>{t("products.compare.state", { value: labels.comparisonState(result.status) })}</strong>
              {result.status === "comparable" ? (
                <ul>{result.values?.map(({ product, value }) => <li key={product.id}>{product.name}: {value?.value ?? t("common.unavailable")} {value?.currency ?? labels.unit(value?.unit)}</li>)}</ul>
              ) : <p>{labels.comparisonMessage(result.status)}</p>}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
