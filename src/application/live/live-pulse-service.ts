import { createHash } from "node:crypto";
import type { UnitScopeResolver } from "@/application/metrics/metric-service";
import { pulseSource, type PulseParts } from "@/domain/live/pulse";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";

export interface LivePulse {
  /** Marca opaca: muda quando algo visível para a pessoa muda. */
  readonly token: string;
  readonly serverTime: string;
}

export class LivePulseService {
  constructor(
    private readonly repository: { read(tenantId: string, scope: Awaited<ReturnType<UnitScopeResolver>>): Promise<PulseParts> },
    private readonly unitScope: UnitScopeResolver,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async pulse(context: TenantContext): Promise<LivePulse> {
    requirePermission(context, "metric:read");
    const parts = await this.repository.read(context.tenantId, await this.unitScope(context));
    // O resumo mistura a empresa para que a mesma data em duas empresas não gere a mesma marca.
    const token = createHash("sha256").update(`${context.tenantId}|${pulseSource(parts)}`).digest("hex").slice(0, 16);
    return { token, serverTime: this.now().toISOString() };
  }
}
