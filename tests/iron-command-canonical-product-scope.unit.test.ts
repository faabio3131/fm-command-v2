import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FMCC_IRON_PRODUCT_SLUG, IRON_EXTERNAL_PRODUCT_CODE } from "@/domain/billing/iron-product-identity";

const body=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");
const sqlChecks=[
  "src/infrastructure/billing/postgres-iron-asaas-atomic-reconciliation.ts",
  "src/infrastructure/billing/postgres-iron-asaas-issuer.ts",
  "src/infrastructure/billing/postgres-iron-payer-enrollment.ts",
  "src/infrastructure/billing/postgres-iron-entitlement-outbox.ts",
  "src/infrastructure/billing/postgres-iron-asaas-webhook-queue.ts",
  "src/infrastructure/billing/iron-asaas-webhook-inbox.ts",
] as const;
const services=[
  "src/infrastructure/billing/postgres-paid-iron-invoice-repository.ts",
  "src/infrastructure/billing/postgres-iron-plan-mapping-repository.ts",
  "src/infrastructure/billing/postgres-product-billing-authority-repository.ts",
  "src/application/billing/iron-paid-license-reconciliation-service.ts",
  "src/app/dashboard/products/[productId]/billing/page.tsx",
  "src/application/integration/iron-runtime-bootstrap.ts",
] as const;

describe("D11 FM Command IRON product identity is consistent with canonical registry",()=>{
  it("uses the registered commercial slug, not the upstream product code",()=>{
    expect(FMCC_IRON_PRODUCT_SLUG).toBe("iron");
    expect(IRON_EXTERNAL_PRODUCT_CODE).toBe("IRON_FIT_CORE");
    expect(FMCC_IRON_PRODUCT_SLUG).not.toBe(IRON_EXTERNAL_PRODUCT_CODE);
  });

  for(const path of sqlChecks){
    it(`enforces actual IRON product in SQL: ${path}`,()=>{
      const source=body(path);
      expect(source).toContain("slug='iron'");
      expect(source).not.toContain("iron-fit-core");
      expect(source).toContain("status='active'");
    });
  }

  for(const path of services){
    it(`uses canonical registry slug in application: ${path}`,()=>{
      const source=body(path);
      expect(source).toContain("FMCC_IRON_PRODUCT_SLUG");
      expect(source).not.toContain("iron-fit-core");
    });
  }

  it("keeps IRON external control-plane snapshot contract unchanged",()=>{
    const connector=body("src/infrastructure/integration/iron-commercial-connector.ts");
    expect(connector).toContain('body.product_code !== "IRON_FIT_CORE"');
    expect(connector).toContain('schema_version !== "iron.fmcc.commercial.v1"');
    const backend=body("src/application/integration/iron-runtime-bootstrap.ts");
    expect(backend).toContain("products.findBySlug(config.tenantId, PRODUCT_SLUG)");
  });

  it("does not widen SaaS billing to student finance",()=>{
    const enrollment=body("src/infrastructure/billing/postgres-iron-payer-enrollment.ts");
    expect(enrollment).toContain("p.status='active'");
    expect(enrollment).toContain("g.provider='asaas'");
    expect(enrollment).toContain("g.environment='production'");
    expect(enrollment).toContain("src.source_type='iron-commercial-v1'");
    expect(enrollment).toContain("src.secret_ref='env:FMCC_IRON_CONTROL_PLANE_TOKEN'");
  });
});
