import { createAccessControl } from "better-auth/plugins/access";

export const organizationStatements = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
} as const;

export const organizationAc = createAccessControl(organizationStatements);

export const organizationRoles = {
  owner: organizationAc.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["create", "read", "update", "delete"],
  }),
  admin: organizationAc.newRole({
    organization: [],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: [],
    ac: ["read"],
  }),
  analyst: organizationAc.newRole({
    organization: [],
    member: [],
    invitation: [],
    team: [],
    ac: ["read"],
  }),
  viewer: organizationAc.newRole({
    organization: [],
    member: [],
    invitation: [],
    team: [],
    ac: ["read"],
  }),
  member: organizationAc.newRole({
    organization: [],
    member: [],
    invitation: [],
    team: [],
    ac: ["read"],
  }),
} as const;
