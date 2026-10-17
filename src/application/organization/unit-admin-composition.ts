import { channelAudit } from "@/application/channels/channel-composition";
import { UnitAdminService } from "@/application/organization/unit-admin-service";
import { PostgresUnitRepository } from "@/infrastructure/organization/postgres-unit-repository";

export function buildUnitAdminService(): UnitAdminService {
  return new UnitAdminService({ repository: new PostgresUnitRepository(), audit: channelAudit });
}
