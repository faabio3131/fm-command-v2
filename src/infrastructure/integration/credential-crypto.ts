import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { ConnectorCredential } from "@/domain/integration/credentials";

/**
 * AES-256-GCM. O contexto (empresa + referência) entra como dado autenticado:
 * uma linha copiada para outra empresa ou outra referência não decifra.
 */
export interface SealedCredential {
  readonly ciphertext: string;
  readonly iv: string;
  readonly authTag: string;
}

const aad = (tenantId: string, secretRef: string) => Buffer.from(`${tenantId}\u0000${secretRef}`, "utf8");

export function sealCredential(key: Buffer, tenantId: string, secretRef: string, credential: ConnectorCredential): SealedCredential {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(tenantId, secretRef));
  const body = Buffer.concat([cipher.update(JSON.stringify(credential), "utf8"), cipher.final()]);
  return { ciphertext: body.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

export function openCredential(key: Buffer, tenantId: string, secretRef: string, sealed: SealedCredential): ConnectorCredential {
  const iv = Buffer.from(sealed.iv, "base64");
  const tag = Buffer.from(sealed.authTag, "base64");
  if (iv.length !== 12 || tag.length !== 16) throw new Error("integration.credential_corrupt");
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  decipher.setAAD(aad(tenantId, secretRef));
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
  const value = JSON.parse(plain) as ConnectorCredential;
  if (value?.kind === "api_key_pair" && typeof value.appKey === "string" && typeof value.appSecret === "string") return value;
  if (value?.kind === "oauth2" && typeof value.accessToken === "string") {
    return { ...value, expiresAt: value.expiresAt ? new Date(value.expiresAt) : undefined };
  }
  throw new Error("integration.credential_corrupt");
}
