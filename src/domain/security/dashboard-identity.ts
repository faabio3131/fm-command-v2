export interface DashboardIdentity {
  readonly name: string | null;
  readonly initials: string | null;
  readonly imageUrl: string | null;
  readonly organizationName: string | null;
}

export function authorizedAvatarUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function initialsFromName(name: string | null): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const selected = parts.length === 1 ? [parts[0]] : [parts[0], parts.at(-1)!];
  return selected
    .map((part) => Array.from(part)[0]?.toLocaleUpperCase("pt-BR") ?? "")
    .join("")
    .slice(0, 2) || null;
}
