import { and, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { billingGatewayAccounts, billingInvoices, billingProviderPayments, billingSubscriptions } from "@/infrastructure/db/billing-schema";
import type { BillingAttribution } from "@/domain/billing/payment-attribution";
import type { CanonicalBillingRepository } from "@/application/billing/canonical-billing-service";

/** Tenant-scoped PostgreSQL implementation of the FM Command canonical billing port. */
export class PostgresCanonicalBillingRepository implements CanonicalBillingRepository {
  async findInvoice(tenantId: string, invoiceId: string): Promise<BillingAttribution | null> {
    const rows = await db.select({
      invoice: billingInvoices,
      subscription: billingSubscriptions,
      gateway: billingGatewayAccounts,
    }).from(billingInvoices)
      .innerJoin(billingSubscriptions, and(eq(billingInvoices.tenantId, billingSubscriptions.tenantId),eq(billingInvoices.subscriptionId,billingSubscriptions.id),eq(billingInvoices.productId,billingSubscriptions.productId),eq(billingInvoices.customerId,billingSubscriptions.customerId)))
      .innerJoin(billingGatewayAccounts, and(eq(billingInvoices.tenantId,billingGatewayAccounts.tenantId),eq(billingInvoices.gatewayAccountId,billingGatewayAccounts.id)))
      .where(and(eq(billingInvoices.tenantId,tenantId),eq(billingInvoices.id,invoiceId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      tenantId: row.invoice.tenantId, invoiceId:row.invoice.id,
      productId:row.invoice.productId, customerId:row.invoice.customerId,
      subscriptionId:row.invoice.subscriptionId, gatewayAccountId:row.invoice.gatewayAccountId,
      environment:row.gateway.environment as "sandbox"|"production",
      amountMinor:row.invoice.amountMinor,currency:row.invoice.currency as "BRL",
    };
  }
  async reserveInvoiceForCharge(tenantId:string,invoiceId:string):Promise<boolean> {
    const rows = await db.update(billingInvoices).set({status:"creating"}).where(and(eq(billingInvoices.tenantId,tenantId),eq(billingInvoices.id,invoiceId),eq(billingInvoices.status,"pending"))).returning({id:billingInvoices.id});
    return rows.length === 1;
  }
  async findPayment(tenantId:string,gatewayAccountId:string,externalPaymentId:string) {
    const rows=await db.select({invoiceId:billingProviderPayments.invoiceId,status:billingProviderPayments.status}).from(billingProviderPayments)
      .where(and(eq(billingProviderPayments.tenantId,tenantId),eq(billingProviderPayments.gatewayAccountId,gatewayAccountId),eq(billingProviderPayments.externalPaymentId,externalPaymentId))).limit(1);
    return rows[0]??null;
  }
  async findInvoicePayment(tenantId:string,invoiceId:string) {
    const rows=await db.select({externalPaymentId:billingProviderPayments.externalPaymentId}).from(billingProviderPayments)
      .where(and(eq(billingProviderPayments.tenantId,tenantId),eq(billingProviderPayments.invoiceId,invoiceId))).limit(1);
    return rows[0]??null;
  }
  async recoverPayment(input:{binding:BillingAttribution;externalPaymentId:string;status:string}):Promise<void> {
    const b=input.binding;
    await db.transaction(async tx => {
      const rows=await tx.select({id:billingInvoices.id}).from(billingInvoices)
        .where(and(eq(billingInvoices.tenantId,b.tenantId),eq(billingInvoices.id,b.invoiceId),
          eq(billingInvoices.productId,b.productId),eq(billingInvoices.customerId,b.customerId),
          eq(billingInvoices.subscriptionId,b.subscriptionId),eq(billingInvoices.gatewayAccountId,b.gatewayAccountId),
          eq(billingInvoices.status,"creating"))).for("update").limit(1);
      if (!rows.length) throw new Error("billing.recovery_state_invalid");
      await tx.insert(billingProviderPayments).values({
        tenantId:b.tenantId,invoiceId:b.invoiceId,gatewayAccountId:b.gatewayAccountId,
        externalPaymentId:input.externalPaymentId,status:input.status,
      });
    });
  }
  async recordPayment(input:{binding:BillingAttribution;externalPaymentId:string;status:string}):Promise<void> {
    const b=input.binding;
    await db.transaction(async tx => {
      const invoices=await tx.select({id:billingInvoices.id,gatewayAccountId:billingInvoices.gatewayAccountId}).from(billingInvoices)
        .where(and(eq(billingInvoices.tenantId,b.tenantId),eq(billingInvoices.id,b.invoiceId),eq(billingInvoices.productId,b.productId),eq(billingInvoices.customerId,b.customerId),eq(billingInvoices.subscriptionId,b.subscriptionId),eq(billingInvoices.gatewayAccountId,b.gatewayAccountId))).limit(1);
      if (!invoices.length) throw new Error("billing.payment_binding_mismatch");
      await tx.insert(billingProviderPayments).values({
        tenantId:b.tenantId,invoiceId:b.invoiceId,gatewayAccountId:b.gatewayAccountId,
        externalPaymentId:input.externalPaymentId,status:input.status,
      });
    });
  }
  async markInvoicePaid(tenantId:string,invoiceId:string,externalPaymentId:string):Promise<void> {
    await db.transaction(async tx => {
      const invoices=await tx.select({id:billingInvoices.id,gatewayAccountId:billingInvoices.gatewayAccountId}).from(billingInvoices)
        .where(and(eq(billingInvoices.tenantId,tenantId),eq(billingInvoices.id,invoiceId))).limit(1);
      if (!invoices.length) throw new Error("billing.invoice_not_found");
      const invoice=invoices[0];
      const payment=await tx.select({id:billingProviderPayments.id,invoiceId:billingProviderPayments.invoiceId}).from(billingProviderPayments)
        .where(and(eq(billingProviderPayments.tenantId,tenantId),eq(billingProviderPayments.gatewayAccountId,invoice.gatewayAccountId),eq(billingProviderPayments.invoiceId,invoiceId),eq(billingProviderPayments.externalPaymentId,externalPaymentId))).limit(1);
      if (!payment.length) throw new Error("billing.payment_binding_mismatch");
      await tx.update(billingProviderPayments).set({status:"received"}).where(eq(billingProviderPayments.id,payment[0].id));
      await tx.update(billingInvoices).set({status:"paid"}).where(and(eq(billingInvoices.tenantId,tenantId),eq(billingInvoices.id,invoiceId)));
    });
  }
}
