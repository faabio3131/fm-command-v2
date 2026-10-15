import type { CognitiveModel } from "@/domain/core/cognitive-model";
import type { CoreAnswer, CoreEvidence, CoreOperationalContext } from "@/domain/core/contracts";
import { FINANCIAL_DERIVED_METRICS } from "@/domain/finance/intelligence";
import { METRIC_REGISTRY } from "@/domain/metrics/registry";

export class FmccVerticalCognitiveCore {
  constructor(private readonly model: CognitiveModel) {}

  async plan(input: {
    question: string;
    operationalContext: readonly CoreOperationalContext[];
    capabilityCatalog?: readonly { id: string; displayName: string; description: string }[];
    productCatalog?: readonly { slug: string; name: string }[];
  }): Promise<{
    metricIds: readonly string[];
    capabilityIds: readonly string[];
    productSlugs: readonly string[];
  }> {
    const result = await this.model.plan({
      question: input.question,
      metricCatalog: [
        ...METRIC_REGISTRY.map(({ metricId, displayName, description }) => ({ metricId, displayName, description })),
        ...FINANCIAL_DERIVED_METRICS,
      ],
      capabilityCatalog: input.capabilityCatalog ?? [],
      productCatalog: input.productCatalog ?? [],
      operationalContext: input.operationalContext,
    });
    return {
      metricIds: result.metricIds,
      capabilityIds: result.capabilityIds ?? [],
      productSlugs: result.productSlugs ?? [],
    };
  }

  async synthesize(input: {
    question: string;
    facts: readonly Record<string, unknown>[];
    evidence: readonly CoreEvidence[];
    operationalContext: readonly CoreOperationalContext[];
  }): Promise<CoreAnswer> {
    const answer = await this.model.synthesize({
      question: input.question, facts: input.facts, evidence: input.evidence, operationalContext: input.operationalContext,
    });
    return { answer, evidence: input.evidence, factualStatus: "grounded" };
  }
}
