import { preflightProviderInvoice } from "./billing-provider-preflight.mjs";
const key = process.env.FMCC_ASAAS_SANDBOX_API_KEY;
if (!key || process.env.FMCC_ASAAS_LIVE_CONFIRM !== "PREFLIGHT_ONLY") throw new Error("billing.read_only_preflight_not_authorized");
const invoiceId = "a51a5000-1990-4000-8000-000000000001";
const request = async (method, path) => {
  if (method !== "GET" || !path.startsWith("/payments?externalReference=")) throw new Error("billing.read_only_only");
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),10000);
  try {
    const response=await fetch("https://api-sandbox.asaas.com/v3"+path,{
      method:"GET", headers:{access_token:key,accept:"application/json","user-agent":"FMCommand-Billing-Preflight/1.0"},
      redirect:"error",cache:"no-store",signal:controller.signal,
    });
    if (!response.ok) throw new Error("billing.provider_preflight_http_"+response.status);
    return await response.json();
  } finally {clearTimeout(timer);}
};
try {
  await preflightProviderInvoice(request,invoiceId);
  console.log("PASS provider invoice reference available; no customer or charge created");
} catch(error) {
  const code=error instanceof Error?error.message:"unknown";
  console.error("SANDBOX_READ_ONLY_PRECHECK_BLOCKED",code);
  throw error;
}
