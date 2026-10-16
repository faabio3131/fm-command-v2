export class BodyTooLargeError extends Error { constructor() { super("http.body_too_large"); } }

/** Le o corpo contando bytes e aborta ao passar do limite: nunca acumula um corpo enorme (inclusive com Transfer-Encoding: chunked). */
export async function readLimitedBody(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => undefined); throw new BodyTooLargeError(); }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
