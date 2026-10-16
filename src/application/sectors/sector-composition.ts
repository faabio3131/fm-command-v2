import { channelAudit } from "@/application/channels/channel-composition";
import { buildReportService } from "@/application/reports/report-composition";
import { SectorService } from "@/application/sectors/sector-service";
import { PostgresSectorRepository } from "@/infrastructure/sectors/postgres-sector-repository";

export function buildSectorService(): SectorService {
  return new SectorService({ repository: new PostgresSectorRepository(), reports: buildReportService(), audit: channelAudit });
}
