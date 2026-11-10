/**
 * FM Command selects a precise published canonical IRON plan version.
 * Multiple published versions coexist during governed quota migrations.
 * Never silently choose latest: explicit commercial binding is mandatory.
 */
export function resolveIronPublishedPlanVersion(
  published: readonly { plan_code: string; version: number }[],
  planCode: string,
  commercialVersionMap?: string,
): number {
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(planCode) ||
    !Array.isArray(published) || published.length > 256)
    throw new Error("iron.plan_version_catalog_invalid");
  const candidates = published.filter(item =>
    item && item.plan_code === planCode &&
    Number.isSafeInteger(item.version) && item.version > 0);
  const versions = new Set(candidates.map(item => item.version));
  if (versions.size !== candidates.length || versions.size === 0)
    throw new Error("iron.plan_version_not_unique");

  let target: number | undefined;
  if (commercialVersionMap !== undefined && commercialVersionMap.trim() !== "") {
    if (commercialVersionMap.length > 8192)
      throw new Error("iron.plan_version_mapping_invalid");
    let config: unknown;
    try { config = JSON.parse(commercialVersionMap); }
    catch { throw new Error("iron.plan_version_mapping_invalid"); }
    if (!config || typeof config !== "object" || Array.isArray(config))
      throw new Error("iron.plan_version_mapping_invalid");
    const map = config as Record<string, unknown>;
    const known = Object.keys(map);
    if (known.length > 50 || known.some(key => !/^[A-Z][A-Z0-9_]{1,63}$/.test(key)
      || !Number.isSafeInteger(map[key]) || Number(map[key]) < 1))
      throw new Error("iron.plan_version_mapping_invalid");
    if (Object.hasOwn(map,planCode)) target = Number(map[planCode]);
  }
  if (target === undefined && versions.size === 1) return [...versions][0];
  if (target === undefined || !versions.has(target))
    throw new Error("iron.plan_version_not_unique");
  return target;
}
