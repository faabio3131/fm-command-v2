import type { CoreEvidence, CoreOperationalContext } from "@/domain/core/contracts";

export interface CognitiveModel {
  plan(input: {
    question: string;
    metricCatalog: readonly { metricId: string; displayName: string; description: string }[];
    capabilityCatalog?: readonly { id: string; displayName: string; description: string }[];
    productCatalog?: readonly { slug: string; name: string }[];
    operationalContext: readonly CoreOperationalContext[];
  }): Promise<{
    metricIds: readonly string[];
    capabilityIds?: readonly string[];
    productSlugs?: readonly string[];
  }>;

  synthesize(input: {
    question: string;
    facts: readonly Record<string, unknown>[];
    evidence: readonly CoreEvidence[];
    operationalContext: readonly CoreOperationalContext[];
  }): Promise<string>;
}

export class CognitiveModelUnavailableError extends Error {
  constructor() { super("core.cognitive_model_unavailable"); }
}

export class CognitiveModelContractError extends Error {
  constructor() { super("core.cognitive_model_contract_invalid"); }
}
