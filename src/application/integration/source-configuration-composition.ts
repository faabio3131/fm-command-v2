import { connectorCatalog } from "@/infrastructure/connectors/catalog";
import { PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";
import { PostgresUnitRepository } from "@/infrastructure/organization/postgres-unit-repository";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";
import { SourceRegistryService } from "./source-registry-service";
import { SourceConfigurationService } from "./source-configuration-service";

export function buildSourceConfigurationService() {
  const sources = new PostgresSourceRepository();
  return new SourceConfigurationService({
    catalog: () => connectorCatalog(),
    sources,
    registry: new SourceRegistryService(sources, new PostgresProductRepository()),
    units: new PostgresUnitRepository(),
  });
}
