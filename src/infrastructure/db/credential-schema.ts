import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Credenciais dos conectores de cada empresa. Só texto cifrado: a chave de
 * cifra vem do ambiente (FMCC_CREDENTIAL_KEY), nunca do banco.
 */
export const sourceCredentials = pgTable("fmcc_source_credential", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  secretRef: text("secret_ref").notNull(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("fmcc_source_credential_ref_uq").on(t.tenantId, t.secretRef),
  index("fmcc_source_credential_tenant_idx").on(t.tenantId),
]);

/** Estado do fluxo OAuth em andamento: uso único, curto, preso à empresa, usuário e fonte. */
export const oauthStates = pgTable("fmcc_oauth_state", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Só o hash do `state`: um vazamento do banco não entrega estados ativos. */
  stateHash: text("state_hash").notNull(),
  tenantId: text("tenant_id").notNull(),
  userId: text("user_id").notNull(),
  sourceId: uuid("source_id").notNull(),
  providerId: text("provider_id").notNull(),
  verifierCiphertext: text("verifier_ciphertext"),
  verifierIv: text("verifier_iv"),
  verifierAuthTag: text("verifier_auth_tag"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("fmcc_oauth_state_hash_uq").on(t.stateHash),
  index("fmcc_oauth_state_tenant_idx").on(t.tenantId),
]);
