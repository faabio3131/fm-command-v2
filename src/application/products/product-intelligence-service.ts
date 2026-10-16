import type { MetricService, MetricView } from "@/application/metrics/metric-service";
import { ProductRegistryService } from "@/application/products/product-registry-service";
import { getMetricDefinition } from "@/domain/metrics/registry";
import { PRODUCT_GROWTH_METRICS, PRODUCT_INTELLIGENCE_TARGETS } from "@/domain/products/intelligence";
import type { ProductRepository } from "@/domain/products/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";

type MetricState = "available" | "unavailable" | "pending_semantics";
type ComparisonStatus = "comparable" | "unavailable" | "pending_semantics" | "incompatible_currency" | "incompatible_period";
type GrowthStatus = "available" | "unavailable" | "incompatible";
type GrowthDirection = "increased" | "decreased" | "unchanged";

function temporalKey(value: MetricView): string | null {
  if (value.asOf) return `asof:${value.asOf.toISOString()}`;
  if (value.periodStart || value.periodEnd) {
    return `period:${value.periodStart?.toISOString() ?? "?"}:${value.periodEnd?.toISOString() ?? "?"}`;
  }
  return null;
}

function comparablePeriod(values: readonly MetricView[]): boolean {
  const keys = values.map(temporalKey);
  return keys.every((key) => key !== null && key === keys[0]);
}

function decimalParts(raw: string): { units: bigint; scale: number } | null {
  const value = raw.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  return { units: BigInt(`${whole}${fraction}`) * (negative ? -1n : 1n), scale: fraction.length };
}

function compareDecimalStrings(left: string, right: string): number | null {
  const a = decimalParts(left);
  const b = decimalParts(right);
  if (!a || !b) return null;
  const scale = Math.max(a.scale, b.scale);
  const av = a.units * 10n ** BigInt(scale - a.scale);
  const bv = b.units * 10n ** BigInt(scale - b.scale);
  return av === bv ? 0 : av > bv ? 1 : -1;
}

export class ProductIntelligenceService {
  private readonly registry: ProductRegistryService;

  constructor(products: ProductRepository, private readonly metrics: MetricService) {
    this.registry = new ProductRegistryService(products);
  }

  async overview(context: TenantContext, productId: string) {
    const product = await this.registry.get(context, productId);
    const metrics = await Promise.all(PRODUCT_INTELLIGENCE_TARGETS.map(async (target) => {
      const definition = getMetricDefinition(target.metricId);
      if (!definition) return { target, status: "pending_semantics" as MetricState, value: null };
      const value = await this.metrics.query(context, target.metricId, product.id);
      return { target, status: value?.value !== null && value ? "available" as MetricState : "unavailable" as MetricState, value };
    }));

    const growth = await Promise.all(PRODUCT_GROWTH_METRICS.map(async (metricId) => {
      const history = await this.metrics.history(context, metricId, product.id, 2);
      if (history.length < 2 || history.some((item) => item.value === null)) {
        return { metricId, status: "unavailable" as GrowthStatus };
      }
      const [current, previous] = history;
      if (current.unit !== previous.unit || current.currency !== previous.currency) {
        return { metricId, status: "incompatible" as GrowthStatus };
      }
      const currentKey = temporalKey(current);
      const previousKey = temporalKey(previous);
      if (!currentKey || !previousKey || currentKey === previousKey) {
        return { metricId, status: "unavailable" as GrowthStatus };
      }
      const comparison = compareDecimalStrings(current.value as string, previous.value as string);
      if (comparison === null) return { metricId, status: "incompatible" as GrowthStatus };
      const direction: GrowthDirection = comparison > 0 ? "increased" : comparison < 0 ? "decreased" : "unchanged";
      return { metricId, status: "available" as GrowthStatus, direction, current, previous };
    }));

    return { product, metrics, growth };
  }

  async compare(context: TenantContext, metricId: string, productIds: readonly string[]) {
    const uniqueProductIds = [...new Set(productIds)];
    if (uniqueProductIds.length < 2 || uniqueProductIds.length > 8) throw new Error("product.compare_scope_invalid");
    const definition = getMetricDefinition(metricId);
    const products = await Promise.all(uniqueProductIds.map((productId) => this.registry.get(context, productId)));
    if (!definition) {
      return { metricId, status: "pending_semantics" as ComparisonStatus, products, values: [] };
    }

    const values = await Promise.all(products.map(async (product) => ({
      product,
      value: await this.metrics.query(context, metricId, product.id),
    })));
    const available = values.map((item) => item.value).filter((value): value is MetricView => Boolean(value && value.value !== null));
    if (available.length !== products.length) return { metricId, status: "unavailable" as ComparisonStatus, products, values };

    const currencies = new Set(available.map((value) => value.currency ?? ""));
    if (currencies.size > 1) return { metricId, status: "incompatible_currency" as ComparisonStatus, products, values };
    if (!comparablePeriod(available)) return { metricId, status: "incompatible_period" as ComparisonStatus, products, values };

    return { metricId, status: "comparable" as ComparisonStatus, products, values };
  }
}
