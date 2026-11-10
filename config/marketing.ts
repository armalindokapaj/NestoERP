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

/** The demo story's first slide for each business, as the landing page links it. */
const story = (persona: "developer" | "contractor" | "group") => `/?story=${persona}&step=company`;

/**
 * The Ribbon masthead (UI-05 §2): five tabs, each opening a panel of groups.
 * Icons are named here and drawn by the masthead; the words are in the site
 * copy under `ribbon`, keyed to the same names. Modules are not listed: that
 * tab is built from config/modules.ts, so it can never offer a module that
 * does not exist.
 */
export type RibbonIcon =
  | "LayoutGrid" | "Eye" | "Layers3" | "ShieldCheck" | "Smartphone" | "Moon"
  | "Building2" | "HardHat" | "Landmark" | "Users" | "Receipt" | "Tag"
  | "Sparkles" | "Info" | "CircleHelp" | "Mail" | "FilePen" | "LogIn";

export const siteRibbon = {
  platform: {
    groups: [
      {
        key: "understand",
        items: [
          { key: "overview", href: "/platform", icon: "LayoutGrid" },
          { key: "fullView", href: "/full-view", icon: "Eye" },
          { key: "record", href: "/full-view#overview", icon: "Layers3" },
        ],
      },
      {
        key: "trust",
        items: [
          { key: "security", href: "/security", icon: "ShieldCheck" },
          { key: "phone", href: "/full-view#experience", icon: "Smartphone" },
          { key: "dayNight", href: "/full-view#experience", icon: "Moon" },
        ],
      },
    ],
    callout: story("developer"),
  },
  solutions: {
    groups: [
      {
        key: "business",
        items: [
          { key: "developer", href: story("developer"), icon: "Building2" },
          { key: "contractor", href: story("contractor"), icon: "HardHat" },
          { key: "group", href: story("group"), icon: "Landmark" },
        ],
      },
    ],
    /** The roles the "By role" group names; every one opens the roles section of the Full View. */
    roles: ["CEO", "PROJECT_MANAGER", "ENGINEER", "PROCUREMENT", "QAQC", "HSE", "FINANCE", "SALES"] as RoleKey[],
    rolesHref: "/full-view#roles",
    callout: "/full-view#roles",
  },
  modules: { href: "/full-view#modules" },
  pricing: {
    groups: [
      {
        key: "build",
        items: [
          { key: "configure", href: "/pricing", icon: "Receipt" },
          { key: "rates", href: "/pricing#prices", icon: "Tag" },
          { key: "offer", href: "/pricing#offer", icon: "Sparkles" },
        ],
      },
    ],
    callout: "/pricing",
  },
  company: {
    groups: [
      {
        key: "nesto",
        items: [
          { key: "about", href: "/about", icon: "Info" },
          { key: "security", href: "/security", icon: "ShieldCheck" },
          { key: "questions", href: "/faq", icon: "CircleHelp" },
          { key: "contact", href: "/contact", icon: "Mail" },
        ],
      },
      {
        key: "getIn",
        items: [
          { key: "apply", href: "/apply", icon: "FilePen" },
          { key: "signIn", href: "/login", icon: "LogIn" },
        ],
      },
    ],
  },
} as const satisfies Record<string, unknown>;

export const RIBBON_TABS = ["platform", "solutions", "modules", "pricing", "company"] as const;
export type RibbonTab = (typeof RIBBON_TABS)[number];

/**
 * The section cut on the home page (UI-05 §3): NESTO drawn as a building, a
 * floor for every department, top to bottom. Levels count down to the ground;
 * the modules are the ones the floor's sheet names, and the first one lends
 * the sheet its icon.
 */
export const sectionFloors = [
  { key: "management", level: "roof", modules: ["dashboard", "approvals", "calendar"] },
  { key: "sales", level: 7, modules: ["sales", "contracts", "clients"] },
  { key: "finance", level: 6, modules: ["finance"] },
  { key: "people", level: 5, modules: ["hr", "people", "team"] },
  { key: "engineering", level: 4, modules: ["engineering", "documents"] },
  { key: "procurement", level: 3, modules: ["procurement", "inventory"] },
  { key: "quality", level: 2, modules: ["qaqc"] },
  { key: "site", level: 1, modules: ["dailyLogs", "workforce", "tasks"] },
  { key: "safety", level: "ground", modules: ["hse"] },
] as const satisfies readonly { key: string; level: number | "roof" | "ground"; modules: readonly ModuleKey[] }[];

export type SectionFloorKey = (typeof sectionFloors)[number]["key"];

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
      { key: "apply", href: "/apply" },
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

/** Applying for a workspace (/apply, UI-05 §6): the answers the form offers and the server accepts. */
export const applicationKinds = ["DEVELOPER", "CONTRACTOR", "GROUP", "OTHER"] as const;
export type ApplicationKind = (typeof applicationKinds)[number];

export const applicantRoles = ["owner", "operations", "it", "finance", "other"] as const;
export type ApplicantRole = (typeof applicantRoles)[number];

export const startWindows = ["now", "quarter", "later"] as const;
export type StartWindow = (typeof startWindows)[number];

/** The departments an applicant can tick, named by their modules. */
export const applicationDepartments = [
  "sales",
  "contracts",
  "finance",
  "hr",
  "procurement",
  "engineering",
  "qaqc",
  "hse",
] as const satisfies readonly ModuleKey[];
export type ApplicationDepartment = (typeof applicationDepartments)[number];
