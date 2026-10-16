import { createHash } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { credentialVaultEnv } from "@/config/env";
import type { OAuthStateRecord, OAuthStateStore } from "@/domain/integration/oauth";
import { db } from "@/infrastructure/db/client";
import { oauthStates } from "@/infrastructure/db/credential-schema";
import { openText, sealText } from "./credential-crypto";

const hashState = (state: string) => createHash("sha256").update(state).digest("hex");

export class PostgresOAuthStateStore implements OAuthStateStore {
  constructor(private readonly keyProvider: () => Buffer = () => credentialVaultEnv().key) {}

  async create(input: OAuthStateRecord & { state: string; expiresAt: Date }): Promise<void> {
    const stateHash = hashState(input.state);
    // Limpeza oportunista: estados consumidos ou vencidos há mais de um dia não servem mais.
    await db.delete(oauthStates).where(and(eq(oauthStates.tenantId, input.tenantId), lt(oauthStates.expiresAt, new Date(Date.now() - 86_400_000))));
    const sealed = input.codeVerifier
      ? sealText(this.keyProvider(), input.tenantId, `oauth-state:${stateHash}`, input.codeVerifier)
      : undefined;
    await db.insert(oauthStates).values({
      stateHash,
      tenantId: input.tenantId,
      userId: input.userId,
      sourceId: input.sourceId,
      providerId: input.providerId,
      verifierCiphertext: sealed?.ciphertext,
      verifierIv: sealed?.iv,
      verifierAuthTag: sealed?.authTag,
      expiresAt: input.expiresAt,
    });
  }

  async consume(state: string): Promise<OAuthStateRecord | null> {
    const stateHash = hashState(state);
    // Atômico: dois retornos com o mesmo state só deixam um passar.
    const [row] = await db
      .update(oauthStates)
      .set({ consumedAt: new Date() })
      .where(and(eq(oauthStates.stateHash, stateHash), isNull(oauthStates.consumedAt), gt(oauthStates.expiresAt, new Date())))
      .returning();
    if (!row) return null;
    let codeVerifier: string | undefined;
    if (row.verifierCiphertext && row.verifierIv && row.verifierAuthTag) {
      try {
        codeVerifier = openText(this.keyProvider(), row.tenantId, `oauth-state:${stateHash}`, {
          ciphertext: row.verifierCiphertext, iv: row.verifierIv, authTag: row.verifierAuthTag,
        });
      } catch {
        return null;
      }
    }
    return { tenantId: row.tenantId, userId: row.userId, sourceId: row.sourceId, providerId: row.providerId, codeVerifier };
  }
}
