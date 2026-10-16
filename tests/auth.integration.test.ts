import { randomUUID } from "node:crypto";
import { describe,expect,it } from "vitest";
import { loadDashboardIdentity } from "@/application/security/dashboard-identity";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { assertTenantScope,CrossTenantAccessError } from "@/domain/security/tenant-context";
import { auth } from "@/infrastructure/auth/auth";

const baseUrl=process.env.BETTER_AUTH_URL??"http://localhost:3000";
async function request(path:string,init:RequestInit={}){
  const headers=new Headers(init.headers);headers.set("origin",baseUrl);if(init.body&&!headers.has("content-type"))headers.set("content-type","application/json");
  return auth.handler(new Request(`${baseUrl}/api/auth${path}`,{...init,headers}));
}
function cookieFrom(response:Response){const raw=response.headers.get("set-cookie");if(!raw)throw new Error("test.session_cookie_missing");return raw.split(";")[0]}
async function createUserAndTenant(label:string){
  const suffix=randomUUID().slice(0,8);
  const email=`${label}-${suffix}@example.test`;
  const password="Strong-Test-Password-2026!";
  const signUp=await request("/sign-up/email",{method:"POST",body:JSON.stringify({name:`User ${label}`,email,password})});
  expect(signUp.status).toBeLessThan(400);const cookie=cookieFrom(signUp);
  const createOrg=await request("/organization/create",{method:"POST",headers:{cookie},body:JSON.stringify({name:`Tenant ${label}`,slug:`${label}-${suffix}`,keepCurrentActiveOrganization:false})});
  expect(createOrg.status).toBeLessThan(400);const organization=await createOrg.json() as {id:string};return {cookie,organization,email,password};
}
describe("auth + tenancy integration",()=>{
  it("cria sessão, organização, contexto e identidade confiáveis",async()=>{
    const a=await createUserAndTenant("a");
    const c=await resolveTenantContext(new Headers({cookie:a.cookie}));
    expect(c.tenantId).toBe(a.organization.id);
    expect(c.role).toBe("owner");
    await expect(loadDashboardIdentity(c)).resolves.toMatchObject({
      name:"User a",
      initials:"UA",
      organizationName:"Tenant a",
    });
  });
  it("restaura automaticamente o único tenant após novo login",async()=>{
    const a=await createUserAndTenant("relogin");
    const signOut=await request("/sign-out",{method:"POST",headers:{cookie:a.cookie}});
    expect(signOut.status).toBeLessThan(400);
    const signIn=await request("/sign-in/email",{method:"POST",body:JSON.stringify({email:a.email,password:a.password})});
    expect(signIn.status).toBeLessThan(400);
    const reloginCookie=cookieFrom(signIn);
    const c=await resolveTenantContext(new Headers({cookie:reloginCookie}));
    expect(c.tenantId).toBe(a.organization.id);
    expect(c.role).toBe("owner");
  });
  it("nega cross-tenant",async()=>{const a=await createUserAndTenant("cross-a");const b=await createUserAndTenant("cross-b");const c=await resolveTenantContext(new Headers({cookie:a.cookie}));expect(()=>assertTenantScope(c,b.organization.id)).toThrow(CrossTenantAccessError)});
  it("ignora X-Tenant-ID como autoridade",async()=>{const a=await createUserAndTenant("header-a");const b=await createUserAndTenant("header-b");const c=await resolveTenantContext(new Headers({cookie:a.cookie,"x-tenant-id":b.organization.id}));expect(c.tenantId).toBe(a.organization.id);expect(c.tenantId).not.toBe(b.organization.id)});
});
