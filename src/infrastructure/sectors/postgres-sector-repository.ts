import { and, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { sectorPacks } from "@/infrastructure/db/sector-schema";

/** Todas as leituras e escritas filtram pela empresa. */
export class PostgresSectorRepository {
  async listEnabled(tenantId: string): Promise<readonly { packId: string; packVersion: number; enabledAt: Date }[]> {
    const rows = await db.select().from(sectorPacks).where(eq(sectorPacks.tenantId, tenantId));
    return rows.map((r) => ({ packId: r.packId, packVersion: r.packVersion, enabledAt: r.enabledAt }));
  }
  /** Verdadeiro se acabou de ligar; falso se já estava ligado (mantém a versão e a data originais). */
  async enable(tenantId: string, packId: string, packVersion: number, by: string): Promise<boolean> {
    const rows = await db.insert(sectorPacks).values({ tenantId, packId, packVersion, enabledBy: by }).onConflictDoNothing().returning({ id: sectorPacks.packId });
    return rows.length > 0;
  }
  async disable(tenantId: string, packId: string): Promise<boolean> {
    return (await db.delete(sectorPacks).where(and(eq(sectorPacks.tenantId, tenantId), eq(sectorPacks.packId, packId))).returning({ id: sectorPacks.packId })).length > 0;
  }
}
