import { ASAAS_PRODUCTION_SECRET_REF, resolveGatewaySecret } from "./secret-resolver";

export class AsaasProductionReadOnlyClient {
  constructor(private readonly transport: typeof fetch = fetch) {}
  async verifyAccount(): Promise<void> {
    const key = resolveGatewaySecret({provider:"asaas",environment:"production",secretRef:ASAAS_PRODUCTION_SECRET_REF});
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),10000);
    try {
      const response = await this.transport("https://api.asaas.com/v3/myAccount", {
        method:"GET", headers:{access_token:key,accept:"application/json","user-agent":"FMCommand-Production-ReadOnly/1.0"},
        redirect:"error",cache:"no-store",signal:controller.signal,
      });
      if (!response.ok) throw new Error("billing.asaas_production_http_"+response.status);
      const body:unknown = await response.json();
      if (!body || typeof body!=="object") throw new Error("billing.asaas_production_bad_response");
    } finally { clearTimeout(timer); }
  }
}
