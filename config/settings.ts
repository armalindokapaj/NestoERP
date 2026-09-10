import type { Permission } from "./permissions";

/** Settings sections (spec §46). */
export type SettingsSection = {
  slug: string;
  label: string;
  description: string;
  icon: string;
  /** Section is hidden and blocked without this permission. */
  permission: Permission;
};

export const settingsSections: SettingsSection[] = [
  {
    slug: "profile",
    label: "Profile",
    description: "Your personal details and contact information.",
    icon: "IdCard",
    permission: "settings.view",
  },
  {
    slug: "company",
    label: "Company",
    description: "Company identity, address and contact details.",
    icon: "Landmark",
    permission: "settings.manage",
  },
  {
    slug: "users",
    label: "Users",
    description: "Accounts, invitations and access status.",
    icon: "Users",
    permission: "settings.manage",
  },
  {
    slug: "roles",
    label: "Roles",
    description: "The 16 NESTO roles and the permissions each one holds.",
    icon: "ShieldCheck",
    permission: "settings.manage",
  },
  {
    slug: "modules",
    label: "Modules",
    description: "Which NESTO modules are active for your company.",
    icon: "Boxes",
    permission: "settings.manage",
  },
  {
    slug: "appearance",
    label: "Appearance",
    description: "Theme and display preferences.",
    icon: "Settings",
    permission: "settings.view",
  },
];
