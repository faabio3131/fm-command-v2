import { createHash, timingSafeEqual } from "node:crypto";

/** Dedicated, runtime-only machine token. Not the human session or Asaas REST key. */
export function verifyScheduledWorkerBearer(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || secret.length > 255 ||
      /\s/.test(secret) || !header?.startsWith("Bearer ")) return false;
  const submitted=header.slice(7);
  if (!submitted || submitted.length > 255) return false;
  return timingSafeEqual(
    createHash("sha256").update(submitted).digest(),
    createHash("sha256").update(secret).digest(),
  );
}
