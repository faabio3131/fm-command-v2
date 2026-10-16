import { ConnectorRuntime } from "@/application/integration/connector-runtime";
import { RateLimiter } from "@/application/integration/rate-limiter";
import { FetchJsonTransport } from "@/infrastructure/connectors/http-json-transport";
import { OmieClient } from "@/infrastructure/connectors/omie/omie-client";
import { OmieConnector } from "@/infrastructure/connectors/omie/omie-connector";
import { PostgresCredentialStore } from "@/infrastructure/integration/postgres-credential-store";
import {
  PostgresCanonicalFactRepository,
  PostgresSourceRepository,
  PostgresSyncRepository,
} from "@/infrastructure/integration/postgres-repositories";

// O limitador vive no processo e é compartilhado: o teto do Omie é por chave e
// por método, e todas as chamadas do processo passam por ele.
const limiter = new RateLimiter();

// Um conector por sistema de origem. Novos ERPs (Conta Azul, Bling, Xero,
// QuickBooks) entram aqui, cada um atrás do mesmo contrato.
export function buildConnectorRuntime() {
  const credentials = new PostgresCredentialStore();
  return new ConnectorRuntime(
    new PostgresSourceRepository(),
    new PostgresSyncRepository(),
    new PostgresCanonicalFactRepository(),
    [new OmieConnector(new OmieClient(new FetchJsonTransport(), limiter), credentials)],
  );
}
