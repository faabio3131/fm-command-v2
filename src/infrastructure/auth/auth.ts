import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { serverEnv } from "@/config/env";
import { db } from "@/infrastructure/db/client";
import * as authSchema from "@/infrastructure/db/auth-schema";
import { organizationAc, organizationRoles } from "@/infrastructure/auth/organization-access";

const env = serverEnv();

export const auth = betterAuth({
  appName: "FM Control Center",
  baseURL: env.authUrl,
  secret: env.authSecret,
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128 },
  trustedOrigins: [env.authUrl],
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const memberships = await db
            .select({ organizationId: authSchema.member.organizationId })
            .from(authSchema.member)
            .where(eq(authSchema.member.userId, session.userId))
            .limit(2);

          if (memberships.length !== 1) {
            return { data: session };
          }

          return {
            data: {
              ...session,
              activeOrganizationId: memberships[0].organizationId,
            },
          };
        },
      },
    },
  },
  plugins: [organization({ allowUserToCreateOrganization: true, ac: organizationAc, roles: organizationRoles })],
});
