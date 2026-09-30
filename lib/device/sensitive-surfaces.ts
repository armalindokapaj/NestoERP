import type { EffectiveMobilePolicy, ProtectableModule } from "@/lib/core/security/mobile-policy.schema";

/**
 * Which screens are sensitive surfaces (MOB-11 §88, §156). By module, from the
 * effective policy — not a list of pages — so HR's people and salary screens are
 * covered because they are HR, and a Legal or Finance deployment opts in by
 * policy. General ERP screens are never covered; construction users photograph,
 * share and screenshot ordinary work every day (§90).
 */
const MODULE_BY_PREFIX: ReadonlyArray<readonly [string, ProtectableModule]> = [
  ["/hr", "hr"],
  ["/contracts", "contracts"],
  ["/finance", "finance"],
];

export function sensitiveModuleForPath(pathname: string): ProtectableModule | null {
  for (const [prefix, module] of MODULE_BY_PREFIX) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return module;
  }
  return null;
}

export function isSensitiveSurface(pathname: string, policy: Pick<EffectiveMobilePolicy, "sensitiveScreenProtection" | "protectedModules"> | null): boolean {
  if (!policy?.sensitiveScreenProtection) return false;
  const owner = sensitiveModuleForPath(pathname);
  return owner !== null && policy.protectedModules.includes(owner);
}
