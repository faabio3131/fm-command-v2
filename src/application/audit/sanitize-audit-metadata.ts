const SENSITIVE_KEY =
  /(password|passwd|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|credential)/i;
const INLINE_SECRET =
  /(Bearer\s+[A-Za-z0-9._~+/=-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|nvapi-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,})/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const MAX_DEPTH = 8;
const MAX_ENTRIES = 64;
const MAX_STRING_LENGTH = 2_000;

function sanitizeString(value: string): string {
  const redacted = value
    .replace(INLINE_SECRET, "[REDACTED_SECRET]")
    .replace(EMAIL, "[REDACTED_EMAIL]");
  if (redacted.length <= MAX_STRING_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_STRING_LENGTH)}…[TRUNCATED]`;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return "[TRUNCATED_DEPTH]";
  if (typeof value === "string") return sanitizeString(value);
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ENTRIES)
      .map((item) => sanitizeValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_ENTRIES)
        .map(([key, nested]) => [
          key,
          SENSITIVE_KEY.test(key)
            ? "[REDACTED]"
            : sanitizeValue(nested, depth + 1),
        ]),
    );
  }
  return String(value);
}

export function sanitizeAuditMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeValue(metadata, 0) as Record<string, unknown>;
}
