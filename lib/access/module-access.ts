import type { AccessLevel, DataScope } from "@/config/access";
import {
  modules,
  type ModuleKey,
  type ModuleSectionConfig,
} from "@/config/modules";
import type { Permission } from "@/config/permissions";
import type { UserContext } from "@/lib/context/types";
import { accessAtLeast } from "@/config/access";
import { can, getAccessLevel, getModuleScope, isModuleEnabled } from "./can";

/**
 * The module experience resolver (PRD #7 §11, PRD #4 §84).
 *
 * `resolveModuleExperience(context, "finance")` answers, in one place, what the
 * current user's Finance looks like: how much access they have, which records
 * they may see, which tabs render and which actions are offered.
 *
 * The same route serves every role — only this result changes (PRD #4 §87).
 */
export type ResolvedModuleExperience = {
  module: ModuleKey;
  label: string;
  description: string;
  route: string;
  /** NONE when the role has no access, or the company disabled the module. */
  accessLevel: AccessLevel;
  scope: DataScope;
  /** False when the company switched the module off (PRD #7 §59). */
  enabled: boolean;
  permissions: Permission[];
  sections: ModuleSectionConfig[];
  defaultSection: string | null;
  /** Convenience flags used by module headers and row menus. */
  canCreate: boolean;
  canUpdate: boolean;
  readOnly: boolean;
};

export function resolveModuleExperience(
  context: UserContext,
  moduleKey: ModuleKey,
): ResolvedModuleExperience {
  const definition = modules[moduleKey];
  const accessLevel = getAccessLevel(context, moduleKey);
  const enabled = isModuleEnabled(context, moduleKey);
  const permissions = context.moduleAccess[moduleKey]?.permissions ?? [];

  const sections = definition.sections
    .filter((section) => isSectionVisible(context, moduleKey, section))
    .map((section) => resolveSectionLabel(context, moduleKey, section));

  const defaultSection =
    definition.defaultSection && sections.some((s) => s.key === definition.defaultSection)
      ? definition.defaultSection
      : (sections[0]?.key ?? null);

  return {
    module: moduleKey,
    label: definition.label,
    description: definition.description,
    route: definition.route,
    accessLevel,
    scope: getModuleScope(context, moduleKey),
    enabled,
    permissions: [...permissions],
    sections,
    defaultSection,
    canCreate: definition.writePermission
      ? can(context, definition.writePermission)
      : accessAtLeast(accessLevel, "CONTRIBUTE"),
    canUpdate: accessAtLeast(accessLevel, "CONTRIBUTE"),
    readOnly: accessLevel === "VIEW",
  };
}

/**
 * A tab the user cannot use is absent, not disabled (PRD #5 §30, PRD #7 §10).
 */
export function isSectionVisible(
  context: UserContext,
  moduleKey: ModuleKey,
  section: ModuleSectionConfig,
): boolean {
  const accessLevel = getAccessLevel(context, moduleKey);
  if (accessLevel === "NONE") return false;
  if (section.accessLevel && !accessAtLeast(accessLevel, section.accessLevel)) return false;
  if (section.permission && !can(context, section.permission)) {
    // The self-service door: the section still renders for somebody who may
    // only see their own records (PRD #16 §11).
    return section.selfPermission ? can(context, section.selfPermission) : false;
  }
  return true;
}

/** Scopes where a section with a `selfLabel` only ever shows the reader's own. */
const NARROW_SCOPES: DataScope[] = ["SELF", "ASSIGNED", "PROJECT"];

/**
 * Names the section for who is reading it.
 *
 * "My leave" rather than "Leave" when the tab leads to the reader's own records
 * and nothing else (PRD #16 §11). That is true in two different ways, and both
 * count: they hold only the self-service grant, or their scope is narrow enough
 * that the module grant reaches nobody but them.
 */
function resolveSectionLabel(
  context: UserContext,
  moduleKey: ModuleKey,
  section: ModuleSectionConfig,
): ModuleSectionConfig {
  if (!section.selfLabel) return section;

  const throughSelfGrant = Boolean(section.permission) && !can(context, section.permission!);
  const narrowScope = NARROW_SCOPES.includes(getModuleScope(context, moduleKey));

  return throughSelfGrant || narrowScope ? { ...section, label: section.selfLabel } : section;
}

/**
 * Resolve a URL section slug against what the user may actually see.
 * Returns null when the section does not exist or is not permitted, so the
 * caller can answer 404 rather than silently redirecting somewhere else.
 */
export function resolveSection(
  experience: ResolvedModuleExperience,
  requested?: string,
): ModuleSectionConfig | null {
  const key = requested ?? experience.defaultSection;
  if (!key) return null;
  return experience.sections.find((section) => section.key === key) ?? null;
}
