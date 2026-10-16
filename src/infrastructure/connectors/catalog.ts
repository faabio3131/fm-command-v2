import {
  validateConnectorDefinition,
  type ConnectorDefinition,
} from "@/domain/integration/connector-definition";
import { OMIE_SOURCE_TYPE } from "./omie/omie-connector";
import { OMIE_MAX_LIMITS } from "./omie/omie-client";
import contaAzul from "./definitions/conta_azul.json";
import bling from "./definitions/bling.json";
import xero from "./definitions/xero.json";
import quickbooks from "./definitions/quickbooks.json";

/**
 * Catálogo de conectores: o que a empresa pode escolher. Conectores
 * declarativos vêm de arquivos de definição validados na carga; o Omie é
 * código (o formato dele não cabe em uma definição) e entra só como metadado.
 * Entrada `planned` aparece mas não conecta: falta confirmar a API do sistema.
 */
export interface CatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly regions: readonly string[];
  readonly status: "ready" | "planned";
  readonly kind: "code" | "declarative";
  /** Versão do mapeamento gravada nos fatos (muda quando o mapeamento muda). */
  readonly mappingVersion: string;
  readonly authType: "api_key_pair" | "oauth2" | "api_key";
  readonly variables: readonly string[];
  readonly limits: { readonly requestsPerMinute: number; readonly maxConcurrent: number };
}

const DECLARATIVE: readonly ConnectorDefinition[] = [contaAzul, bling, xero, quickbooks].map(validateConnectorDefinition);

/** Definições extras (testes ou futuras cargas) entram por aqui, sempre validadas. */
const extra: ConnectorDefinition[] = [];
export function registerConnectorDefinition(raw: unknown): ConnectorDefinition {
  const def = validateConnectorDefinition(raw);
  if (DECLARATIVE.some((d) => d.id === def.id) || def.id === OMIE_SOURCE_TYPE || extra.some((d) => d.id === def.id)) {
    throw new Error("integration.connector_definition_duplicate");
  }
  extra.push(def);
  return def;
}

export function declarativeDefinitions(): readonly ConnectorDefinition[] {
  return [...DECLARATIVE, ...extra];
}

export function connectorCatalog(): readonly CatalogEntry[] {
  const omie: CatalogEntry = {
    id: OMIE_SOURCE_TYPE, label: "Omie", regions: ["BR"], status: "ready", kind: "code",
    authType: "api_key_pair", variables: [], limits: OMIE_MAX_LIMITS, mappingVersion: "omie.v1",
  };
  return [
    omie,
    ...declarativeDefinitions().map((d): CatalogEntry => ({
      id: d.id, label: d.label, regions: d.regions, status: d.status, kind: "declarative",
      authType: d.auth.type, variables: d.variables ?? [], limits: d.limits, mappingVersion: `${d.id}.v${d.version}`,
    })),
  ];
}

export function catalogEntry(id: string): CatalogEntry | undefined {
  return connectorCatalog().find((e) => e.id === id);
}
