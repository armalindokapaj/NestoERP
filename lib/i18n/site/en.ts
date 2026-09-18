import type {
  CompanySize,
  ContactChannelKey,
  ContactTopic,
  FaqGroupKey,
  FooterColumnKey,
  FooterLinkKey,
  LifecycleStageKey,
  PlanKey,
  StatKey,
} from "@/config/marketing";
import type { ModuleGroup, ModuleKey } from "@/config/modules";
import type { DemoStatus } from "@/lib/marketing/preview-data";

export type FaqItem = { question: string; answer: string };

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

type PageMeta = { title: string; description: string };

/**
 * The public site in English — the source.
 *
 * Every word the marketing pages say lives here, for the same reason roles,
 * modules and dashboards live in configuration: the pages are a rendering, not
 * a place to write copy. Its shape is the `SiteCopy` type every other language
 * is checked against; the links, figures and module lists the words sit beside
 * are in config/marketing.ts and shared by all of them.
 *
 * Kept apart from the interface dictionaries in lib/i18n/messages because only
 * the public pages read it, and only on the server. Those dictionaries are
 * handed to every client component in the application; this is long-form copy
 * a signed-in user never needs, so it never leaves the server as a whole.
 *
 * Module, role and access names are not repeated here — the site reads them
 * from the interface dictionaries, so the site and the product always agree.
 */
export const siteEn = {
  /** How NESTO is positioned publicly (§4). */
  category: "The Construction OS",
  /** The one sentence, used in metadata and wherever a summary is needed. */
  summary:
    "NESTO is the construction operating system — projects, procurement, quality, safety, people and finance in one workspace.",
  /** Shown beside the contact form as the reply commitment. */
  replyTime: "We reply within one business day.",

  meta: {
    contact: {
      title: "Contact",
      description:
        "Request access, book a walkthrough, or put a security review in front of your IT team. A person answers.",
    },
    faq: {
      title: "Questions",
      description:
        "What NESTO is, which modules are included, how access is enforced, what it costs and what is finished — answered directly.",
    },
    platform: {
      title: "Platform",
      description:
        "Seventeen modules, sixteen role workspaces and one project record — the whole construction lifecycle in a single system.",
    },
    pricing: {
      title: "Pricing",
      description:
        "One price per company, with all seventeen modules included on every plan. No per-module upsell and no per-seat surprises.",
    },
    security: {
      title: "Security",
      description:
        "How access is controlled in NESTO: permissions derived from the role, enforced at the edge and again in the page.",
    },
  } satisfies Record<string, PageMeta>,

  header: {
    home: "The Construction OS — home",
    siteNavigation: "Site",
    drawerTitle: "Site navigation",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    signIn: "Sign in",
    requestAccess: "Request access",
    language: "Language",
  },

  nav: {
    platform: "Platform",
    pricing: "Pricing",
    security: "Security",
    about: "About",
    contact: "Contact",
    faq: "Questions",
  },

  footer: {
    columns: {
      platform: "Platform",
      company: "Company",
      access: "Access",
    } satisfies Record<FooterColumnKey, string>,
    links: {
      overview: "Overview",
      modules: "Modules",
      roles: "Roles",
      lifecycle: "Lifecycle",
      pricing: "Pricing",
      about: "About",
      security: "Security",
      questions: "Questions",
      contact: "Contact",
      signIn: "Sign in",
      requestAccess: "Request access",
      privacy: "Privacy",
      terms: "Terms",
    } satisfies Record<FooterLinkKey, string>,
  },

  /* ---------------------------------------------------------------- *
   * Landing page
   * ---------------------------------------------------------------- */

  home: {
    hero: {
      /** Set as separate lines so the break is a design decision, not a guess. */
      headline: ["Run the entire build", "from one system."],
      lead: "Tender to handover, site to boardroom. NESTO holds every project, contract, purchase order, inspection, invoice and person a construction company runs on — in a single workspace, under a single set of permissions.",
      primary: "Request access",
      secondary: "Sign in",
      note: "One workspace per company. Accounts are provisioned by your administrator.",
    },
    problem: {
      eyebrow: "The problem",
      title: "Most construction companies run on eleven systems that never speak.",
      lead: "Not one of them is wrong on its own. Together they are a reconciliation job that runs every month, forever, and quietly costs more than the software.",
    },
    platform: {
      eyebrow: "The platform",
      title: "Seventeen modules. One workspace.",
      lead: "Every department in the same system, on the same project record — with procurement, quality and safety treated as first-class work rather than add-ons.",
      cta: "Explore the platform",
    },
    roles: { cta: "See all 16 roles" },
    build: {
      eyebrow: "End to end",
      title: "From the tender that wins it to the account that closes it.",
      lead: "A project does not stop at handover and it does not start on site. NESTO follows the whole thing, and every stage writes to the same record.",
    },
    principles: {
      eyebrow: "Why it feels different",
      title: "Premium is not decoration. It is what has been left out.",
      lead: "A narrow palette, one type scale, one component library and no ornament that does not carry information.",
    },
    access: { eyebrow: "Access", cta: "How access works" },
    questions: {
      eyebrow: "Questions",
      title: "The six things everyone asks first.",
      cta: "All questions",
    },
  },

  stats: {
    modules: { label: "Modules", note: "Every one included, on every plan." },
    roles: { label: "Roles", note: "Each with its own workspace and dashboard." },
    sourceOfTruth: { label: "Source of truth", note: "One database behind every department." },
    spreadsheets: {
      label: "Spreadsheets in between",
      note: "Nothing is re-keyed from one team to the next.",
    },
  } satisfies Record<StatKey, { label: string; note: string }>,

  /**
   * The category argument (§82). Stated as a pair rather than a claim: what a
   * construction company does today, and what NESTO replaces it with.
   */
  contrasts: [
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
  ],

  /** Marketing copy per module. Labels and icons come from config/modules.ts. */
  moduleCopy: {
    dashboard: "The screen each role opens first — their numbers, not everyone else's.",
    calendar: "Deadlines, inspections, deliveries and company events in one permission-aware schedule.",
    timesheets: "Weekly timesheets against projects and tasks — logged in minutes, approved by the right person, reported without surveillance.",
    dailyLogs: "One site diary per project per day — workforce, work done, deliveries, delays and photos, reviewed and locked as the record.",
    contractors: "Every contractor you engage — project assignments, work packages, insurance and guarantees, and the contracts behind them.",
    engineering: "Drawing and document registers with controlled revisions, RFIs, submittals, method statements and transmittals.",
    announcements: "Company, department and project notices that people acknowledge when it matters — no feed, no reactions.",
    approvals: "Every decision waiting on you — purchase orders, invoices, leave, contracts, documents — reviewed and decided in one place.",
    projects: "Every project as one record: programme, team, budget, drawings and status.",
    tasks: "Daily work assigned across site and office, always against a project.",
    meetings: "Agendas, minutes, decisions and the actions that follow — each action able to become a task.",
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
    people: "Everyone in the group, with where they work, what they work on and how to reach them.",
    team: "Everyone in the company, with the department and role they work under.",
    organization: "The parent group above your companies: its departments, the heads who run them, and the people HR brings in.",
    company: "Company identity and the details every document is issued under.",
    settings: "Roles, users, module activation and appearance, held by the administrator.",
    support: "Internal requests and the knowledge base your own team writes.",
  } satisfies Record<ModuleKey, string>,

  /** Zone headings for the public module grid (product zones stay internal). */
  moduleZones: {
    primary: { title: "Overview", lead: "Where every role begins." },
    work: { title: "Work", lead: "The day-to-day of delivering a project." },
    department: { title: "Departments", lead: "The eight functions a construction company runs on." },
    company: { title: "Company", lead: "The organisation behind the projects." },
  } satisfies Record<ModuleGroup, { title: string; lead: string }>,

  /**
   * Module tab and role department names, by their English wording in
   * config/modules.ts and config/roles.ts. English reads the configuration
   * directly, so it leaves these empty; another language fills every one, which
   * tests/unit/i18n/site-copy.test.ts checks against the configuration.
   */
  configLabels: {
    sections: {} as Record<string, string>,
    departments: {} as Record<string, string>,
  },

  lifecycle: {
    tender: {
      title: "Tender",
      copy: "Pipeline, client history and the proposal that becomes a contract.",
    },
    award: {
      title: "Award",
      copy: "Contract, budget and payment terms recorded once, then referenced everywhere.",
    },
    mobilise: {
      title: "Mobilise",
      copy: "Programme, team, suppliers and long-lead orders, before anyone breaks ground.",
    },
    build: {
      title: "Build",
      copy: "Daily work, materials and drawings tracked against the programme.",
    },
    assure: {
      title: "Assure",
      copy: "Inspections, NCRs, permits and incidents — evidence, not recollection.",
    },
    handOver: {
      title: "Hand over",
      copy: "Final account, as-built documentation, and what the next tender learns from it.",
    },
  } satisfies Record<LifecycleStageKey, { title: string; copy: string }>,

  /** Why the product feels the way it does (§82). */
  pillars: [
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
  ],

  /* ---------------------------------------------------------------- *
   * Roles
   * ---------------------------------------------------------------- */

  rolesSection: {
    eyebrow: "Built around the role",
    title: "Sixteen people open NESTO and see sixteen different companies.",
    lead: "A site engineer should not have to walk past the payroll to reach an inspection. In NESTO, the role decides the navigation, the dashboard, the quick actions and what the server will answer — all from one configuration.",
    readOnly: "Read-only",
  },

  /* ---------------------------------------------------------------- *
   * Product preview
   * ---------------------------------------------------------------- */

  preview: {
    description:
      "The NESTO dashboard: role navigation on the left, four headline figures across the top, an active project table with progress against programme, and a breakdown of work by stage.",
    search: "Search projects, people, documents",
    role: "CEO / Director",
    greeting: "Good morning, Sofia",
    subtitle: "Company performance across 12 sites.",
    date: "Monday · 14 Sep 2026",
    kpis: {
      activeProjects: { label: "Active projects", hint: "+2 this quarter" },
      contractValue: { label: "Contracted value", hint: "+8.4% against plan" },
      openNcrs: { label: "Open NCRs", hint: "−4 since last month" },
      daysWithoutIncident: { label: "Days without incident", hint: "Across every active site" },
    },
    /** `{label}` is the figure's name. */
    trend: "{label} trend",
    activeProjects: "Active projects",
    progress: "Progress",
    /** `{name}` is the project's name. */
    projectProgress: "{name} progress",
    statuses: {
      planning: "Planning",
      "in-progress": "In progress",
      handover: "Handover",
      archived: "Archived",
    } satisfies Record<DemoStatus, string>,
    workByStage: "Work by stage",
    stages: { build: "Build", mobilise: "Mobilise", tender: "Tender", handover: "Handover" },
    projectsByStage: "Projects by stage",
    projects: "Projects",
  },

  /* ---------------------------------------------------------------- *
   * Platform
   * ---------------------------------------------------------------- */

  platform: {
    eyebrow: "Platform",
    title: "Everything a construction company runs, in one workspace.",
    lead: "One database, one design system and one set of permissions behind every department — from the tender that wins the job to the account that closes it.",
    requestAccess: "Request access",
    seePricing: "See pricing",
    modules: {
      eyebrow: "Modules",
      title: "Seventeen modules, and the sections inside them.",
      lead: "Every module ships with its own route, header, navigation and dashboard. The tabs below are the ones your team will actually land on.",
    },
    rolesNote:
      "A role is configuration, not a screen. Its navigation, dashboard and permissions are declared once, and it then appears in the sidebar, the roles settings and the access checks — so your own roles can be added without a line of interface being written.",
    build: {
      eyebrow: "The build",
      title: "Six stages, one record.",
      lead: "Each stage names the modules it runs through, so the coverage can be checked rather than taken on trust.",
    },
    howItIsBuilt: {
      eyebrow: "How it is built",
      title: "The reasons it stays fast as it grows.",
    },
  },

  /* ---------------------------------------------------------------- *
   * Security
   * ---------------------------------------------------------------- */

  security: {
    eyebrow: "Security",
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
      eyebrow: "Plainly",
      title: "What we do not claim",
      copy: "NESTO does not yet hold third-party certification, and we will not display a badge we have not earned. What we can do is show you exactly how access control is built and let your IT team judge it. Ask, and we will walk them through it line by line.",
    },
    questions: { eyebrow: "Questions", title: "Security and data." },
  },

  /* ---------------------------------------------------------------- *
   * Pricing
   * ---------------------------------------------------------------- */

  pricing: {
    eyebrow: "Pricing",
    title: "Priced per company. Never per module.",
    lead: "Every plan includes all seventeen modules. There is no edition that withholds QA/QC until you upgrade, and no per-seat charge that makes you think twice about giving a foreman an account.",
    mostChosen: "Most chosen",
    /** In place of a figure, for a plan config/marketing.ts prices by agreement. */
    bespoke: "Bespoke",
    plans: {
      studio: {
        name: "Studio",
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
        cta: "Request access",
      },
      company: {
        name: "Company",
        period: "per company / month",
        summary:
          "For established construction companies running several sites and full departments.",
        seats: "Up to 100 users",
        features: [
          "Everything in Studio",
          "Guided onboarding and data setup",
          "Custom roles and permission mapping",
          "Priority support",
          "Quarterly platform review",
        ],
        cta: "Request access",
      },
      enterprise: {
        name: "Enterprise",
        period: "annual agreement",
        summary:
          "For groups operating multiple companies, joint ventures or a dedicated environment.",
        seats: "Unlimited users",
        features: [
          "Everything in Company",
          "Multiple company workspaces",
          "Dedicated environment",
          "Named implementation lead",
          "Service level agreement",
        ],
        cta: "Talk to us",
      },
    } satisfies Record<
      PlanKey,
      {
        name: string;
        period: string;
        summary: string;
        seats: string;
        features: string[];
        cta: string;
      }
    >,
    footnotes: [
      "Annual and monthly terms available. Annual is billed once, at a discount.",
      "Onboarding covers company setup, roles, users and module activation.",
      "No charge for a workspace while it is being set up.",
    ],
    questions: { eyebrow: "Commercial questions", title: "Before you ask us." },
  },

  /* ---------------------------------------------------------------- *
   * About
   * ---------------------------------------------------------------- */

  about: {
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
    /** Beside the brand motto, which the product shows as written. */
    mottoNote:
      "The same line sits beside the date on every dashboard in the product. It is not a slogan we wrote for this page — it is what the software is trying to be.",
  },

  /* ---------------------------------------------------------------- *
   * Questions
   * ---------------------------------------------------------------- */

  faq: {
    eyebrow: "Questions",
    title: "Answered directly, including the awkward ones.",
    lead: "If something you need is missing, ask. We would rather tell you it is not built yet than let you find out in month two.",
    stillUnanswered: "Still unanswered?",
    /** Either side of the general address, which is a link. */
    writeTo: "Write to",
    orAskDirectly: "or send us the question directly.",
    askUs: "Ask us",
    groups: {
      platform: {
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
      access: {
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
      security: {
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
            answer: "One eight-hour working day, then sign-in is required again.",
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
      gettingStarted: {
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
    } satisfies Record<FaqGroupKey, { title: string; items: FaqItem[] }>,
  },

  /* ---------------------------------------------------------------- *
   * Contact
   * ---------------------------------------------------------------- */

  contact: {
    eyebrow: "Contact",
    title: "Tell us about your company and your next project.",
    lead: "A walkthrough is a conversation, not a demo script. Tell us what you build and how many people need to see it, and we will show you the workspace they would actually get.",
    writeDirectly: "Or write directly",
    channels: {
      newCompanies: { label: "New companies", note: "Access, pricing and walkthroughs." },
      customers: {
        label: "Existing customers",
        note: "Your administrator can also raise it in Support.",
      },
      general: { label: "Everything else", note: "Partnerships, press and general questions." },
    } satisfies Record<ContactChannelKey, { label: string; note: string }>,
    account: {
      title: "Already have an account?",
      copy: "Sign in to your company workspace. Access is provisioned by your administrator, so they are the fastest route to a new account or a changed role.",
      link: "Sign in to NESTO",
    },

    form: {
      name: "Name",
      namePlaceholder: "Sofia Almeida",
      email: "Work email",
      emailPlaceholder: "you@company.com",
      company: "Company",
      companyPlaceholder: "Meridian Construction",
      size: "Company size",
      sizePlaceholder: "Choose a size",
      topic: "What is this about?",
      topicPlaceholder: "Choose a topic",
      message: "Message",
      messagePlaceholder:
        "What do you build, how many people need access, and what are you using today?",
      website: "Website",
      topics: {
        access: "Request access",
        walkthrough: "Book a walkthrough",
        pricing: "Pricing and plans",
        security: "Security review",
        other: "Something else",
      } satisfies Record<ContactTopic, string>,
      sizes: {
        "1-10": "1–10 people",
        "11-50": "11–50 people",
        "51-200": "51–200 people",
        "200+": "More than 200 people",
      } satisfies Record<CompanySize, string>,
      submit: "Send message",
      sending: "Sending…",
      sentTitle: "Message received.",
      /** Either side of the sales address, which is a link; the reply time comes first. */
      urgentBefore: "If it is urgent, write to",
      urgentAfter: "and it will reach the same people.",
      sendAnother: "Send another message",
      errors: {
        nameRequired: "Enter your name",
        nameTooLong: "That name is too long",
        emailRequired: "Enter your work email",
        emailInvalid: "Enter a valid email address",
        emailTooLong: "That email address is too long",
        companyRequired: "Enter your company",
        companyTooLong: "That name is too long",
        sizeRequired: "Choose a company size",
        topicRequired: "Choose what this is about",
        messageTooShort: "A sentence or two, so we can answer properly",
        messageTooLong: "Please keep it under 2000 characters",
        invalid: "Some details are missing. Check the form and try again.",
        failed: "We could not send that. Please email us directly.",
      },
    },
  },

  /* ---------------------------------------------------------------- *
   * Closing call to action
   * ---------------------------------------------------------------- */

  closingCta: {
    eyebrow: "One workspace",
    headline: ["Bring the whole company", "into one system."],
    lead: "Projects, procurement, quality, safety, people and finance — under one roof, with one set of rights over it.",
    primary: "Request access",
    secondary: "See the platform",
  },

  /* ---------------------------------------------------------------- *
   * Legal
   * ---------------------------------------------------------------- */

  legal: {
    lastUpdated: "Last updated",

    privacy: {
      eyebrow: "Privacy",
      title: "What we collect, which is very little.",
      lead: "NESTO is a workspace your company pays for. That makes your data your asset and our responsibility — not a second product we quietly sell.",
      updated: "September 2026",
      note: "This is a plain-language summary of how NESTO handles data. The binding terms are in the data processing agreement that accompanies a signed contract — ask and we will send it before you sign anything.",
      sections: [
        {
          title: "This public site",
          body: [
            "The pages you are reading collect nothing. There is no analytics script, no tag manager, no advertising pixel, no embedded widget and no external font request at runtime. No cookie is set before you sign in, except one that remembers the language you choose, if you choose one.",
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
    } satisfies LegalDocument,

    terms: {
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
    } satisfies LegalDocument,
  },
};

export type SiteCopy = typeof siteEn;
