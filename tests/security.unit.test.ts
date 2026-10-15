import { describe,expect,it } from "vitest";
import { assertTenantScope,CrossTenantAccessError,PermissionDeniedError,requirePermission,type TenantContext } from "@/domain/security/tenant-context";
const owner:TenantContext={tenantId:"tenant-a",userId:"user-a",role:"owner",correlationId:"corr-1"};
const viewer:TenantContext={...owner,role:"viewer"};
describe("tenant security",()=>{
  it("permite somente tenant autenticado",()=>{expect(()=>assertTenantScope(owner,"tenant-a")).not.toThrow();expect(()=>assertTenantScope(owner,"tenant-b")).toThrow(CrossTenantAccessError)});
  it("não amplia tenant por valor externo",()=>expect(()=>assertTenantScope(owner,"")).toThrow(CrossTenantAccessError));
  it("aplica RBAC",()=>{expect(()=>requirePermission(owner,"source:write")).not.toThrow();expect(()=>requirePermission(viewer,"source:write")).toThrow(PermissionDeniedError)});
  it("separa leitura de alertas, escrita e preparação de ações",()=>{
    expect(()=>requirePermission(owner,"alert:write")).not.toThrow();
    expect(()=>requirePermission(viewer,"alert:read")).not.toThrow();
    expect(()=>requirePermission(viewer,"alert:write")).toThrow(PermissionDeniedError);
    expect(()=>requirePermission(viewer,"action:prepare")).toThrow(PermissionDeniedError);
  });
  it("permite busca e notificações governadas para todos os papéis autenticados",()=>{
    for (const role of ["owner","admin","analyst","viewer","member"] as const) {
      expect(()=>requirePermission({...owner,role},"search:use")).not.toThrow();
      expect(()=>requirePermission({...owner,role},"notification:use")).not.toThrow();
    }
  });
  it("restringe Billing e Receivables a owner/admin",()=>{
    const admin:TenantContext={...owner,role:"admin"};
    const analyst:TenantContext={...owner,role:"analyst"};
    expect(()=>requirePermission(owner,"billing:read")).not.toThrow();
    expect(()=>requirePermission(owner,"billing:write")).not.toThrow();
    expect(()=>requirePermission(owner,"receivable:read")).not.toThrow();
    expect(()=>requirePermission(admin,"billing:read")).not.toThrow();
    expect(()=>requirePermission(admin,"billing:write")).not.toThrow();
    expect(()=>requirePermission(admin,"receivable:read")).not.toThrow();
    expect(()=>requirePermission(analyst,"billing:read")).toThrow(PermissionDeniedError);
    expect(()=>requirePermission(analyst,"receivable:read")).toThrow(PermissionDeniedError);
    expect(()=>requirePermission(viewer,"billing:read")).toThrow(PermissionDeniedError);
    expect(()=>requirePermission(viewer,"receivable:read")).toThrow(PermissionDeniedError);
  });
});
