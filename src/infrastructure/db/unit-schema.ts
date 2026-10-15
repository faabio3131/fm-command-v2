import { check, foreignKey, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Hierarquia de unidades dentro da empresa cliente (ADR-019). */
export const orgUnits = pgTable("fmcc_org_unit", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  parentId: uuid("parent_id"),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  countryCode: text("country_code"),
  timezone: text("timezone"),
  currency: text("currency"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Chave composta: permite que filhos, concessões e métricas só apontem para unidade da MESMA empresa.
  uniqueIndex("fmcc_org_unit_tenant_id_uq").on(t.tenantId, t.id),
  uniqueIndex("fmcc_org_unit_one_company_uq").on(t.tenantId).where(sql`${t.kind} = 'company'`),
  index("fmcc_org_unit_tenant_parent_idx").on(t.tenantId, t.parentId),
  foreignKey({ columns: [t.tenantId, t.parentId], foreignColumns: [t.tenantId, t.id], name: "fmcc_org_unit_parent_fk" }),
  check("fmcc_org_unit_kind_ck", sql`${t.kind} in ('company','region','branch')`),
  check("fmcc_org_unit_company_root_ck", sql`(${t.kind} = 'company') = (${t.parentId} is null)`),
  check("fmcc_org_unit_not_self_parent_ck", sql`${t.parentId} is distinct from ${t.id}`),
  check("fmcc_org_unit_country_ck", sql`${t.countryCode} is null or ${t.countryCode} ~ '^[A-Z]{2}$'`),
  check("fmcc_org_unit_currency_ck", sql`${t.currency} is null or ${t.currency} ~ '^[A-Z]{3}$'`),
]);

/** Concessão de acesso de uma pessoa a uma unidade (e às descendentes dela). */
export const unitGrants = pgTable("fmcc_unit_grant", {
  tenantId: text("tenant_id").notNull(),
  userId: text("user_id").notNull(),
  unitId: uuid("unit_id").notNull(),
  grantedBy: text("granted_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.userId, t.unitId] }),
  foreignKey({ columns: [t.tenantId, t.unitId], foreignColumns: [orgUnits.tenantId, orgUnits.id], name: "fmcc_unit_grant_unit_fk" }).onDelete("cascade"),
  index("fmcc_unit_grant_tenant_user_idx").on(t.tenantId, t.userId),
]);
