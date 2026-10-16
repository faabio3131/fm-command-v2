import { headers } from "next/headers";
import { buildReportService } from "@/application/reports/report-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { reportErrorResponse } from "../error-response";

/** CSV dos números atuais das métricas pedidas (?metrics=a,b,c). Sempre fresco, nunca guardado em cache. */
export async function GET(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const metrics = (new URL(request.url).searchParams.get("metrics") ?? "").split(",").map((m) => m.trim()).filter(Boolean);
    const csv = await buildReportService().exportCsv(context, metrics);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="fm-command-export.csv"',
        "cache-control": "no-store",
      },
    });
  } catch (error) { return reportErrorResponse(error); }
}
