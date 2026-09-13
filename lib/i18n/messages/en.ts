import type { AccessLevel, DataScope } from "@/config/access";
import type { ModuleKey } from "@/config/modules";
import type { RoleKey } from "@/config/roles";
import type { SettingsSlug } from "@/config/settings";

type Described = { label: string; description: string };

/**
 * English — the source dictionary.
 *
 * Its shape is the `Messages` type every other language is checked against, so
 * a key added here and forgotten in another dictionary is a type error rather
 * than a blank in somebody's interface.
 *
 * `{name}` is replaced from the values passed to `t`. A key ending in `_one` /
 * `_other` is a plural pair: call it without the suffix and with a numeric
 * `count`, and the language's own plural rules pick the form.
 *
 * Covers the application frame — navigation, top bar, settings, sign-in and the
 * system pages. Module pages are not translated yet.
 */
export const en = {
  shell: {
    mainNavigation: "Main navigation",
    navigationTitle: "NESTO navigation",
    openNavigation: "Open navigation",
    closeNavigation: "Close navigation",
    dashboardLink: "NESTO dashboard",
    homeLink: "NESTO home",
    expandSidebar: "Expand sidebar",
    collapseSidebar: "Collapse sidebar",
    notifications: "Notifications",
    noNotifications: "You have no notifications.",
    notificationsLater: "Notifications arrive with the activity engine in a later version.",
    openUserMenu: "Open user menu",
    settings: "Settings",
    logout: "Logout",
    signingOut: "Signing out…",
    groups: {
      work: "Work",
      department: "Department",
      company: "Company",
    },
  },

  search: {
    placeholder: "Search projects, tasks, people or documents…",
    dialogTitle: "Search NESTO",
    later: "Searchable in a later version",
    notIndexed: "Not yet indexed",
    categories: {
      projects: "Projects",
      tasks: "Tasks",
      clients: "Clients",
      documents: "Documents",
      people: "People",
    },
  },

  modules: {
    dashboard: { label: "Dashboard", description: "Your role overview across the company." },
    projects: { label: "Projects", description: "Manage company projects and project activity." },
    tasks: { label: "Tasks", description: "Work assigned across projects and departments." },
    clients: { label: "Clients", description: "Companies and people your company works with." },
    documents: { label: "Documents", description: "Company, project and client documentation." },
    finance: { label: "Finance", description: "Company revenue, costs and financial control." },
    hr: { label: "HR", description: "People operations, records and recruitment." },
    sales: { label: "Sales", description: "Leads, pipeline, proposals and commercial activity." },
    contracts: { label: "Legal", description: "Contracts, approvals and legal records." },
    procurement: { label: "Procurement", description: "Purchasing, suppliers and order management." },
    inventory: { label: "Inventory", description: "Materials, stock levels and movements." },
    qaqc: { label: "QA/QC", description: "Inspections, non-conformances and quality control." },
    hse: { label: "HSE", description: "Health, safety and environment performance." },
    team: { label: "Team", description: "Everyone working inside your company workspace." },
    company: { label: "Company", description: "Company identity and organisation details." },
    settings: { label: "Settings", description: "Your profile and company configuration." },
    support: { label: "Support", description: "Internal support requests and platform help." },
  } satisfies Record<ModuleKey, Described>,

  roles: {
    OWNER: { label: "Owner", description: "Full visibility across every area of the company." },
    ADMIN: { label: "Admin", description: "Manages users, company configuration and platform setup." },
    COMPANY_IT: { label: "Company IT", description: "Maintains accounts, access, devices and internal support." },
    HR: { label: "HR", description: "Owns people operations, records and recruitment." },
    CEO: { label: "CEO / Director", description: "Company performance, approvals and strategic oversight." },
    PROJECT_MANAGER: { label: "Project Manager", description: "Runs projects, tasks, teams and client delivery." },
    ARCHITECT: { label: "Architect", description: "Design work, drawings, reviews and project documentation." },
    ENGINEER: { label: "Engineer", description: "Technical delivery, inspections and engineering tasks." },
    FINANCE: { label: "Finance", description: "Revenue, costs, invoicing and financial control." },
    LEGAL: { label: "Legal", description: "Contracts, approvals, notices and legal records." },
    SALES: { label: "Sales", description: "Pipeline, opportunities, proposals and client growth." },
    PROCUREMENT: { label: "Procurement", description: "Purchasing, suppliers, RFQs and orders." },
    INVENTORY: { label: "Stock / Inventory", description: "Materials, stock levels and movements." },
    QAQC: { label: "QA/QC", description: "Inspections, non-conformances and quality control." },
    HSE: { label: "HSE", description: "Safety performance, incidents, permits and actions." },
    VIEWER: { label: "Viewer", description: "Read-only access to company information." },
  } satisfies Record<RoleKey, Described>,

  access: {
    levels: {
      NONE: "No access",
      VIEW: "View",
      CONTRIBUTE: "Contribute",
      APPROVE: "Approve",
      MANAGE: "Manage",
    } satisfies Record<AccessLevel, string>,
    scopes: {
      SELF: "Own records",
      ASSIGNED: "Assigned records",
      PROJECT: "Project records",
      DEPARTMENT: "Department records",
      COMPANY: "Company-wide",
      SYSTEM: "System",
    } satisfies Record<DataScope, string>,
  },

  settings: {
    title: "Settings",
    description: "Your profile and company configuration.",
    save: "Save",
    saving: "Saving…",

    language: {
      title: "Language",
      description: "The language NESTO is shown in for you. Everyone else keeps their own choice.",
      partial: "",
    },

    sections: {
      profile: { label: "Profile", description: "Your personal details and contact information." },
      company: { label: "Company", description: "Company identity, address and contact details." },
      users: { label: "Users", description: "Accounts, invitations and access status." },
      roles: { label: "Roles", description: "The 16 NESTO roles and the permissions each one holds." },
      modules: { label: "Modules", description: "Which NESTO modules are active for your company." },
      localization: {
        label: "Localization",
        description: "Company locale, timezone, date format and company-wide finance defaults.",
      },
      integrations: {
        label: "Integrations",
        description: "Cross-module behaviours such as quality gating and finance commitments.",
      },
      numbering: { label: "Numbering", description: "How invoice, order and record numbers are generated." },
      storage: {
        label: "File storage",
        description: "How much file storage your company is using, and its limits.",
      },
      audit: {
        label: "Audit",
        description: "Immutable evidence of important business and security actions.",
      },
      appearance: { label: "Appearance", description: "Theme and display preferences." },
    } satisfies Record<SettingsSlug, Described>,

    appearance: {
      collapsedNavigation: "Collapsed navigation",
      collapsedNavigationHint:
        "Show the sidebar as an icon rail. On tablet-sized screens the rail is always used, whatever this is set to.",
      colourScheme: "Colour scheme",
      colourSchemeHint: "Follow your operating system, or pin NESTO to light or dark.",
      themes: { system: "System", light: "Light", dark: "Dark" },
      density: "Density",
      densityHint: "Comfortable spacing, tuned for long working sessions.",
      densityLater: "Selectable density arrives with the settings module.",
    },

    profile: {
      details: "Details",
      firstName: "First name",
      lastName: "Last name",
      email: "Email",
      position: "Position",
      department: "Department",
      company: "Company",
      devOverride: "Dev override — actual role {role}",
      editingLater: "Profile editing and photo upload arrive with the settings module.",
    },

    company: {
      metaTitle: "Company settings",
      name: "Company name",
      industry: "Industry",
      country: "Country",
      address: "Address",
      email: "Email",
      phone: "Phone",
      website: "Website",
      slug: "Workspace identifier",
      readOnly: "Company details are read-only in V0.1. Editing arrives with the settings module.",
    },

    users: {
      user: "User",
      email: "Email",
      role: "Role",
      account: "Account",
      manageLater: "Inviting, editing and deactivating users arrives with the settings module.",
    },

    roles: {
      description:
        "The 16 NESTO roles, the access level each holds in every module, and the data scope that applies.",
      modulesCount_one: "{count} module",
      modulesCount_other: "{count} modules",
      permissionsCount_one: "{count} permission",
      permissionsCount_other: "{count} permissions",
      noAccess: "No module access.",
    },

    modules: {
      note:
        "Turning a module off hides it for everyone and refuses its routes at once. Records already created are kept, not deleted, and reappear if the module is turned back on.",
      enabledToast: "{name} enabled.",
      disabledToast: "{name} disabled.",
      enable: "Enable {name}",
      disable: "Disable {name}",
      enabled: "Enabled",
      disabled: "Disabled",
    },

    localization: {
      description:
        "Company locale, timezone, date format and the company-wide finance defaults every module reads.",
      sectionTitle: "Localization",
      sectionDescription: "How dates and numbers appear across NESTO for your company.",
      locale: "Company locale",
      localeHint:
        "A company-wide default. Each person chooses the language NESTO is shown in from Settings.",
      locales: {
        en: "English",
        enUS: "English (United States)",
        deDE: "German (Germany)",
        sqAL: "Albanian (Albania)",
        itIT: "Italian (Italy)",
      },
      timezone: "Timezone",
      timezoneHint: "Business dates and due states resolve in this zone. Timestamps stay UTC.",
      dateFormat: "Date format",
      financeTitle: "Finance defaults",
      financeDescription: "Company-wide defaults every module reads.",
      baseCurrency: "Base currency",
      currencyLocked:
        "Locked: financial records already exist, and NESTO does not convert between currencies.",
      currencyHint: "Amounts are never converted between currencies.",
      fiscalYearStart: "Fiscal year starts",
      months: {
        m1: "January",
        m2: "February",
        m3: "March",
        m4: "April",
        m5: "May",
        m6: "June",
        m7: "July",
        m8: "August",
        m9: "September",
        m10: "October",
        m11: "November",
        m12: "December",
      },
      paymentTerms: "Default payment terms (days)",
      taxRate: "Default tax rate (%)",
      taxRateHint: "A form prefill only — not a tax engine.",
      submit: "Save settings",
      updated: "Company settings updated.",
    },

    integrations: {
      description:
        "Product-defined handoffs between modules. Turning one off changes future work only — records already created stay as they are.",
      qualityGate: "Quality gate before inventory receipt",
      qualityGateHint:
        "Goods must pass a QA inspection and be released before any quantity can post to stock.",
      commitment: "Create a finance commitment when a purchase order is approved",
      commitmentHint:
        "Approving a purchase order opens a matching commitment so the spend is visible before the invoice arrives.",
      submit: "Save integrations",
      updated: "Integration settings updated.",
    },

    numbering: {
      description:
        "How human-readable record numbers are generated. Changes apply to future records only.",
      mode: "Mode",
      automatic: "Automatic",
      manual: "Manual",
      prefix: "Prefix",
      separator: "Separator",
      year: "Year",
      noYear: "None",
      digits: "Digits",
      resetYearly: "Restart the sequence each year",
      manualPreview: "Typed in by whoever creates the record",
      updated: "{label} numbering updated.",
    },

    storage: {
      description: "How much file storage your company is using.",
      used: "Used",
      files: "Files",
      largestAllowed: "Largest single file",
      allowance: "Allowance",
      noLimit:
        "No storage limit is configured for your company, so uploads are bounded only by the {size} per-file ceiling. Usage is still measured and shown here.",
      storageUsed: "Storage used",
      usage: "{used} of {total} used ({percent}%).",
      reserved: "{size} is held for uploads that are in progress.",
      largestFiles: "Largest files",
      emptyTitle: "No files stored yet",
      emptyDescription: "Uploaded documents will appear here, largest first.",
      added: "Added {date}",
    },

    audit: {
      description:
        "Who did what, when, and what changed. Append-only: nothing here can be edited or removed.",
      exportCsv: "Export CSV",
      emptyTitle: "No audit events match these filters.",
      emptyDescription: "Audited actions from the last 30 days appear here.",
      when: "When",
      actor: "Actor",
      action: "Action",
      record: "Record",
      severity: "Severity",
      severities: { INFO: "Info", IMPORTANT: "Important", CRITICAL: "Critical" },
    },
  },

  auth: {
    brandHeadline: "One platform to run your company.",
    backToHome: "Back to home",
    backToLogin: "Back to login",
    email: "Email",
    emailPlaceholder: "you@company.com",

    login: {
      metaTitle: "Sign in",
      title: "Welcome back",
      description: "Sign in to continue to your workspace.",
      sessionExpired: "Your session expired. Please sign in again.",
      accountUnavailable: "Your account is currently unavailable. Contact your administrator.",
      password: "Password",
      submit: "Sign In",
      submitting: "Signing in…",
      forgotPassword: "Forgot password?",
    },

    forgot: {
      metaTitle: "Reset password",
      title: "Reset your password",
      description: "Enter your email and we'll send you a reset link.",
      submit: "Send reset link",
      sentTitle: "Check your email",
      sentDescription: "If an account exists for that address, a reset link is on its way.",
      noMailProvider:
        "No mail provider is configured in V0.1 — the link is written to the server log instead of being sent.",
    },

    reset: {
      metaTitle: "Set a new password",
      title: "Set a new password",
      description: "Choose a password you don't use anywhere else.",
      expired: "That link has expired.",
      invalid: "That link is not valid.",
      linkRules: "Reset links can only be used once, and expire after an hour.",
      requestNewLink: "Request a new link",
      newPassword: "New password",
      passwordHint: "At least 10 characters.",
      confirmPassword: "Confirm password",
      submit: "Reset password",
      submitting: "Updating…",
      doneTitle: "Password updated successfully.",
      doneDescription: "Any other sessions have been signed out.",
      signIn: "Sign in",
    },

    errors: {
      emailRequired: "Email is required",
      emailInvalid: "Enter a valid email address",
      passwordRequired: "Password is required",
      incorrectCredentials: "Incorrect email or password.",
      passwordTooShort: "Use at least 10 characters",
      passwordTooLong: "That password is too long",
      confirmRequired: "Confirm your new password",
      passwordsMismatch: "Both passwords must match",
      reviewForm: "Please review the form and try again.",
      linkExpired: "That reset link has expired. Request a new one.",
      linkInvalid: "That reset link is no longer valid. Request a new one.",
    },
  },

  system: {
    returnToDashboard: "Return to Dashboard",
    notFound: {
      title: "Page not found.",
      description: "The page you're looking for doesn't exist.",
      home: "Go to home page",
    },
    accessDenied: {
      metaTitle: "Access denied",
      title: "You don't have access to this area.",
      description: "If you need access, contact your company administrator.",
    },
    moduleUnavailable: {
      title: "Module unavailable",
      description: "This module is not enabled for your company.",
    },
  },
};

export type Messages = typeof en;
