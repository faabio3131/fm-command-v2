import type { UnitScopeResolver } from "@/application/metrics/metric-service";

/** Só para testes: quem consulta enxerga todas as unidades. Código de produção nunca importa este arquivo. */
export const unrestrictedScope: UnitScopeResolver = async () => ({ kind: "all" });
