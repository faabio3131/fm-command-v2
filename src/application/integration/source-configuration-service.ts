import type { SourceDefinition } from "@/domain/integration/contracts";
import { VARIABLE_VALUE } from "@/domain/integration/connector-definition";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";
import type { CatalogEntry } from "@/infrastructure/connectors/catalog";

export class ConnectorUnknownError extends Error {
  constructor() { super("integration.connector_unknown"); this.name = "ConnectorUnknownError"; }
}
export class ConnectorNotReadyError extends Error {
  constructor() { super("integration.connector_not_ready"); this.name = "ConnectorNotReadyError"; }
}
export class SourceConfigInvalidError extends Error {
  constructor(readonly field: string) {
    super(`integration.source_config_invalid:${field}`);
    this.name = "SourceConfigInvalidError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED = new Set(["currency", "utcOffsetMinutes", "unitRefField", "unitMap", "limits", "variables"]);

export interface SourceConfigurationDeps {
  readonly catalog: () => readonly CatalogEntry[];
  readonly sources: {
    findById(tenantId: string, id: string): Promise<SourceDefinition | null>;
    updateConfig(tenantId: string, sourceId: string, config: Record<string, unknown>): Promise<void>;
  };
  readonly registry: {
    register(context: TenantContext, input: {
      name: string; sourceType: string; authoritativeDomain: string; syncMode: "pull";
      mappingVersion: string; freshnessSeconds?: number; productId?: string; config: Record<string, unknown>;
    }): Promise<SourceDefinition>;
  };
  readonly units: { listUnits(tenantId: string): Promise<readonly { id: string }[]> };
}

/**
 * Configuração de uma fonte pela empresa. Tudo o que o cliente digita passa por
 * aqui: campos desconhecidos são recusados, limites só podem baixar o teto do
 * conector e toda unidade do mapa tem de existir NESTA empresa.
 */
export class SourceConfigurationService {
  constructor(private readonly deps: SourceConfigurationDeps) {}

  catalog(context: TenantContext): readonly CatalogEntry[] {
    requirePermission(context, "source:read");
    return this.deps.catalog();
  }

  private entry(id: string): CatalogEntry {
    const e = this.deps.catalog().find((x) => x.id === id);
    if (!e) throw new ConnectorUnknownError();
    return e;
  }

  async validate(context: TenantContext, entry: CatalogEntry, input: unknown): Promise<Record<string, unknown>> {
    if (input === undefined || input === null) input = {};
    if (typeof input !== "object" || Array.isArray(input)) throw new SourceConfigInvalidError("config");
    const raw = input as Record<string, unknown>;
    for (const key of Object.keys(raw)) if (!ALLOWED.has(key)) throw new SourceConfigInvalidError(key);
    const out: Record<string, unknown> = {};

    if (raw.currency !== undefined) {
      if (typeof raw.currency !== "string" || !/^[A-Z]{3}$/.test(raw.currency)) throw new SourceConfigInvalidError("currency");
      out.currency = raw.currency;
    }
    if (raw.utcOffsetMinutes !== undefined) {
      const v = raw.utcOffsetMinutes;
      if (typeof v !== "number" || !Number.isInteger(v) || v < -720 || v > 840) throw new SourceConfigInvalidError("utcOffsetMinutes");
      out.utcOffsetMinutes = v;
    }
    if (raw.unitRefField !== undefined) {
      if (entry.kind !== "code") throw new SourceConfigInvalidError("unitRefField");
      if (typeof raw.unitRefField !== "string" || !/^[a-z_][a-z0-9_]{0,63}$/i.test(raw.unitRefField)) throw new SourceConfigInvalidError("unitRefField");
      out.unitRefField = raw.unitRefField;
    }
    if (raw.unitMap !== undefined) {
      const m = raw.unitMap;
      if (!m || typeof m !== "object" || Array.isArray(m) || Object.keys(m).length > 500) throw new SourceConfigInvalidError("unitMap");
      const known = new Set((await this.deps.units.listUnits(context.tenantId)).map((u) => u.id.toLowerCase()));
      const map: Record<string, string> = Object.create(null) as Record<string, string>;
      for (const [ref, unitId] of Object.entries(m as Record<string, unknown>)) {
        if (!ref || ref.length > 64 || ref === "__proto__") throw new SourceConfigInvalidError("unitMap");
        if (typeof unitId !== "string" || !UUID.test(unitId) || !known.has(unitId.toLowerCase())) throw new SourceConfigInvalidError("unitMap");
        map[ref] = unitId.toLowerCase();
      }
      out.unitMap = { ...map };
    }
    if (raw.limits !== undefined) {
      const l = raw.limits;
      if (!l || typeof l !== "object" || Array.isArray(l)) throw new SourceConfigInvalidError("limits");
      const lim = l as Record<string, unknown>;
      const next: Record<string, number> = {};
      for (const [k, max] of [["requestsPerMinute", entry.limits.requestsPerMinute], ["maxConcurrent", entry.limits.maxConcurrent]] as const) {
        if (lim[k] === undefined) continue;
        const v = lim[k];
        if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > max) throw new SourceConfigInvalidError(`limits.${k}`);
        next[k] = v;
      }
      for (const k of Object.keys(lim)) if (k !== "requestsPerMinute" && k !== "maxConcurrent") throw new SourceConfigInvalidError(`limits.${k}`);
      out.limits = next;
    }
    if (raw.variables !== undefined) {
      const v = raw.variables;
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new SourceConfigInvalidError("variables");
      const vars: Record<string, string> = {};
      for (const [name, value] of Object.entries(v as Record<string, unknown>)) {
        if (!entry.variables.includes(name)) throw new SourceConfigInvalidError(`variables.${name}`);
        if (typeof value !== "string" || !VARIABLE_VALUE.test(value)) throw new SourceConfigInvalidError(`variables.${name}`);
        vars[name] = value;
      }
      out.variables = vars;
    }
    return out;
  }

  async createFromCatalog(context: TenantContext, input: {
    connectorId: string; name: string; productId?: string; freshnessSeconds?: number; config?: unknown;
  }): Promise<SourceDefinition> {
    requirePermission(context, "source:write");
    const entry = this.entry(input.connectorId);
    if (entry.status !== "ready") throw new ConnectorNotReadyError();
    const config = await this.validate(context, entry, input.config);
    const missing = entry.variables.filter((name) => !(config.variables as Record<string, string> | undefined)?.[name]);
    if (missing.length) throw new SourceConfigInvalidError(`variables.${missing[0]}`);
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || name.length > 120) throw new SourceConfigInvalidError("name");
    return this.deps.registry.register(context, {
      name, sourceType: entry.id, authoritativeDomain: "finance", syncMode: "pull",
      mappingVersion: entry.mappingVersion, freshnessSeconds: input.freshnessSeconds, productId: input.productId, config,
    });
  }

  /** Atualiza a configuração (substitui só os campos enviados; nunca toca em `baseUrl` ou segredo). */
  async updateConfig(context: TenantContext, sourceId: string, patch: unknown): Promise<Record<string, unknown>> {
    requirePermission(context, "source:write");
    const source = await this.deps.sources.findById(context.tenantId, sourceId);
    if (!source) throw new SourceNotFoundForConfigError();
    const entry = this.entry(source.sourceType);
    const incoming = await this.validate(context, entry, patch);
    const merged = { ...source.config, ...incoming };
    await this.deps.sources.updateConfig(context.tenantId, source.id, merged);
    return merged;
  }
}

export class SourceNotFoundForConfigError extends Error {
  constructor() { super("integration.source_not_found"); this.name = "SourceNotFoundForConfigError"; }
}
