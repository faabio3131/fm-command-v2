/** Caminho pontilhado seguro ("a.b.0.c"). Nunca atravessa a cadeia de protótipos. */
export function getPath(root: unknown, path: string): unknown {
  if (path === "$") return root;
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return undefined;
      current = current[Number(segment)];
    } else {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return current;
}
