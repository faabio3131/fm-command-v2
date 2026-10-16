import { FMCC_IRON_PRODUCT_SLUG } from "@/domain/billing/iron-product-identity";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { billingProductPlans } from "@/infrastructure/db/billing-schema";
import { productDefinitions, sourceDefinitions } from "@/infrastructure/db/platform-schema";
import { appendIronPlanMapping, readIronPlanMappings, type IronVersionedPlanMapping } from "@/domain/billing/iron-versioned-plan-mapping";

export class PostgresIronPlanMappingRepository {
  async list(tenantId: string, productId: string, sourceId: string): Promise<readonly IronVersionedPlanMapping[]> {
    const [source] = await db.select({
      config: sourceDefinitions.config,
      name: sourceDefinitions.name,
      sourceType: sourceDefinitions.sourceType,
      productSlug: productDefinitions.slug,
    }).from(sourceDefinitions).innerJoin(productDefinitions, and(
      eq(productDefinitions.tenantId, sourceDefinitions.tenantId),
      eq(productDefinitions.id, sourceDefinitions.productId),
    )).where(and(
      eq(sourceDefinitions.tenantId, tenantId),
      eq(sourceDefinitions.productId, productId),
      eq(sourceDefinitions.id, sourceId),
    )).limit(1);
    if (!source || source.name !== "IRON FIT CORE Commercial" ||
        source.sourceType !== "iron-commercial-v1" || source.productSlug !== FMCC_IRON_PRODUCT_SLUG)
      throw new Error("billing.iron_mapping_source_scope_denied");
    return readIronPlanMappings(source.config);
  }

  async register(
    tenantId: string, productId: string, sourceId: string,
    input: { commercialPlanCode: string; ironPlanCode: string; ironPlanVersion: number },
  ): Promise<{ mapping: IronVersionedPlanMapping; created: boolean }> {
    return db.transaction(async (tx) => {
      // Order mapping registration against invoice preparation for the same plan.
      const scope = ["fmcc.billing.plan-map.v1", tenantId, productId,
        input.commercialPlanCode.trim().toUpperCase()].join(":");
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))`);
      const [source] = await tx.select({
        id: sourceDefinitions.id, config: sourceDefinitions.config,
        name: sourceDefinitions.name, sourceType: sourceDefinitions.sourceType,
        authoritativeDomain: sourceDefinitions.authoritativeDomain,
        secretRef: sourceDefinitions.secretRef, productSlug: productDefinitions.slug,
      }).from(sourceDefinitions).innerJoin(productDefinitions, and(
        eq(productDefinitions.tenantId, sourceDefinitions.tenantId),
        eq(productDefinitions.id, sourceDefinitions.productId),
        eq(productDefinitions.status, "active"),
      )).where(and(
        eq(sourceDefinitions.tenantId, tenantId),
        eq(sourceDefinitions.productId, productId),
        eq(sourceDefinitions.id, sourceId),
      )).for("update", { of: sourceDefinitions }).limit(1);
      if (!source || source.name !== "IRON FIT CORE Commercial" ||
          source.sourceType !== "iron-commercial-v1" ||
          source.authoritativeDomain !== "commercial" ||
          source.secretRef !== "env:FMCC_IRON_CONTROL_PLANE_TOKEN" ||
          source.productSlug !== FMCC_IRON_PRODUCT_SLUG)
        throw new Error("billing.iron_mapping_source_scope_denied");

      const [plan] = await tx.select({ code: billingProductPlans.planCode })
        .from(billingProductPlans).where(and(
          eq(billingProductPlans.tenantId, tenantId),
          eq(billingProductPlans.productId, productId),
          eq(billingProductPlans.planCode, input.commercialPlanCode.trim().toUpperCase()),
          eq(billingProductPlans.status, "active"),
        )).limit(1);
      if (!plan) throw new Error("billing.iron_commercial_plan_not_found");
      const result = appendIronPlanMapping(source.config, input);
      if (result.created) {
        await tx.update(sourceDefinitions).set({ config: result.config, updatedAt: new Date() }).where(and(
          eq(sourceDefinitions.tenantId, tenantId),
          eq(sourceDefinitions.productId, productId),
          eq(sourceDefinitions.id, sourceId),
        ));
      }
      return { mapping: result.mapping, created: result.created };
    });
  }
}
