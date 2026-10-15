import { CoreGateway } from "@/application/core/core-gateway";
import { KordenaCommercialSummaryCapability } from "@/application/core/kordena-commercial-summary-capability";
import { OperationalHealthCapability } from "@/application/core/operational-health-capability";
import { FinancialIntelligenceService } from "@/application/finance/financial-intelligence-service";
import { FmccVerticalCognitiveCore } from "@/application/core/fmcc-vertical-cognitive-core";
import { KordenaCommercialControlService } from "@/application/integration/kordena-commercial-control-service";
import { MetricService } from "@/application/metrics/metric-service";
import { OperationalHealthService } from "@/application/operations/operational-health-service";
import { cognitiveEnv } from "@/config/env";
import { CognitiveModelUnavailableError } from "@/domain/core/cognitive-model";
import { AuditCoreContextReader } from "@/infrastructure/core/audit-core-context-reader";
import { OpenAiCompatibleCognitiveModel } from "@/infrastructure/core/openai-compatible-cognitive-model";
import { PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { PostgresOperationalHealthRepository } from "@/infrastructure/operations/postgres-health-repository";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

export function buildCoreGateway(): CoreGateway {
  let config: ReturnType<typeof cognitiveEnv>;
  try { config = cognitiveEnv(); }
  catch { throw new CognitiveModelUnavailableError(); }

  const verticalCore = new FmccVerticalCognitiveCore(
    new OpenAiCompatibleCognitiveModel(config.baseUrl, config.apiKey, config.modelId),
  );

  const metrics = new MetricService(new PostgresMetricStore());
  const products = new PostgresProductRepository();
  const sources = new PostgresSourceRepository();
  const kordenaCommercial = new KordenaCommercialControlService(sources);
  const operationalHealth = new OperationalHealthService(
    new PostgresOperationalHealthRepository(),
    products,
  );
  const readCapabilities = [
    new KordenaCommercialSummaryCapability(
      sources,
      products,
      kordenaCommercial,
    ),
    new OperationalHealthCapability(operationalHealth),
  ];

  return new CoreGateway(
    verticalCore,
    metrics,
    new AuditCoreContextReader(),
    products,
    new FinancialIntelligenceService(metrics, products),
    readCapabilities,
  );
}
