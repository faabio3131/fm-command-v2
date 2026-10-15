"use client";
import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import { organizationAc, organizationRoles } from "@/infrastructure/auth/organization-access";
export const authClient = createAuthClient({ plugins: [organizationClient({ ac: organizationAc, roles: organizationRoles })] });
