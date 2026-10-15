import { FMCC_IRON_PRODUCT_SLUG } from "@/domain/billing/iron-product-identity";
import { and, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import {
  billingCustomerBindings,
  billingGatewayAccounts,
  billingInvoices,
  billingProductRoutes,
  billingProviderPayments,
  billingSubscriptions,
} from "@/infrastructure/db/billing-schema";
import { productDefinitions } from "@/infrastructure/db/platform-schema";
import type { PaidIronInvoiceRepository, VerifiedIronPayment } from "@/application/billing/iron-paid-license-reconciliation-service";

/**
 * FM Command owns the payment proof. SaaS/browser claims and webhook bodies never
 * supply the payment state, amount, product binding or recipient gym.
 */
export class PostgresPaidIronInvoiceRepository implements PaidIronInvoiceRepository {
  async findVerifiedProductionPayment(
    tenantId: string,
    productId: string,
    invoiceId: string,
  ): Promise<VerifiedIronPayment | null> {
    const [row] = await db.select({
      tenantId: billingInvoices.tenantId,
      productId: billingInvoices.productId,
      invoiceId: billingInvoices.id,
      invoiceCreatedAt: billingInvoices.createdAt,
      externalTenantId: billingCustomerBindings.externalTenantId,
      planCode: billingSubscriptions.planCode,
      amountMinor: billingInvoices.amountMinor,
      paymentId: billingProviderPayments.externalPaymentId,
      invoiceStatus: billingInvoices.status,
      paymentStatus: billingProviderPayments.status,
      gatewayEnvironment: billingGatewayAccounts.environment,
      productSlug: productDefinitions.slug,
    }).from(billingInvoices)
      .innerJoin(billingSubscriptions, and(
        eq(billingSubscriptions.tenantId, billingInvoices.tenantId),
        eq(billingSubscriptions.id, billingInvoices.subscriptionId),
        eq(billingSubscriptions.productId, billingInvoices.productId),
        eq(billingSubscriptions.customerId, billingInvoices.customerId),
      ))
      .innerJoin(billingProviderPayments, and(
        eq(billingProviderPayments.tenantId, billingInvoices.tenantId),
        eq(billingProviderPayments.invoiceId, billingInvoices.id),
        eq(billingProviderPayments.gatewayAccountId, billingInvoices.gatewayAccountId),
      ))
      .innerJoin(billingGatewayAccounts, and(
        eq(billingGatewayAccounts.tenantId, billingInvoices.tenantId),
        eq(billingGatewayAccounts.id, billingInvoices.gatewayAccountId),
      ))
      .innerJoin(billingProductRoutes, and(
        eq(billingProductRoutes.tenantId, billingInvoices.tenantId),
        eq(billingProductRoutes.productId, billingInvoices.productId),
        eq(billingProductRoutes.gatewayAccountId, billingInvoices.gatewayAccountId),
      ))
      .innerJoin(billingCustomerBindings, and(
        eq(billingCustomerBindings.tenantId, billingInvoices.tenantId),
        eq(billingCustomerBindings.productId, billingInvoices.productId),
        eq(billingCustomerBindings.customerId, billingInvoices.customerId),
      ))
      .innerJoin(productDefinitions, and(
        eq(productDefinitions.tenantId, billingInvoices.tenantId),
        eq(productDefinitions.id, billingInvoices.productId),
      ))
      .where(and(
        eq(billingInvoices.tenantId, tenantId),
        eq(billingInvoices.productId, productId),
        eq(billingInvoices.id, invoiceId),
        eq(billingInvoices.currency, "BRL"),
        eq(billingInvoices.status, "paid"),
        eq(billingProviderPayments.status, "received"),
        eq(billingGatewayAccounts.environment, "production"),
        eq(billingGatewayAccounts.status, "enabled"),
        eq(billingProductRoutes.status, "enabled"),
        eq(productDefinitions.status, "active"),
        eq(productDefinitions.slug, FMCC_IRON_PRODUCT_SLUG),
      )).limit(1);
    if (!row) return null;
    return {
      tenantId: row.tenantId,
      productId: row.productId,
      invoiceId: row.invoiceId,
      invoiceCreatedAt: row.invoiceCreatedAt.toISOString(),
      externalTenantId: row.externalTenantId,
      planCode: row.planCode,
      amountMinor: row.amountMinor,
      paymentId: row.paymentId,
      invoiceStatus: row.invoiceStatus,
      paymentStatus: row.paymentStatus,
      gatewayEnvironment: row.gatewayEnvironment,
      productSlug: row.productSlug,
    };
  }
}
