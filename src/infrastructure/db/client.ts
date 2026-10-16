import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { serverEnv } from "@/config/env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { fmccPool?: Pool };

export const pool = globalForDb.fmccPool ?? new Pool({
  connectionString: serverEnv().databaseUrl,
  max: process.env.NODE_ENV === "production" ? 10 : 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

if (process.env.NODE_ENV !== "production") globalForDb.fmccPool = pool;
export const db = drizzle(pool, { schema });
