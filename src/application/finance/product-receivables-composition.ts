import { ProductReceivablesService } from "@/application/finance/product-receivables-service";
import { KordenaCommercialConnector } from "@/infrastructure/integration/kordena-commercial-connector";
import { PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

export function buildProductReceivablesService(): ProductReceivablesService {
  return new ProductReceivablesService(
    new PostgresProductRepository(),
    new PostgresSourceRepository(),
    new KordenaCommercialConnector(),
  );
}
