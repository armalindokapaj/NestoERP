/**
 * The public site (design spec §81, §82) — its structure.
 *
 * What the marketing pages link to, which figures they quote, which modules a
 * lifecycle stage runs through, which roles and questions lead: everything that
 * reads the same in every language. The words themselves live in lib/i18n/site,
 * one file per language, keyed to what is declared here — so a translation can
 * reword a page but never point it somewhere else or change a price.
 *
 * Names and labels are read from config/modules.ts and config/roles.ts rather
 * than restated here, so the site cannot drift from the application it sells.
 */
import { moduleList, type ModuleKey } from "./modules";
import { MEMBERSHIP_ROLE_KEYS, type RoleKey } from "./roles";

/** Replace with your real addresses before launch. */
export const siteContact = {
  general: "hello@nesto.build",
  sales: "sales@nesto.build",
  support: "support@nesto.build",
} as const;

export const siteNav = [
  { key: "fullView", href: "/full-view" },
  { key: "pricing", href: "/pricing" },
  { key: "security", href: "/security" },
  { key: "about", href: "/about" },
  { key: "contact", href: "/contact" },
] as const;

export const footerNav = [
  {
    key: "platform",
    links: [
      { key: "fullView", href: "/full-view" },
      { key: "overview", href: "/platform" },
      { key: "modules", href: "/full-view#modules" },
      { key: "roles", href: "/full-view#roles" },
      { key: "lifecycle", href: "/full-view#lifecycle" },
      { key: "pricing", href: "/pricing" },
    ],
  },
  {
    key: "company",
    links: [
      { key: "about", href: "/about" },
      { key: "security", href: "/security" },
      { key: "questions", href: "/faq" },
      { key: "contact", href: "/contact" },
    ],
  },
  {
    key: "access",
    links: [
      { key: "signIn", href: "/login" },
      { key: "requestAccess", href: "/contact" },
      { key: "privacy", href: "/privacy" },
      { key: "terms", href: "/terms" },
    ],
  },
] as const;

export type FooterColumnKey = (typeof footerNav)[number]["key"];
export type FooterLinkKey = (typeof footerNav)[number]["links"][number]["key"];

/**
 * Figures that describe the product itself — nothing here needs a footnote.
 * Module and role counts are read from the registries, so they cannot go stale
 * (Landing + Full View PRD §89).
 */
export const stats = [
  { key: "modules", figure: String(moduleList.length) },
  { key: "roles", figure: String(MEMBERSHIP_ROLE_KEYS.length) },
  { key: "sourceOfTruth", figure: "1" },
  { key: "spreadsheets", figure: "0" },
] as const;

export type StatKey = (typeof stats)[number]["key"];

/** The build, end to end — the spine of the platform story. */
export const lifecycle = [
  { key: "tender", modules: ["sales", "clients", "documents"] },
  { key: "award", modules: ["contracts", "finance"] },
  { key: "mobilise", modules: ["projects", "team", "hr", "procurement"] },
  { key: "build", modules: ["tasks", "inventory", "documents"] },
  { key: "assure", modules: ["qaqc", "hse"] },
  { key: "handOver", modules: ["finance", "documents", "company"] },
] as const satisfies readonly { key: string; modules: readonly ModuleKey[] }[];

export type LifecycleStageKey = (typeof lifecycle)[number]["key"];

/** Roles the site leads with; the rest are listed after. */
export const featuredRoles: RoleKey[] = [
  "CEO",
  "PROJECT_MANAGER",
  "PROCUREMENT",
  "QAQC",
  "HSE",
  "FINANCE",
];

export const pricing = {
  /** The only place figures are set. Currency follows the demo company. */
  currency: "EUR",
  plans: [
    { key: "studio", monthly: 390, featured: false },
    { key: "company", monthly: 890, featured: true },
    /** Priced by agreement, so the plan names its terms instead of a figure. */
    { key: "enterprise", monthly: null, featured: false },
  ],
} as const;

export type PlanKey = (typeof pricing.plans)[number]["key"];

export const FAQ_GROUPS = ["platform", "access", "security", "gettingStarted"] as const;

export type FaqGroupKey = (typeof FAQ_GROUPS)[number];

/** The subset the landing page asks, by group and position within it. */
export const featuredFaq: readonly (readonly [FaqGroupKey, number])[] = [
  ["platform", 0],
  ["platform", 2],
  ["platform", 5],
  ["access", 0],
  ["security", 1],
  ["gettingStarted", 0],
];

export const contactChannels = [
  { key: "newCompanies", email: siteContact.sales },
  { key: "customers", email: siteContact.support },
  { key: "general", email: siteContact.general },
] as const;

export type ContactChannelKey = (typeof contactChannels)[number]["key"];

/** Why someone is writing — kept short enough to answer without thinking. */
export const contactTopics = ["access", "walkthrough", "pricing", "security", "other"] as const;

export type ContactTopic = (typeof contactTopics)[number];

export const companySizes = ["1-10", "11-50", "51-200", "200+"] as const;

export type CompanySize = (typeof companySizes)[number];
