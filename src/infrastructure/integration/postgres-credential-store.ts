import { and, eq } from "drizzle-orm";
import { credentialVaultEnv } from "@/config/env";
import { CredentialNotFoundError, type ConnectorCredential, type CredentialStore } from "@/domain/integration/credentials";
import { db } from "@/infrastructure/db/client";
import { sourceCredentials } from "@/infrastructure/db/credential-schema";
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
