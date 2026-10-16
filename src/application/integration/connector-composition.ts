import { ConnectorRuntime } from "@/application/integration/connector-runtime";
import {
  PostgresCanonicalFactRepository,
  PostgresSourceRepository,
  PostgresSyncRepository,
} from "@/infrastructure/integration/postgres-repositories";

// Os conectores de dados (ERPs do cliente) entram na etapa 8E, um por sistema,
// começando pelo Omie. Até lá o runtime nasce sem nenhum conector registrado.
export function buildConnectorRuntime() {
  return new ConnectorRuntime(
    new PostgresSourceRepository(),
    new PostgresSyncRepository(),
    new PostgresCanonicalFactRepository(),
    [],
  );
}
