import { MODULE_KEYS, modules, type ModuleKey } from "@/config/modules";

/**
 * Where a module's Help lives (AUD-05 §7, UX-16): `/help/<the module's own
 * route>` — `/help/daily-logs`, `/help/contracts` — so the address reads like
 * the module it explains. Client-safe.
 */
export function helpHref(moduleKey: ModuleKey): string {
  return `/help/${modules[moduleKey].route.replace(/^\//, "")}`;
}

/** The module a help address names, or null for anything else. */
export function moduleForHelpSlug(slug: string): ModuleKey | null {
  return MODULE_KEYS.find((key) => modules[key].route === `/${slug}`) ?? null;
}
