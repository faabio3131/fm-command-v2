import industry from "./packs/industry.json";
import transport from "./packs/transport.json";
import { packMetricToDefinition, validateSectorPack, type SectorPack } from "./sector-pack";

/** Pacotes do operador da plataforma: arquivos de dados versionados, validados na carga (um arquivo inválido derruba o carregamento). */
export const SECTOR_PACKS: readonly SectorPack[] = [transport, industry].map(validateSectorPack);

export function getSectorPack(id: string): SectorPack | null {
  return SECTOR_PACKS.find((p) => p.id === id) ?? null;
}

/** Métricas de todos os pacotes, no formato do registro de métricas. */
export const PACK_METRIC_DEFINITIONS = SECTOR_PACKS.flatMap((p) => p.metrics.map((m) => packMetricToDefinition(p, m)));

const OWNER = new Map(SECTOR_PACKS.flatMap((p) => p.metrics.map((m) => [m.id, p.id] as const)));
/** Pacote dono da métrica, ou nulo se for métrica da plataforma. */
export function packOfMetric(metricId: string): string | null {
  return OWNER.get(metricId) ?? null;
}

/** Nome da métrica do pacote no idioma pedido. */
export function packMetricName(metricId: string, locale: "pt-BR" | "en-US"): string | null {
  for (const p of SECTOR_PACKS) {
    const m = p.metrics.find((x) => x.id === metricId);
    if (m) return m.name[locale];
  }
  return null;
}
