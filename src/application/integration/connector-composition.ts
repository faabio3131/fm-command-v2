import { ConnectorRuntime } from "@/application/integration/connector-runtime";
import {
  PostgresCanonicalFactRepository,
  PostgresSourceRepository,
  PostgresSyncRepository,
} from "@/infrastructure/integration/postgres-repositories";
import {
  KordenaCommercialConnector,
  type SecretResolver,
} from "@/infrastructure/integration/kordena-commercial-connector";
import {
  IronCommercialConnector,
  type IronSecretResolver,
} from "@/infrastructure/integration/iron-commercial-connector";

export function buildConnectorRuntime(input?: {
  resolveSecret?: SecretResolver & IronSecretResolver;
  fetcher?: typeof fetch;
}) {
  const connector = new KordenaCommercialConnector(
    input?.resolveSecret,
    input?.fetcher,
  );
  const ironConnector = new IronCommercialConnector(
    input?.resolveSecret,
    input?.fetcher,
  );
  return new ConnectorRuntime(
    new PostgresSourceRepository(),
    new PostgresSyncRepository(),
    new PostgresCanonicalFactRepository(),
    [connector, ironConnector],
  );
}

export function buildKordenaCommercialConnector(input?: {
  resolveSecret?: SecretResolver;
  fetcher?: typeof fetch;
}) {
  return new KordenaCommercialConnector(
    input?.resolveSecret,
    input?.fetcher,
  );
}

export function buildIronCommercialConnector(input?: {
  resolveSecret?: IronSecretResolver;
  fetcher?: typeof fetch;
}) {
  return new IronCommercialConnector(
    input?.resolveSecret,
    input?.fetcher,
  );
}
