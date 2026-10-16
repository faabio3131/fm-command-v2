import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/** Pacote por setor ligado em uma empresa (etapa 13). Desligar apaga a linha; os fatos e valores já gravados continuam. */
export const sectorPacks = pgTable("fmcc_sector_pack", {
  tenantId: text("tenant_id").notNull(),
  packId: text("pack_id").notNull(),
  /** Versão do pacote no momento em que foi ligado. */
  packVersion: integer("pack_version").notNull(),
  enabledBy: text("enabled_by").notNull(),
  enabledAt: timestamp("enabled_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.packId] }),
  index("fmcc_sector_pack_tenant_idx").on(t.tenantId),
]);
