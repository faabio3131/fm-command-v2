import { describe, expect, it } from "vitest";
import { BodyTooLargeError, readLimitedBody } from "@/infrastructure/http/read-limited-body";

const req = (body: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
  new Request("http://x.test/", { method: "POST", body, headers, ...(typeof body !== "string" ? { duplex: "half" } : {}) } as RequestInit);

describe("leitura de corpo com limite", () => {
  it("le corpo pequeno", async () => { expect(await readLimitedBody(req('{"a":1}'), 100)).toBe('{"a":1}'); });
  it("recusa pelo Content-Length declarado", async () => {
    await expect(readLimitedBody(new Request("http://x.test/", { method: "POST", body: "x", headers: { "content-length": "999" } }), 100)).rejects.toBeInstanceOf(BodyTooLargeError);
  });
  it("aborta um corpo em pedacos assim que passa do limite, sem ler o resto", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(40)); if (pulled > 1000) c.close(); } });
    await expect(readLimitedBody(req(stream), 100)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(pulled).toBeLessThan(10);
  });
});
