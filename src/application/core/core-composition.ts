import { CoreGateway } from "@/application/core/core-gateway";
import { BranchRankingCapability } from "@/application/core/branch-ranking-capability";
import { ProductRankingCapability } from "@/application/core/product-ranking-capability";
import { OperationalHealthCapability } from "@/application/core/operational-health-capability";
import { FinancialIntelligenceService } from "@/application/finance/financial-intelligence-service";
import { FmccVerticalCognitiveCore } from "@/application/core/fmcc-vertical-cognitive-core";
import { createDimensionRankingService, createMetricService, createUnitComparisonService } from "@/application/metrics/metric-composition";
import { PostgresProfileRepository } from "@/infrastructure/i18n/postgres-profile-repository";
import { buildSectorService } from "@/application/sectors/sector-composition";
import { OperationalHealthService } from "@/application/operations/operational-health-service";
import { cognitiveEnv } from "@/config/env";
import { CognitiveModelUnavailableError, type CognitiveModel } from "@/domain/core/cognitive-model";
import { AuditCoreContextReader } from "@/infrastructure/core/audit-core-context-reader";
import { OpenAiCompatibleCognitiveModel } from "@/infrastructure/core/openai-compatible-cognitive-model";
import { PostgresOperationalHealthRepository } from "@/infrastructure/operations/postgres-health-repository";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

/** `model` permite injetar o modelo (roteado pela politica do banco); sem ele usa o modelo unico por variavel de ambiente (V1). */
export function buildCoreGateway(model?: CognitiveModel): CoreGateway {
  let cognitive = model;
  if (!cognitive) {
    let config: ReturnType<typeof cognitiveEnv>;
    try { config = cognitiveEnv(); }
    catch { throw new CognitiveModelUnavailableError(); }
    cognitive = new OpenAiCompatibleCognitiveModel(config.baseUrl, config.apiKey, config.modelId);
  }

  const verticalCore = new FmccVerticalCognitiveCore(cognitive);

  const metrics = createMetricService();
  const products = new PostgresProductRepository();
  const operationalHealth = new OperationalHealthService(
    new PostgresOperationalHealthRepository(),
    products,
  );
  const readCapabilities = [
    new OperationalHealthCapability(operationalHealth),
    new BranchRankingCapability(createUnitComparisonService(), (tenantId) => buildSectorService().visibleMetricIds(tenantId)),
    new ProductRankingCapability(
      createDimensionRankingService(),
      async (tenantId) => (await new PostgresProfileRepository().getOrgProfile(tenantId))?.timezone ?? "UTC",
      (tenantId) => buildSectorService().visibleMetricIds(tenantId),
    ),
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
