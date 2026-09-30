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
  "sales",
  "storage",
  "audit",
  "appearance",
  "notifications",
  "security",
  "mobile-devices",
  "mobile-policy",
  "security-events",
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
  /**
   * The page answers for the Group workspace itself — the union of the companies the
   * person holds the permission in — instead of asking which company (MOB-11 §141).
   */
  groupCapable?: boolean;
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
    // Company user administration lives in Team; this section is its door
    // from Company Settings (CEO Users & Roles §5).
    permission: "team.member.invite",
  },
  {
    slug: "roles",
    icon: "ShieldCheck",
    permission: "team.member.role.assign",
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
    // How long a unit reservation lasts unless a date is chosen (E-05E §24).
    slug: "sales",
    icon: "Handshake",
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
  {
    // The person's own devices and sessions, and how this device is protected (MOB-11 §15, §31).
    slug: "security",
    icon: "ShieldCheck",
    permission: "settings.view",
    personal: true,
  },
  {
    // Administrators: the mobile devices of their people (MOB-11 §23-§30).
    slug: "mobile-devices",
    icon: "Smartphone",
    permission: "security.devices.read",
    groupCapable: true,
  },
  {
    slug: "mobile-policy",
    icon: "SlidersHorizontal",
    permission: "security.policy.read",
    groupCapable: true,
  },
  {
    slug: "security-events",
    icon: "ScrollText",
    permission: "security.audit.read",
    groupCapable: true,
  },
];

export function findSettingsSection(slug: string): SettingsSection | undefined {
  return settingsSections.find((section) => section.slug === slug);
}
