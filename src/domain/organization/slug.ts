export const ORGANIZATION_SLUG_PATTERN = "[a-z0-9]+(?:-[a-z0-9]+)*";

export function isValidOrganizationSlug(value: string): boolean {
  return new RegExp(`^(?:${ORGANIZATION_SLUG_PATTERN})$`, "v").test(value);
}
