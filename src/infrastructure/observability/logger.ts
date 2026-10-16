const SENSITIVE_KEY = /(password|secret|token|authorization|cookie|api[-_]?key)/i;
function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k,v]) => [k, SENSITIVE_KEY.test(k) ? "[REDACTED]" : sanitize(v)]));
  }
  return value;
}
export function logEvent(level: "info"|"warn"|"error", event: string, fields: Record<string, unknown> = {}): void {
  const serialized = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...(sanitize(fields) as Record<string, unknown>) });
  if (level === "error") console.error(serialized);
  else if (level === "warn") console.warn(serialized);
  else console.info(serialized);
}
