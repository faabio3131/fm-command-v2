import { and, eq, sql } from "drizzle-orm";
import { credentialVaultEnv } from "@/config/env";
import { CredentialNotFoundError, type ConnectorCredential, type CredentialStore } from "@/domain/integration/credentials";
import { db } from "@/infrastructure/db/client";
import { sourceCredentials } from "@/infrastructure/db/credential-schema";
import { logEvent } from "@/infrastructure/observability/logger";
import { openCredential, sealCredential } from "./credential-crypto";

export class PostgresCredentialStore implements CredentialStore {
  constructor(private readonly keyProvider: () => Buffer = () => credentialVaultEnv().key) {}

  async resolve(tenantId: string, secretRef: string): Promise<ConnectorCredential> {
    const [row] = await db
      .select()
      .from(sourceCredentials)
      .where(and(eq(sourceCredentials.tenantId, tenantId), eq(sourceCredentials.secretRef, secretRef)))
      .limit(1);
    if (!row) throw new CredentialNotFoundError();
    const key = this.keyProvider(); // chave ausente/inválida é erro de configuração, não "credencial não encontrada"
    try {
      return openCredential(key, tenantId, secretRef, row);
    } catch {
      // Chave de cifra trocada ou linha adulterada: não expor o motivo.
      throw new CredentialNotFoundError();
    }
  }

  /**
   * Renovação segura: lê a linha com trava (FOR UPDATE), deixa `fn` produzir o novo
   * valor a partir do mais recente e grava na mesma transação. A conexão fica
   * ocupada durante a chamada ao provedor; o prazo dessa chamada é curto por contrato.
   */
  async updateLocked(
    tenantId: string,
    secretRef: string,
    fn: (current: ConnectorCredential) => Promise<ConnectorCredential>,
  ): Promise<ConnectorCredential> {
    const key = this.keyProvider();
    return db.transaction(async (tx) => {
      // Quem espera a trava não segura uma conexão do pool para sempre.
      await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
      const [row] = await tx
        .select()
        .from(sourceCredentials)
        .where(and(eq(sourceCredentials.tenantId, tenantId), eq(sourceCredentials.secretRef, secretRef)))
        .for("update")
        .limit(1);
      if (!row) throw new CredentialNotFoundError();
      let current: ConnectorCredential;
      try {
        current = openCredential(key, tenantId, secretRef, row);
      } catch {
        throw new CredentialNotFoundError();
      }
      const next = await fn(current);
      if (next !== current) {
        try {
          const sealed = sealCredential(key, tenantId, secretRef, next);
          await tx
            .update(sourceCredentials)
            .set({ ...sealed, updatedAt: new Date() })
            .where(eq(sourceCredentials.id, row.id));
        } catch (error) {
          // O provedor pode já ter invalidado o refresh token antigo: a conexão talvez precise ser refeita.
          logEvent("error", "credential_refresh_not_persisted", { tenantId, secretRef });
          throw error;
        }
      }
      return next;
    });
  }

  async save(tenantId: string, secretRef: string, credential: ConnectorCredential): Promise<void> {
    const sealed = sealCredential(this.keyProvider(), tenantId, secretRef, credential);
    await db
      .insert(sourceCredentials)
      .values({ tenantId, secretRef, ...sealed })
      .onConflictDoUpdate({
        target: [sourceCredentials.tenantId, sourceCredentials.secretRef],
        set: { ...sealed, updatedAt: new Date() },
      });
  }
}
