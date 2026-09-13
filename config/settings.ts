import type { Permission } from "./permissions";

/**
 * Settings sections (PRD #5 §39).
 *
 * Profile and Appearance are *personal*: every authenticated user reaches them
 * from Settings in the top-bar user menu, whatever their role's Settings
 * access. The company sections are gated on `settings.manage`, and Roles
 * additionally on team administration.
 */
export const SETTINGS_SLUGS = [
  "profile",
  "company",
  "users",
  "roles",
  "modules",
  "localization",
  "integrations",
  "numbering",
  "storage",
  "audit",
  "appearance",
  "notifications",
] as const;

export type SettingsSlug = (typeof SETTINGS_SLUGS)[number];

/**
 * A section's name and description are interface copy, so they live in the
 * dictionaries under `settings.sections.<slug>` rather than here.
 */
export type SettingsSection = {
  slug: SettingsSlug;
  icon: string;
  /** Section is hidden and blocked without this permission. */
  permission: Permission;
  /** Personal sections need no Settings module access at all. */
  personal?: boolean;
};

export const settingsSections: SettingsSection[] = [
  {
    slug: "profile",
    icon: "IdCard",
    permission: "settings.view",
    personal: true,
  },
  {
    slug: "company",
    icon: "Landmark",
    permission: "settings.manage",
  },
  {
    slug: "users",
    icon: "Users",
    permission: "settings.manage",
  },
  {
    slug: "roles",
    icon: "ShieldCheck",
    permission: "settings.manage",
  },
  {
    slug: "modules",
    icon: "Boxes",
    permission: "settings.manage",
  },
  {
    slug: "localization",
    icon: "Globe",
    permission: "settings.manage",
  },
  {
    slug: "integrations",
    icon: "Workflow",
    permission: "settings.manage",
  },
  {
    slug: "numbering",
    icon: "Hash",
    permission: "settings.manage",
  },
  {
    slug: "storage",
    icon: "HardDrive",
    // Reading the number, not configuring the buckets — physical storage is
    // deployment configuration and no company admin edits it (PRD #29 §246).
    permission: "company.storage.view",
  },
  {
    slug: "audit",
    icon: "ScrollText",
    // Narrower than the other company sections on purpose: audit is evidence
    // about administrators too, so only the Owner holds it by default
    // (PRD #28 §222-§225).
    permission: "audit.view",
  },
  {
    slug: "appearance",
    icon: "Settings",
    permission: "settings.view",
    personal: true,
  },
  {
    // What NESTO tells this person about, and where (PRD #38 §78).
    slug: "notifications",
    icon: "BellRing",
    permission: "settings.view",
    personal: true,
  },
];

export function findSettingsSection(slug: string): SettingsSection | undefined {
  return settingsSections.find((section) => section.slug === slug);
}
