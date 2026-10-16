import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { NextRequest } from "next/server";
import { crossSiteMutation } from "@/proxy";
import nextConfig from "../next.config";

const API = resolve(process.cwd(), "src/app/api");
function routes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? routes(resolve(dir, e.name)) : e.name === "route.ts" ? [resolve(dir, e.name)] : []));
}
const rel = (f: string) => relative(API, f).replaceAll("\\", "/");

/** Toda rota da API precisa estar em exatamente uma destas classes; rota nova sem classe quebra o teste e obriga a decidir. */
const PUBLIC_PROBES = new Set(["health/route.ts", "ready/route.ts", "version/route.ts"]);
const SIGNED_OR_AUTH = new Set(["auth/[...all]/route.ts", "webhooks/payments/[provider]/route.ts"]);

describe("revisão de segurança: toda rota da API tem autoridade", () => {
  const files = routes(API);
  it("há rotas e cada uma é sessão, segredo do agendador, assinatura/autenticação ou sonda pública", () => {
    expect(files.length).toBeGreaterThan(50);
    for (const f of files) {
      const name = rel(f); const src = readFileSync(f, "utf8");
      const session = src.includes("resolveTenantContext");
      const scheduler = name.startsWith("internal/") && src.includes("timingSafeEqual") && src.includes("schedulerSecret");
      expect(session || scheduler || SIGNED_OR_AUTH.has(name) || PUBLIC_PROBES.has(name), `rota sem autoridade reconhecida: ${name}`).toBe(true);
    }
  });
  it("rotas internas do agendador falham fechado sem segredo configurado e recusam segredo errado", () => {
    for (const f of files.filter((x) => rel(x).startsWith("internal/"))) {
      const src = readFileSync(f, "utf8");
      expect(src, rel(f)).toContain("scheduler_not_configured");
      expect(src, rel(f)).toContain("automation.unauthorized");
      expect(src, rel(f)).not.toMatch(/resolveTenantContext/);
    }
  });
  it("sondas públicas não expõem segredo nem dado de empresa", () => {
    for (const name of PUBLIC_PROBES) {
      const src = readFileSync(resolve(API, name), "utf8");
      expect(src, name).not.toMatch(/tenant|DATABASE_URL|SECRET|process\.env\.[A-Z_]*KEY/i);
    }
  });
  it("nenhuma rota devolve stack nem o objeto de erro serializado (mensagens são códigos de erros de domínio)", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, rel(f)).not.toMatch(/error\.stack|JSON\.stringify\(error\)|error:\s*String\(/);
    }
  });
});

describe("revisão de segurança: cabeçalhos e origem", () => {
  it("cabeçalhos de segurança estão em todas as rotas", async () => {
    const rules = await nextConfig.headers!();
    const headers = Object.fromEntries(rules.find((r) => r.source === "/:path*")!.headers.map((h) => [h.key, h.value]));
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Strict-Transport-Security"]).toMatch(/max-age=\d{7,}/);
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(nextConfig.poweredByHeader).toBe(false);
  });
  const req = (method: string, path: string, headers: Record<string, string> = {}) => new NextRequest(`https://app.exemplo.com${path}`, { method, headers: { host: "app.exemplo.com", ...headers } });
  it("alteração vinda de outro site é recusada; do mesmo site, de cliente sem navegador e leitura passam", () => {
    expect(crossSiteMutation(req("POST", "/api/reports", { origin: "https://evil.example" }))).toBe(true);
    expect(crossSiteMutation(req("DELETE", "/api/reports/1", { origin: "https://app.exemplo.com.evil.example" }))).toBe(true);
    expect(crossSiteMutation(req("PUT", "/api/sectors/transport", { origin: "not a url" }))).toBe(true);
    expect(crossSiteMutation(req("POST", "/api/reports", { origin: "https://app.exemplo.com" }))).toBe(false);
    expect(crossSiteMutation(req("POST", "/api/reports"))).toBe(false);
    expect(crossSiteMutation(req("GET", "/api/reports", { origin: "https://evil.example" }))).toBe(false);
    expect(crossSiteMutation(req("POST", "/api/reports", { origin: "https://app.interno", "x-forwarded-host": "app.interno" }))).toBe(false);
  });
  it("webhook, agendador e autenticação não dependem da origem do navegador", () => {
    for (const p of ["/api/webhooks/payments/asaas", "/api/internal/automation/alerts/evaluate", "/api/auth/sign-in/email"]) {
      expect(crossSiteMutation(req("POST", p, { origin: "https://evil.example" })), p).toBe(false);
    }
  });
});
