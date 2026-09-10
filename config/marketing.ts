/**
 * The public site (design spec §81, §82).
 *
 * Every word the marketing pages say lives here, for the same reason roles,
 * modules and dashboards do: the pages are a rendering of configuration, not a
 * place to write copy. One edit changes the sentence everywhere it appears, and
 * a page can never quietly disagree with the product about what NESTO is.
 *
 * Names and labels are read from config/modules.ts and config/roles.ts rather
 * than restated here, so the site cannot drift from the application it sells.
 */
import type { ModuleKey } from "./modules";
import type { RoleKey } from "./roles";

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

export const site = {
  /** How NESTO is positioned publicly (§4). */
  category: "The Construction OS",
  /** The one sentence, used in metadata and wherever a summary is needed. */
  summary:
    "NESTO is the construction operating system — projects, procurement, quality, safety, people and finance in one workspace.",
  /** Replace with your real addresses before launch. */
  contact: {
    general: "hello@nesto.build",
    sales: "sales@nesto.build",
    support: "support@nesto.build",
    /** Shown beside the contact form as the reply commitment. */
    replyTime: "We reply within one business day.",
  },
} as const;

export const siteNav = [
  { label: "Platform", href: "/platform" },
  { label: "Pricing", href: "/pricing" },
  { label: "Security", href: "/security" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
] as const;

export const footerNav = [
  {
    title: "Platform",
    links: [
      { label: "Overview", href: "/platform" },
      { label: "Modules", href: "/platform#modules" },
      { label: "Roles", href: "/platform#roles" },
      { label: "Lifecycle", href: "/platform#lifecycle" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Security", href: "/security" },
      { label: "Questions", href: "/faq" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Access",
    links: [
      { label: "Sign in", href: "/login" },
      { label: "Request access", href: "/contact" },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
] as const;

/* ------------------------------------------------------------------ *
 * Landing page
 * ------------------------------------------------------------------ */

export const hero = {
  eyebrow: site.category,
  /** Set as separate lines so the break is a design decision, not a guess. */
  headline: ["Run the entire build", "from one system."],
  lead: "Tender to handover, site to boardroom. NESTO holds every project, contract, purchase order, inspection, invoice and person a construction company runs on — in a single workspace, under a single set of permissions.",
  primary: { label: "Request access", href: "/contact" },
  secondary: { label: "Sign in", href: "/login" },
  note: "One workspace per company. Accounts are provisioned by your administrator.",
} as const;

/** Figures that describe the product itself — nothing here needs a footnote. */
export const stats = [
  { figure: "17", label: "Modules", note: "Every one included, on every plan." },
  { figure: "16", label: "Roles", note: "Each with its own workspace and dashboard." },
  { figure: "1", label: "Source of truth", note: "One database behind every department." },
  { figure: "0", label: "Spreadsheets in between", note: "Nothing is re-keyed from one team to the next." },
] as const;

/**
 * The category argument (§82). Stated as a pair rather than a claim: what a
 * construction company does today, and what NESTO replaces it with.
 */
export const contrasts = [
  {
    before: "A tender spreadsheet, a site group chat and the accountant's folder.",
    after: "One project record every department reads from and writes to.",
  },
  {
    before: "Monthly reporting assembled by hand from four exports.",
    after: "A dashboard that is already the report, for the role reading it.",
  },
  {
    before: "Access decided by who happens to have the file.",
    after: "Access decided by role, and refused on every single request.",
  },
  {
    before: "A general business tool bent into the shape of construction.",
    after: "Procurement, QA/QC and HSE as first-class modules, not add-ons.",
  },
] as const;

/** Marketing copy per module. Labels and icons come from config/modules.ts. */
export const moduleCopy: Record<ModuleKey, string> = {
  dashboard: "The screen each role opens first — their numbers, not everyone else's.",
  projects: "Every project as one record: programme, team, budget, drawings and status.",
  tasks: "Daily work assigned across site and office, always against a project.",
  clients: "Clients, contacts, and the history of every job you have delivered for them.",
  documents: "Drawings, method statements, certificates and contracts in one place.",
  finance: "Budgets, invoices, payments and cost against value — per project and company-wide.",
  hr: "Crews and staff, attendance, leave, records and recruitment.",
  sales: "Pipeline, opportunities and proposals — the tender before it becomes a contract.",
  contracts: "Contracts, approvals and notices, with the paper trail intact.",
  procurement: "Requests, RFQs, tenders, suppliers, purchase orders and deliveries.",
  inventory: "Materials, stock levels and movements across stores and sites.",
  qaqc: "Inspections, non-conformances, tests and punch lists, closed out on the record.",
  hse: "Incidents, permits, inspections and corrective actions.",
  team: "Everyone in the company, with the department and role they work under.",
  company: "Company identity and the details every document is issued under.",
  settings: "Roles, users, module activation and appearance, held by the administrator.",
  support: "Internal requests and the knowledge base your own team writes.",
};

/** Zone headings for the public module grid (product zones stay internal). */
export const moduleZoneCopy = {
  MAIN: { title: "Overview", lead: "Where every role begins." },
  WORK: { title: "Work", lead: "The day-to-day of delivering a project." },
  DEPARTMENT: { title: "Departments", lead: "The eight functions a construction company runs on." },
  COMPANY: { title: "Company", lead: "The organisation behind the projects." },
} as const;

/** The build, end to end — the spine of the platform story. */
export const lifecycle = [
  {
    step: "01",
    title: "Tender",
    copy: "Pipeline, client history and the proposal that becomes a contract.",
    modules: ["sales", "clients", "documents"] as ModuleKey[],
  },
  {
    step: "02",
    title: "Award",
    copy: "Contract, budget and payment terms recorded once, then referenced everywhere.",
    modules: ["contracts", "finance"] as ModuleKey[],
  },
  {
    step: "03",
    title: "Mobilise",
    copy: "Programme, team, suppliers and long-lead orders, before anyone breaks ground.",
    modules: ["projects", "team", "hr", "procurement"] as ModuleKey[],
  },
  {
    step: "04",
    title: "Build",
    copy: "Daily work, materials and drawings tracked against the programme.",
    modules: ["tasks", "inventory", "documents"] as ModuleKey[],
  },
  {
    step: "05",
    title: "Assure",
    copy: "Inspections, NCRs, permits and incidents — evidence, not recollection.",
    modules: ["qaqc", "hse"] as ModuleKey[],
  },
  {
    step: "06",
    title: "Hand over",
    copy: "Final account, as-built documentation, and what the next tender learns from it.",
    modules: ["finance", "documents", "company"] as ModuleKey[],
  },
] as const;

/** Why the product feels the way it does (§82). */
export const pillars = [
  {
    title: "Fast, on purpose",
    copy: "Pages render on the server and ship almost no JavaScript. This site loads no images at all — every line, chart and frame you see is drawn from the same tokens the product uses.",
    points: ["Server-rendered", "No image payload", "Instant navigation"],
  },
  {
    title: "One system, visibly",
    copy: "Seventeen modules, one design system. A single file holds every colour, radius, shadow and duration, so no screen invents its own. Learn one module and you have learned all of them.",
    points: ["One token set", "One component library", "One layout standard"],
  },
  {
    title: "Control by construction",
    copy: "Permissions are derived from the role, not written into screens. A module hidden from the sidebar is also refused by the router — the two are the same configuration, so they cannot drift apart.",
    points: ["Role-derived access", "Refused at the edge", "Refused again in the page"],
  },
] as const;

/* ------------------------------------------------------------------ *
 * Roles
 * ------------------------------------------------------------------ */

export const rolesSection = {
  eyebrow: "Built around the role",
  title: "Sixteen people open NESTO and see sixteen different companies.",
  lead: "A site engineer should not have to walk past the payroll to reach an inspection. In NESTO, the role decides the navigation, the dashboard, the quick actions and what the server will answer — all from one configuration.",
} as const;

/** Roles the site leads with; the rest are listed after. */
export const featuredRoles: RoleKey[] = [
  "CEO",
  "PROJECT_MANAGER",
  "PROCUREMENT",
  "QAQC",
  "HSE",
  "FINANCE",
];

/* ------------------------------------------------------------------ *
 * Security
 * ------------------------------------------------------------------ */

export const security = {
  title: "Access is a structural decision, not a setting.",
  lead: "Construction data is commercially sensitive long before it is legally sensitive — margins, claims, incidents, payroll. NESTO treats access as part of the architecture rather than a checkbox on an admin screen.",
  measures: [
    {
      title: "Role-derived permissions",
      copy: "Permissions are generated from each role's navigation. Granting a module in the sidebar grants the view permission; removing it removes the grant. Feature code asks whether a permission is held, never which role is signed in.",
    },
    {
      title: "Enforced twice",
      copy: "Every request is checked at the edge by middleware, then again inside the page it reached. A route added without a middleware rule fails closed rather than open.",
    },
    {
      title: "Read-only means read-only",
      copy: "Roles marked read-only have every non-view grant stripped when permissions are built, whatever a table says. A Viewer cannot reach a create route by typing the URL.",
    },
    {
      title: "Company isolation",
      copy: "A role is held on the membership that joins a person to a company, not on the person. Data is scoped to the company workspace, and one account may belong to several companies with different rights in each.",
    },
    {
      title: "Sessions that expire",
      copy: "Sign-in issues a signed token carrying the company and role, valid for one eight-hour working day. Failed sign-ins return one generic message and never disclose which half was wrong.",
    },
    {
      title: "Nothing third-party in the page",
      copy: "No analytics scripts, no tag managers, no embedded widgets, no external fonts loading at runtime. Your people are the only ones watching your workspace.",
    },
  ],
  /** Stated plainly rather than implied by a badge wall. */
  honesty: {
    title: "What we do not claim",
    copy: "NESTO does not yet hold third-party certification, and we will not display a badge we have not earned. What we can do is show you exactly how access control is built and let your IT team judge it. Ask, and we will walk them through it line by line.",
  },
} as const;

/* ------------------------------------------------------------------ *
 * Pricing
 * ------------------------------------------------------------------ */

export const pricing = {
  title: "Priced per company. Never per module.",
  lead: "Every plan includes all seventeen modules. There is no edition that withholds QA/QC until you upgrade, and no per-seat charge that makes you think twice about giving a foreman an account.",
  /** The only place figures are set. Currency follows the demo company. */
  currency: "EUR",
  plans: [
    {
      key: "studio",
      name: "Studio",
      price: "€390",
      period: "per company / month",
      summary: "For design studios and contractors running a handful of projects at a time.",
      seats: "Up to 25 users",
      features: [
        "All 17 modules",
        "All 16 role workspaces",
        "Company workspace and branding",
        "Module activation control",
        "Email support",
      ],
      cta: { label: "Request access", href: "/contact" },
      featured: false,
    },
    {
      key: "company",
      name: "Company",
      price: "€890",
      period: "per company / month",
      summary: "For established construction companies running several sites and full departments.",
      seats: "Up to 100 users",
      features: [
        "Everything in Studio",
        "Guided onboarding and data setup",
        "Custom roles and permission mapping",
        "Priority support",
        "Quarterly platform review",
      ],
      cta: { label: "Request access", href: "/contact" },
      featured: true,
    },
    {
      key: "enterprise",
      name: "Enterprise",
      price: "Bespoke",
      period: "annual agreement",
      summary: "For groups operating multiple companies, joint ventures or a dedicated environment.",
      seats: "Unlimited users",
      features: [
        "Everything in Company",
        "Multiple company workspaces",
        "Dedicated environment",
        "Named implementation lead",
        "Service level agreement",
      ],
      cta: { label: "Talk to us", href: "/contact" },
      featured: false,
    },
  ],
  footnotes: [
    "Annual and monthly terms available. Annual is billed once, at a discount.",
    "Onboarding covers company setup, roles, users and module activation.",
    "No charge for a workspace while it is being set up.",
  ],
} as const;

/* ------------------------------------------------------------------ *
 * About
 * ------------------------------------------------------------------ */

export const about = {
  eyebrow: "About",
  title: "Software that respects how a build actually runs.",
  lead: "Construction is the most coordinated thing most companies ever do, and it is usually coordinated with the least coordinated software. NESTO exists to close that gap.",
  sections: [
    {
      title: "Why it exists",
      body: [
        "A project passes through a dozen hands between the estimate and the final account. Every hand adds a document, a number and a decision — and in most companies every hand adds a new place to keep them.",
        "The cost is not the software licences. It is the week spent reconciling four versions of the same figure, the variation nobody logged, the certificate that was on somebody's laptop when the client asked for it.",
        "NESTO starts from the opposite premise: one system, one record, one set of rights over it. Everything else follows from that.",
      ],
    },
    {
      title: "What we believe",
      body: [
        "Role first. Software should show a person their work, not the company's entire org chart. Sixteen roles, sixteen workspaces, one configuration behind them.",
        "Restraint is a feature. A narrow palette, one type scale, one component library. Screens that are boring in the same way are screens you can learn once.",
        "Speed is respect. Nobody on a site has patience for a spinner. Pages render on the server and ship as little to the browser as they can get away with.",
        "Say what is true. No invented statistics, no borrowed logos, no certification badges we have not earned.",
      ],
    },
    {
      title: "Where NESTO is today",
      body: [
        "V0.1 is the foundation release: one application, one design system, one app shell, one module system and one role configuration. All sixteen roles sign in and work from their own perspective, and all seventeen modules have a real route, header, navigation and dashboard.",
        "Module functionality is being built out on that foundation, module by module. We would rather tell you that plainly than sell you a screenshot of something that does not exist yet.",
        "If you want to shape what gets built next, that is exactly the conversation to have with us now.",
      ],
    },
  ],
  principles: [
    { term: "One system", copy: "Every department in the same workspace, on the same record." },
    { term: "One design", copy: "One token set behind every screen, in light and dark." },
    { term: "One rule set", copy: "Access derived from the role, enforced on every request." },
  ],
} as const;

/* ------------------------------------------------------------------ *
 * Questions
 * ------------------------------------------------------------------ */

export type FaqItem = { question: string; answer: string };

export const faqGroups: { title: string; items: FaqItem[] }[] = [
  {
    title: "The platform",
    items: [
      {
        question: "What exactly is NESTO?",
        answer:
          "A construction ERP: one workspace holding projects, tasks, clients, documents, finance, HR, sales, contracts, procurement, inventory, QA/QC, HSE and company administration. Not a project tool bolted to an accounting package — one system with one database behind all of it.",
      },
      {
        question: "Is NESTO only for construction?",
        answer:
          "It is built for it. The module set is a construction company's: procurement with RFQs and tenders, inventory with site movements, QA/QC with NCRs and punch lists, HSE with permits and incidents. A company outside construction would be paying for a shape it does not need.",
      },
      {
        question: "Which modules are included?",
        answer:
          "All seventeen, on every plan. There is no edition that withholds a module until you upgrade, because a company that cannot afford the quality module is exactly the company that needs it.",
      },
      {
        question: "Can we switch a module off?",
        answer:
          "Yes, per company, from Settings. A module switched off is unreachable rather than merely hidden: it leaves the sidebar and the router refuses its routes.",
      },
      {
        question: "Does it replace our accounting software?",
        answer:
          "It replaces the operational side — budgets, invoices, payments, expenses and cost against value per project. Statutory accounting and filing stay with your accountant. NESTO is where the numbers are produced, not where they are audited.",
      },
      {
        question: "Does it work on site?",
        answer:
          "The whole application is responsive down to a phone. Below tablet width the navigation moves into a drawer and the layout narrows to a single column — the same screens, not a reduced mobile version.",
      },
    ],
  },
  {
    title: "Roles and access",
    items: [
      {
        question: "How do people get accounts?",
        answer:
          "Your administrator provisions them inside your company workspace and assigns the role. There is no public sign-up: a construction company's workspace is not something anyone should be able to join.",
      },
      {
        question: "Can one person hold two roles?",
        answer:
          "One role per company membership. A person can belong to several companies with a different role in each — useful for group structures and joint ventures.",
      },
      {
        question: "What can a read-only account do?",
        answer:
          "See, and nothing else. Read-only roles have every create, edit and delete grant stripped when their permissions are built, so a create route is refused even if the URL is typed by hand.",
      },
      {
        question: "Can we add a role of our own?",
        answer:
          "Yes. A role is configuration — its navigation, dashboard and permissions are declared in one place, and it then appears in the sidebar, the roles screen and the access checks without a screen being written.",
      },
    ],
  },
  {
    title: "Security and data",
    items: [
      {
        question: "Where does our data live?",
        answer:
          "In your company workspace, scoped to your company record. The role that grants access is held on the membership joining a person to that company, so nothing is visible across a boundary it was not granted across.",
      },
      {
        question: "How is access enforced?",
        answer:
          "Twice. Middleware checks the session and the role configuration at the edge before a page is reached, and the page checks the permission again itself. A route added without a middleware rule fails closed.",
      },
      {
        question: "How long does a session last?",
        answer:
          "One eight-hour working day, then sign-in is required again.",
      },
      {
        question: "Do you train AI models on our data?",
        answer:
          "No. V0.1 has no AI features and your data is not used to train anything, by us or anyone else.",
      },
      {
        question: "What do you load from third parties?",
        answer:
          "Nothing at runtime. No analytics, no tag managers, no embedded widgets. The page you are reading loads no images and no external scripts.",
      },
    ],
  },
  {
    title: "Getting started",
    items: [
      {
        question: "How is NESTO priced?",
        answer:
          "Per company, per month, with every module included and a user ceiling per plan. Pricing is on the pricing page — no quote required to see a number.",
      },
      {
        question: "Can we see it before committing?",
        answer:
          "Yes. Ask for a walkthrough and we will take you through a working workspace as any of the sixteen roles, so you can see what your own people would see.",
      },
      {
        question: "What does onboarding involve?",
        answer:
          "Your company workspace, your roles, your users and the modules you want switched on. Company plans include guided setup; the workspace is not billed while it is being prepared.",
      },
      {
        question: "How honest are you about what is finished?",
        answer:
          "Completely. V0.1 is the structural foundation — every module has its route, navigation, header and dashboard, and functionality is being built onto that, module by module. If a feature you need is not built, we will tell you when it will be rather than show you a mockup.",
      },
    ],
  },
];

/** The subset the landing page asks. */
export const featuredFaq: FaqItem[] = [
  faqGroups[0].items[0],
  faqGroups[0].items[2],
  faqGroups[0].items[5],
  faqGroups[1].items[0],
  faqGroups[2].items[1],
  faqGroups[3].items[0],
];

/* ------------------------------------------------------------------ *
 * Contact
 * ------------------------------------------------------------------ */

export const contactPage = {
  eyebrow: "Contact",
  title: "Tell us about your company and your next project.",
  lead: "A walkthrough is a conversation, not a demo script. Tell us what you build and how many people need to see it, and we will show you the workspace they would actually get.",
  channels: [
    { label: "New companies", value: site.contact.sales, note: "Access, pricing and walkthroughs." },
    { label: "Existing customers", value: site.contact.support, note: "Your administrator can also raise it in Support." },
    { label: "Everything else", value: site.contact.general, note: "Partnerships, press and general questions." },
  ],
} as const;

/** Why someone is writing — kept short enough to answer without thinking. */
export const contactTopics = [
  { value: "access", label: "Request access" },
  { value: "walkthrough", label: "Book a walkthrough" },
  { value: "pricing", label: "Pricing and plans" },
  { value: "security", label: "Security review" },
  { value: "other", label: "Something else" },
] as const;

export const companySizes = [
  { value: "1-10", label: "1–10 people" },
  { value: "11-50", label: "11–50 people" },
  { value: "51-200", label: "51–200 people" },
  { value: "200+", label: "More than 200 people" },
] as const;

/* ------------------------------------------------------------------ *
 * Closing call to action
 * ------------------------------------------------------------------ */

export const closingCta = {
  eyebrow: "One workspace",
  headline: ["Bring the whole company", "into one system."],
  lead: "Projects, procurement, quality, safety, people and finance — under one roof, with one set of rights over it.",
  primary: { label: "Request access", href: "/contact" },
  secondary: { label: "See the platform", href: "/platform" },
} as const;

/* ------------------------------------------------------------------ *
 * Legal
 * ------------------------------------------------------------------ */

/**
 * Plain-language summaries, not contracts.
 *
 * A public site with dead Privacy and Terms links is worse than one with none,
 * and boilerplate nobody wrote is worse still. These say what NESTO actually
 * does, in the fewest words that are true, and point at the signed agreement
 * for anything binding.
 */
export type LegalDocument = {
  eyebrow: string;
  title: string;
  lead: string;
  updated: string;
  note: string;
  sections: { title: string; body: string[] }[];
};

export const privacyDocument: LegalDocument = {
  eyebrow: "Privacy",
  title: "What we collect, which is very little.",
  lead: "NESTO is a workspace your company pays for. That makes your data your asset and our responsibility — not a second product we quietly sell.",
  updated: "September 2026",
  note: "This is a plain-language summary of how NESTO handles data. The binding terms are in the data processing agreement that accompanies a signed contract — ask and we will send it before you sign anything.",
  sections: [
    {
      title: "This public site",
      body: [
        "The pages you are reading collect nothing. There is no analytics script, no tag manager, no advertising pixel, no embedded widget and no external font request at runtime. No cookie is set before you sign in.",
        "The only information this site receives is what you choose to type into the contact form.",
      ],
    },
    {
      title: "The contact form",
      body: [
        "Your name, work email, company, company size, topic and message. We use them to answer you and to prepare a workspace if you ask for one.",
        "They are never sold, never used for advertising, and never shared outside the people answering you.",
      ],
    },
    {
      title: "Inside the application",
      body: [
        "Your company administrator creates accounts and assigns roles, so the account details in NESTO are the details your company chose to put there: name, work email, department, job title, role and the records your team creates as it works.",
        "Sign-in sets one essential cookie holding a signed session token with your company and role. It expires after one eight-hour working day. There are no analytics or advertising cookies anywhere in the product.",
        "Your data is not used to train any model, ours or anyone else's.",
      ],
    },
    {
      title: "Your rights",
      body: [
        "You can ask what we hold, ask for it to be corrected, and ask for it to be deleted. If you are a user rather than the account holder, your company administrator can do most of this directly inside Settings.",
        "Write to us and a person will answer.",
      ],
    },
  ],
};

export const termsDocument: LegalDocument = {
  eyebrow: "Terms",
  title: "How NESTO is provided.",
  lead: "A summary of the arrangement, in the order the questions usually come up. The binding version is the contract your company signs.",
  updated: "September 2026",
  note: "This page summarises the terms under which NESTO is offered. It is not the agreement itself, and nothing here overrides a signed contract.",
  sections: [
    {
      title: "Access",
      body: [
        "NESTO is provided per company. Your administrator creates accounts, assigns roles and switches modules on or off inside your workspace.",
        "There is no public sign-up, and accounts are for named people. Sharing one login across a crew defeats every access control described on the security page.",
      ],
    },
    {
      title: "Your data",
      body: [
        "Everything your company puts into NESTO belongs to your company. We hold it to run the service you are paying for and for no other purpose.",
        "If you leave, you can take it with you, and we delete what remains on the schedule set out in the agreement.",
      ],
    },
    {
      title: "Fair use",
      body: [
        "Use NESTO for your construction business. Do not attempt to breach its access controls, resell access, or upload anything unlawful.",
        "We may suspend an account that puts the platform or another company at risk, and we will tell you why.",
      ],
    },
    {
      title: "Availability and change",
      body: [
        "We aim for the platform to be available whenever your teams are working, and Enterprise agreements carry a service level with numbers in it.",
        "The product changes as modules are built out. Changes that remove something you rely on are announced before they happen, not after.",
      ],
    },
    {
      title: "Fees and term",
      body: [
        "Plans are billed per company, monthly or annually, at the rates on the pricing page. A workspace is not billed while it is being set up.",
        "Either side can end the agreement at the end of a term. We do not hold your data hostage to a renewal.",
      ],
    },
  ],
};
