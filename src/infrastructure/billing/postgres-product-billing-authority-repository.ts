import { FMCC_IRON_PRODUCT_SLUG } from "@/domain/billing/iron-product-identity";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type {
  BillingPreparationView,
  BillingProductPlanView,
  BillingProductRouteView,
  ProductBillingAuthorityRepository,
} from "@/application/billing/product-billing-authority-service";
import { db } from "@/infrastructure/db/client";
import {
  billingCommandRequests,
  billingCustomerBindings,
  billingCustomers,
  billingGatewayAccounts,
  billingInvoices,
  billingProductPlans,
  billingProductRoutes,
  billingSubscriptions,
} from "@/infrastructure/db/billing-schema";
import { productDefinitions, sourceDefinitions } from "@/infrastructure/db/platform-schema";
import { resolveIronPlanMapping } from "@/domain/billing/iron-versioned-plan-mapping";

function asInterval(value: string): "monthly" | "yearly" {
  if (value === "monthly" || value === "yearly") return value;
  throw new Error("billing.plan_interval_invalid");
}

function asPlanStatus(value: string): "active" | "inactive" {
  if (value === "active" || value === "inactive") return value;
  throw new Error("billing.plan_status_invalid");
}

function asEnvironment(value: string): "sandbox" | "production" {
  if (value === "sandbox" || value === "production") return value;
  throw new Error("billing.gateway_environment_invalid");
}

export class PostgresProductBillingAuthorityRepository implements ProductBillingAuthorityRepository {
  async listPlans(tenantId: string, productId: string): Promise<readonly BillingProductPlanView[]> {
    const rows = await db.select().from(billingProductPlans).where(and(
      eq(billingProductPlans.tenantId, tenantId),
      eq(billingProductPlans.productId, productId),
    ));
    return rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      planCode: row.planCode,
      name: row.name,
      interval: asInterval(row.interval),
      amountMinor: row.amountMinor,
      currency: "BRL" as const,
      status: asPlanStatus(row.status),
    }));
  }

  async upsertPlan(tenantId: string, productId: string, input: {
    planCode: string;
    name: string;
    interval: "monthly" | "yearly";
    amountMinor: number;
    status: "active" | "inactive";
  }): Promise<BillingProductPlanView> {
    const [product] = await db.select({ id: productDefinitions.id }).from(productDefinitions).where(and(
      eq(productDefinitions.tenantId, tenantId),
      eq(productDefinitions.id, productId),
      eq(productDefinitions.status, "active"),
    )).limit(1);
    if (!product) throw new Error("billing.product_not_found");

    const [row] = await db.insert(billingProductPlans).values({
      tenantId,
      productId,
      planCode: input.planCode,
      name: input.name,
      interval: input.interval,
      amountMinor: input.amountMinor,
      currency: "BRL",
      status: input.status,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [billingProductPlans.tenantId, billingProductPlans.productId, billingProductPlans.planCode],
      set: {
        name: input.name,
        interval: input.interval,
        amountMinor: input.amountMinor,
        status: input.status,
        updatedAt: new Date(),
      },
    }).returning();
    return {
      id: row.id,
      productId: row.productId,
      planCode: row.planCode,
      name: row.name,
      interval: asInterval(row.interval),
      amountMinor: row.amountMinor,
      currency: "BRL",
      status: asPlanStatus(row.status),
    };
  }

  async getRoute(tenantId: string, productId: string): Promise<BillingProductRouteView | null> {
    const [row] = await db.select({
      productId: billingProductRoutes.productId,
      gatewayAccountId: billingProductRoutes.gatewayAccountId,
      routeStatus: billingProductRoutes.status,
      provider: billingGatewayAccounts.provider,
      environment: billingGatewayAccounts.environment,
    }).from(billingProductRoutes).innerJoin(billingGatewayAccounts, and(
      eq(billingGatewayAccounts.tenantId, billingProductRoutes.tenantId),
      eq(billingGatewayAccounts.id, billingProductRoutes.gatewayAccountId),
    )).where(and(
      eq(billingProductRoutes.tenantId, tenantId),
      eq(billingProductRoutes.productId, productId),
    )).limit(1);
    if (!row) return null;
    return {
      productId: row.productId,
      gatewayAccountId: row.gatewayAccountId,
      provider: row.provider,
      environment: asEnvironment(row.environment),
      status: row.routeStatus === "enabled" ? "enabled" : "disabled",
    };
  }

  async configureRoute(tenantId: string, productId: string, gatewayAccountId: string): Promise<BillingProductRouteView> {
    const [product] = await db.select({ id: productDefinitions.id }).from(productDefinitions).where(and(
      eq(productDefinitions.tenantId, tenantId),
      eq(productDefinitions.id, productId),
      eq(productDefinitions.status, "active"),
    )).limit(1);
    if (!product) throw new Error("billing.product_not_found");

    const [gateway] = await db.select({
      id: billingGatewayAccounts.id,
      provider: billingGatewayAccounts.provider,
      environment: billingGatewayAccounts.environment,
      status: billingGatewayAccounts.status,
    }).from(billingGatewayAccounts).where(and(
      eq(billingGatewayAccounts.tenantId, tenantId),
      eq(billingGatewayAccounts.id, gatewayAccountId),
    )).limit(1);
    if (!gateway || gateway.status !== "enabled") throw new Error("billing.gateway_not_ready");

    await db.insert(billingProductRoutes).values({
      tenantId,
      productId,
      gatewayAccountId,
      status: "enabled",
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [billingProductRoutes.tenantId, billingProductRoutes.productId],
      set: { gatewayAccountId, status: "enabled", updatedAt: new Date() },
    });

    return {
      productId,
      gatewayAccountId,
      provider: gateway.provider,
      environment: asEnvironment(gateway.environment),
      status: "enabled",
    };
  }

  async prepareSubscriptionInvoice(input: {
    tenantId: string;
    productId: string;
    externalTenantId: string;
    planCode: string;
    idempotencyKey: string;
    payloadHash: string;
  }): Promise<BillingPreparationView> {
    return db.transaction(async (tx) => {
      // Different idempotency keys may target the same SaaS tenant concurrently.
      // Serialize before checking bindings/subscriptions to prevent duplicate invoices.
      const subscriptionLockScope = [
        "fmcc.billing.subscription.v1",
        input.tenantId,
        input.productId,
        input.externalTenantId,
      ].join(":");
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${subscriptionLockScope}, 0))`);
      // Serializes invoice issuance with immutable mapping registration.
      // A mapping registered after invoice issuance never authorizes the older invoice.
      const planMappingLockScope = [
        "fmcc.billing.plan-map.v1",
        input.tenantId,
        input.productId,
        input.planCode,
      ].join(":");
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${planMappingLockScope}, 0))`);


      const [replay] = await tx.select({
        payloadHash: billingCommandRequests.payloadHash,
        productId: billingCommandRequests.productId,
        invoiceId: billingCommandRequests.resultInvoiceId,
      }).from(billingCommandRequests).where(and(
        eq(billingCommandRequests.tenantId, input.tenantId),
        eq(billingCommandRequests.idempotencyKey, input.idempotencyKey),
      )).limit(1);

      if (replay) {
        if (replay.payloadHash !== input.payloadHash || replay.productId !== input.productId || !replay.invoiceId)
          throw new Error("billing.idempotency_conflict");
        const [existing] = await tx.select({
          productId: billingInvoices.productId,
          customerId: billingInvoices.customerId,
          subscriptionId: billingInvoices.subscriptionId,
          invoiceId: billingInvoices.id,
          amountMinor: billingInvoices.amountMinor,
          currency: billingInvoices.currency,
          invoiceStatus: billingInvoices.status,
          planCode: billingSubscriptions.planCode,
          gatewayAccountId: billingInvoices.gatewayAccountId,
          provider: billingGatewayAccounts.provider,
          environment: billingGatewayAccounts.environment,
          externalTenantId: billingCustomerBindings.externalTenantId,
        }).from(billingInvoices)
          .innerJoin(billingSubscriptions, and(
            eq(billingSubscriptions.tenantId, billingInvoices.tenantId),
            eq(billingSubscriptions.id, billingInvoices.subscriptionId),
          ))
          .innerJoin(billingGatewayAccounts, and(
            eq(billingGatewayAccounts.tenantId, billingInvoices.tenantId),
            eq(billingGatewayAccounts.id, billingInvoices.gatewayAccountId),
          ))
          .innerJoin(billingCustomerBindings, and(
            eq(billingCustomerBindings.tenantId, billingInvoices.tenantId),
            eq(billingCustomerBindings.productId, billingInvoices.productId),
            eq(billingCustomerBindings.customerId, billingInvoices.customerId),
          ))
          .where(and(
            eq(billingInvoices.tenantId, input.tenantId),
            eq(billingInvoices.id, replay.invoiceId),
          )).limit(1);
        if (!existing) throw new Error("billing.idempotency_result_missing");
        return {
          productId: existing.productId,
          externalTenantId: existing.externalTenantId,
          customerId: existing.customerId,
          subscriptionId: existing.subscriptionId,
          invoiceId: existing.invoiceId,
          planCode: existing.planCode,
          amountMinor: existing.amountMinor,
          currency: existing.currency === "BRL" ? "BRL" : "BRL",
          gatewayAccountId: existing.gatewayAccountId,
          gatewayProvider: existing.provider,
          gatewayEnvironment: asEnvironment(existing.environment),
          invoiceStatus: existing.invoiceStatus,
          idempotentReplay: true,
        };
      }

      const [product] = await tx.select({ id: productDefinitions.id, slug: productDefinitions.slug }).from(productDefinitions).where(and(
        eq(productDefinitions.tenantId, input.tenantId),
        eq(productDefinitions.id, input.productId),
        eq(productDefinitions.status, "active"),
      )).limit(1);
      if (!product) throw new Error("billing.product_not_found");

      const [plan] = await tx.select().from(billingProductPlans).where(and(
        eq(billingProductPlans.tenantId, input.tenantId),
        eq(billingProductPlans.productId, input.productId),
        eq(billingProductPlans.planCode, input.planCode),
        eq(billingProductPlans.status, "active"),
      )).limit(1);
      if (!plan) throw new Error("billing.plan_not_found");

      if (product.slug === FMCC_IRON_PRODUCT_SLUG) {
        // Fail closed BEFORE issuing an IRON invoice if no approved immutable
        // commercial→entitlement version mapping exists for its plan.
        const sources = await tx.select({
          config: sourceDefinitions.config,
          name: sourceDefinitions.name,
          type: sourceDefinitions.sourceType,
          domain: sourceDefinitions.authoritativeDomain,
        }).from(sourceDefinitions).where(and(
          eq(sourceDefinitions.tenantId, input.tenantId),
          eq(sourceDefinitions.productId, input.productId),
          eq(sourceDefinitions.sourceType, "iron-commercial-v1"),
        ));
        if (sources.length !== 1 || sources[0].name !== "IRON FIT CORE Commercial" ||
            sources[0].domain !== "commercial") {
          throw new Error("billing.iron_plan_mapping_source_missing");
        }
        resolveIronPlanMapping(sources[0].config, plan.planCode);
      }


      const [route] = await tx.select({
        gatewayAccountId: billingProductRoutes.gatewayAccountId,
        provider: billingGatewayAccounts.provider,
        environment: billingGatewayAccounts.environment,
        gatewayStatus: billingGatewayAccounts.status,
      }).from(billingProductRoutes).innerJoin(billingGatewayAccounts, and(
        eq(billingGatewayAccounts.tenantId, billingProductRoutes.tenantId),
        eq(billingGatewayAccounts.id, billingProductRoutes.gatewayAccountId),
      )).where(and(
        eq(billingProductRoutes.tenantId, input.tenantId),
        eq(billingProductRoutes.productId, input.productId),
        eq(billingProductRoutes.status, "enabled"),
      )).limit(1);
      if (!route || route.gatewayStatus !== "enabled") throw new Error("billing.product_route_not_ready");

      let [binding] = await tx.select({
        customerId: billingCustomerBindings.customerId,
      }).from(billingCustomerBindings).where(and(
        eq(billingCustomerBindings.tenantId, input.tenantId),
        eq(billingCustomerBindings.productId, input.productId),
        eq(billingCustomerBindings.externalTenantId, input.externalTenantId),
      )).limit(1);

      if (!binding) {
        const [customer] = await tx.insert(billingCustomers).values({
          tenantId: input.tenantId,
          externalCustomerId: "pending:" + randomUUID(),
        }).returning({ id: billingCustomers.id });
        await tx.insert(billingCustomerBindings).values({
          tenantId: input.tenantId,
          productId: input.productId,
          customerId: customer.id,
          externalTenantId: input.externalTenantId,
        });
        binding = { customerId: customer.id };
      }

      const [live] = await tx.select({ id: billingSubscriptions.id }).from(billingSubscriptions).where(and(
        eq(billingSubscriptions.tenantId, input.tenantId),
        eq(billingSubscriptions.productId, input.productId),
        eq(billingSubscriptions.customerId, binding.customerId),
        inArray(billingSubscriptions.status, ["pending", "active", "past_due"]),
      )).limit(1);
      if (live) throw new Error("billing.subscription_exists");

      const [subscription] = await tx.insert(billingSubscriptions).values({
        tenantId: input.tenantId,
        productId: input.productId,
        customerId: binding.customerId,
        planCode: plan.planCode,
        status: "pending",
      }).returning({ id: billingSubscriptions.id });

      const [invoice] = await tx.insert(billingInvoices).values({
        tenantId: input.tenantId,
        productId: input.productId,
        customerId: binding.customerId,
        subscriptionId: subscription.id,
        gatewayAccountId: route.gatewayAccountId,
        currency: "BRL",
        amountMinor: plan.amountMinor,
        status: "pending",
      }).returning({ id: billingInvoices.id, status: billingInvoices.status });

      await tx.insert(billingCommandRequests).values({
        tenantId: input.tenantId,
        productId: input.productId,
        idempotencyKey: input.idempotencyKey,
        action: "prepare_subscription_invoice",
        payloadHash: input.payloadHash,
        resultInvoiceId: invoice.id,
      });

      return {
        productId: input.productId,
        externalTenantId: input.externalTenantId,
        customerId: binding.customerId,
        subscriptionId: subscription.id,
        invoiceId: invoice.id,
        planCode: plan.planCode,
        amountMinor: plan.amountMinor,
        currency: "BRL",
        gatewayAccountId: route.gatewayAccountId,
        gatewayProvider: route.provider,
        gatewayEnvironment: asEnvironment(route.environment),
        invoiceStatus: invoice.status,
        idempotentReplay: false,
      };
    });
  }
}
