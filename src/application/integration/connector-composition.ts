import { createMetricRecomputeService } from "@/application/metrics/metric-composition";
import { ConnectorRuntime } from "@/application/integration/connector-runtime";
import { OAuthClient } from "@/application/integration/oauth-client";
import { OAuthTokenService } from "@/application/integration/oauth-token-service";
import { RateLimiter } from "@/application/integration/rate-limiter";
import { declarativeDefinitions } from "@/infrastructure/connectors/catalog";
import { DeclarativeRestConnector } from "@/infrastructure/connectors/declarative/declarative-connector";
import { FetchJsonTransport } from "@/infrastructure/connectors/http-json-transport";
import { oauthClientCredentials, oauthProvider } from "@/infrastructure/connectors/oauth-providers";
import { OmieClient } from "@/infrastructure/connectors/omie/omie-client";
import { OmieConnector } from "@/infrastructure/connectors/omie/omie-connector";
import { PostgresCredentialStore } from "@/infrastructure/integration/postgres-credential-store";
import {
  PostgresCanonicalFactRepository,
  PostgresSourceRepository,
  PostgresSyncRepository,
} from "@/infrastructure/integration/postgres-repositories";

// O limitador vive no processo e é compartilhado: o teto de cada ERP é por chave
// e por método, e todas as chamadas do processo passam por ele.
const limiter = new RateLimiter();

// Um conector por sistema de origem. Os declarativos nascem das definições do
// catálogo (só as `ready`); o Omie é código por causa do formato próprio.
export function buildConnectorRuntime() {
  const credentials = new PostgresCredentialStore();
  const transport = new FetchJsonTransport();
  const tokens = new OAuthTokenService(credentials, new OAuthClient(transport));
  const declarative = declarativeDefinitions()
    .filter((d) => d.status === "ready")
    .map((d) => new DeclarativeRestConnector(d, {
      transport, limiter, credentials, tokens,
      oauthProvider: (id) => oauthProvider(id),
      oauthClient: (id) => oauthClientCredentials(id),
    }));
  return new ConnectorRuntime(
    new PostgresSourceRepository(),
    new PostgresSyncRepository(),
    new PostgresCanonicalFactRepository(),
    [new OmieConnector(new OmieClient(transport, limiter), credentials), ...declarative],
    undefined, undefined, undefined,
    (tenantId, correlationId) => createMetricRecomputeService().recomputeTenant(tenantId, correlationId),
  );
}
