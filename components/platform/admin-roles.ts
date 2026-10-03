import { ROLE_KEYS, roles, type RoleKey } from "@/config/roles";
import type { Translate } from "@/lib/i18n/translator";

const BY_LABEL = new Map<string, RoleKey>(ROLE_KEYS.map((key) => [roles[key].label.toLowerCase(), key]));
const BY_KEY = new Set<string>(ROLE_KEYS);

/**
 * A role as the reader's language names it. The pages hold a role's stored name
 * ("Group IT"), an audit snapshot ("Group It") or a key ("GROUP_IT"); the
 * application dictionary names each role by key. Anything else (a custom name,
 * "Platform Admin" included, which is a key too) is returned as it came, and a
 * trailing "+3" from a list of several roles is kept.
 */
export function adminRoleName(t: Translate<"roles">, name: string | null | undefined): string {
  if (!name) return "";
  const more = /\s\+\d+$/.exec(name)?.[0] ?? "";
  const base = more ? name.slice(0, -more.length) : name;
  const asKey = base.trim().toUpperCase().replaceAll(/[\s/-]+/g, "_");
  const key = BY_LABEL.get(base.trim().toLowerCase()) ?? (BY_KEY.has(asKey) ? (asKey as RoleKey) : undefined);
  return key ? `${t(`${key}.label`)}${more}` : name;
}
