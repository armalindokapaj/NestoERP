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
    unreadCount_one: "{count} unread notification",
    unreadCount_other: "{count} unread notifications",
    unread: "Unread",
    markAllRead: "Mark all read",
    markRead: "Mark as read",
    loadMore: "Load more",
    loadingNotifications: "Loading notifications…",
    notificationsError: "Notifications could not be loaded.",
    tryAgain: "Try again",
    viewAllNotifications: "View all notifications",
    critical: "Critical",
    high: "High priority",
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

  notificationCenter: {
    title: "Notifications",
    description: "Everything NESTO has told you, and what still needs your attention.",
    tabs: { all: "All", unread: "Unread", attention: "Needs attention" },
    markAllRead: "Mark all read",
    markRead: "Mark as read",
    markUnread: "Mark as unread",
    loadMore: "Load more",
    loading: "Loading…",
    empty: "You have no notifications.",
    emptyUnread: "You are all caught up.",
    error: "Notifications could not be loaded.",
    retry: "Try again",
    settings: "Notification settings",
    critical: "Critical",
    high: "High priority",
    unread: "Unread",
    attentionEmpty: "Nothing needs your attention right now.",
    attentionHint: "These stay until the underlying condition is resolved.",
    since: "Since {date}",
    dismiss: "Dismiss",
    dismissed: "Dismissed.",
    dismissFailed: "This item could not be dismissed.",
    unavailableTitle: "This is no longer available",
    unavailableBody: "The record this notification pointed to was removed, or you no longer have access to it.",
    back: "Back to notifications",
  },

  search: {
    favorites: "Favorites",
    recent: "Recent",
    placeholder: "Search projects, tasks, people or documents…",
    dialogTitle: "Search NESTO",
    hint: "Type at least two characters to search records you can open.",
    searching: "Searching…",
    noResults: "Nothing you can open matches “{query}”.",
    error: "Search is unavailable right now. Try again in a moment.",
    partial: "Some areas could not be searched just now.",
    keys: "↑ ↓ to move · Enter to open · Esc to close",
    resultsLabel: "Search results",
  },

  modules: {
    dashboard: { label: "Dashboard", description: "Your role overview across the company." },
    calendar: { label: "Calendar", description: "Deadlines, events and schedules across the company." },
    approvals: { label: "Approvals", description: "Every decision waiting on you, from every module, in one place." },
    announcements: { label: "Announcements", description: "Company, department and project notices, with acknowledgment where it matters." },
    projects: { label: "Projects", description: "Manage company projects and project activity." },
    tasks: { label: "Tasks", description: "Work assigned across projects and departments." },
    meetings: { label: "Meetings", description: "Agendas, minutes, decisions and the actions that follow." },
    timesheets: { label: "Timesheets", description: "How working time is spent across projects, tasks and internal work." },
    dailyLogs: { label: "Daily Logs", description: "What happened on site each day: people, work, deliveries, delays and evidence." },
    contractors: { label: "Contractors", description: "The organisations building with you: assignments, work packages, compliance and contracts." },
    engineering: { label: "Engineering", description: "Drawings, revisions, RFIs, submittals and transmittals — the technical record of every project." },
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
    organization: { label: "Organization", description: "Your parent group, its companies, departments and people." },
    company: { label: "Company", description: "Company identity and organisation details." },
    settings: { label: "Settings", description: "Your profile and company configuration." },
    support: { label: "Support", description: "Internal support requests and platform help." },
  } satisfies Record<ModuleKey, Described>,

  roles: {
    OWNER: { label: "Group Owner", description: "Owns and governs the parent group and every company in it." },
    PLATFORM_ADMIN: { label: "Platform Admin", description: "Creates and implements parent groups on the NESTO platform, outside any company." },
    GROUP_IT: {
      label: "Group IT",
      description:
        "Technical administrator for the parent group. Provisions users, configures companies and modules, and supports NESTO according to approved business and HR requirements.",
    },
    HR: { label: "HR", description: "Owns people operations, recruitment and the employment record." },
    CEO: { label: "CEO / Director", description: "Company performance, approvals, project setup and strategic oversight." },
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
    VIEWER: { label: "Viewer", description: "Read-only access to the company and projects they are assigned to." },
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
      GROUP: "Group-wide",
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
      sales: { label: "Sales", description: "How long a unit reservation lasts, and other defaults for selling units." },
      storage: {
        label: "File storage",
        description: "How much file storage your company is using, and its limits.",
      },
      audit: {
        label: "Audit",
        description: "Immutable evidence of important business and security actions.",
      },
      appearance: { label: "Appearance", description: "Theme and display preferences." },
      notifications: { label: "Notifications", description: "What NESTO tells you about, in the app and by email." },
    } satisfies Record<SettingsSlug, Described>,

    notifications: {
      category: "Category",
      inApp: "In the app",
      email: "Email",
      intro: "Choose what reaches you. Changes apply to notifications from now on.",
      locked: "Critical safety alerts always reach you in the app.",
      noEmail: "Not sent by email",
      saved: "Preference saved.",
      failed: "That change could not be saved. Try again.",
      categories: {
        tasks: { label: "Tasks", description: "Assignments, status changes, blocked and overdue work." },
        mentions: { label: "Mentions", description: "When someone mentions you in a comment." },
        comments: { label: "Comments", description: "Replies and new comments on records you follow." },
        approvals: { label: "Approvals", description: "Requests waiting for you and decisions on your requests." },
        documents: { label: "Documents", description: "Review requests, approvals and superseded versions." },
        qa_qc: { label: "QA/QC", description: "Inspections due and quality actions assigned to you." },
        hse: { label: "HSE", description: "Critical risks and safety actions assigned to you." },
        hr: { label: "HR", description: "Decisions on your leave requests." },
        contracts: { label: "Legal", description: "Contract obligations coming due, and unit contracts requested, signed or cancelled." },
        procurement: { label: "Procurement", description: "Purchase orders to approve and goods received." },
        calendar: { label: "Calendar", description: "Reminders, invitations and changes to events you are on." },
        meetings: { label: "Meetings", description: "Invitations, changes, reminders, minutes and actions from meetings." },
        timesheets: { label: "Timesheets", description: "Weeks to submit, and weeks approved, returned or waiting for your review." },
        daily_logs: { label: "Daily logs", description: "Logs to review, logs returned to you, locks, corrections and missing logs." },
        project_planning: { label: "Project planning", description: "Milestones you own, due dates, overdue milestones, blockers and baseline changes." },
        announcements: { label: "Announcements", description: "Announcements addressed to you, critical notices and acknowledgment reminders." },
        contractors: { label: "Contractors", description: "Contractors assigned to your projects, status changes and compliance expiring or expired." },
        engineering: { label: "Engineering", description: "RFIs and submittals assigned to you, reviews due and overdue, decisions and issued transmittals." },
        sales: { label: "Sales", description: "Unit reservations about to expire, expired or released, and units marked Sold." },
        finance: { label: "Finance", description: "Unit installments coming due or overdue, payments received and sales paid in full." },
      },
    },

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
      phone: "Phone",
      username: "Username",
      usernameHint: "This is what you sign in with. Your administrator can change it.",
      managedHint: "Position and department are set by your company administrators.",
      save: "Save changes",
      saving: "Saving…",
      saved: "Profile updated.",
      password: {
        title: "Password",
        description: "Changing your password signs you out of every other session.",
        current: "Current password",
        new: "New password",
        newHint: "At least 10 characters.",
        confirm: "Confirm new password",
        submit: "Change password",
        submitting: "Changing…",
        changed_one: "Password changed. {count} other session was signed out.",
        changed_other: "Password changed. {count} other sessions were signed out.",
      },
      sessions: {
        title: "Active sessions",
        description: "Everywhere you are signed in to NESTO right now.",
        current: "This session",
        started: "Signed in {date}",
        expires: "Expires {date}",
        unknownAddress: "Unknown address",
        platform: "NESTO platform",
        signOut: "Sign out",
        signOutOthers: "Sign out other sessions",
        signOutEverywhere: "Sign out everywhere",
        cancel: "Cancel",
        confirmEverywhereTitle: "Sign out everywhere?",
        confirmEverywhereDescription: "Every session ends, including this one. You will need to sign in again.",
        othersDone_one: "{count} other session was signed out.",
        othersDone_other: "{count} other sessions were signed out.",
        none: "You are not signed in anywhere else.",
      },
      errors: {
        VALIDATION: "Please review the highlighted fields.",
        SAVE_FAILED: "That change could not be saved. Please try again.",
        RATE_LIMITED: "Too many attempts. Wait a few minutes and try again.",
        NOT_FOUND: "That session has already ended.",
        FIRST_NAME_REQUIRED: "First name is required",
        FIRST_NAME_TOO_LONG: "First name is too long",
        LAST_NAME_REQUIRED: "Last name is required",
        LAST_NAME_TOO_LONG: "Last name is too long",
        PHONE_TOO_LONG: "Phone number is too long",
        CURRENT_PASSWORD_REQUIRED: "Enter your current password",
        CURRENT_PASSWORD_INCORRECT: "Your current password is not correct",
        PASSWORD_TOO_SHORT: "Use at least 10 characters",
        PASSWORD_TOO_LONG: "That password is too long",
        CONFIRM_REQUIRED: "Confirm your new password",
        PASSWORDS_MISMATCH: "Both passwords must match",
        PASSWORD_UNCHANGED: "Choose a password different from your current one",
      },
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

    sales: {
      description: "Company defaults for selling project units: how long a reservation lasts, and what a unit needs before it is marked Sold.",
      reservationSection: "Reservations",
      reservationSectionDescription: "How long a reservation holds a unit when the salesperson does not choose another date.",
      reservationDays: "Reservation length (days)",
      reservationDaysHint: "From 1 to 90 days. Reservations already made keep their expiry date.",
      reservationDaysInvalid: "Enter whole days from 1 to 90.",
      soldRuleSection: "Sold rule",
      soldRuleSectionDescription: "What a reserved unit needs before Sales can mark it Sold. Meeting it unlocks Mark Sold; a person still makes the sale. It applies from the next sale.",
      soldRuleUnavailable: "Needs a module that is switched off for your company: no unit can be marked Sold under this rule.",
      soldRules: {
        RESERVATION: { label: "Reservation", description: "An active reservation with a client, a deal and an agreed price." },
        SIGNED_CONTRACT: { label: "Signed contract", description: "The unit's contract is signed. Recommended for construction sales." },
        DEPOSIT_RECEIVED: { label: "Deposit received", description: "The deposit in the unit's payment schedule is paid in full." },
        SIGNED_CONTRACT_AND_DEPOSIT: { label: "Signed contract and deposit", description: "Both: a signed contract and the deposit paid in full." },
        MANUAL_APPROVAL: { label: "Manual approval", description: "Someone allowed to approve sales approves it in the Approvals Center first." },
      },
      submit: "Save sales settings",
      updated: "Sales settings updated.",
      readOnly: "You can see these settings but not change them.",
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
    username: "Username",
    usernamePlaceholder: "your.username",

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
      metaTitle: "Forgotten password",
      title: "Forgotten your password?",
      description:
        "Contact your NESTO administrator to reset it. They can set a temporary password for you, which you will be asked to change when you next sign in.",
      backToSignIn: "Back to sign in",
    },

    errors: {
      usernameRequired: "Enter your username",
      currentPasswordRequired: "Enter your current password",
      passwordRequired: "Password is required",
      incorrectCredentials: "Incorrect username or password.",
      passwordTooShort: "Use at least 10 characters",
      passwordTooLong: "That password is too long",
      confirmRequired: "Confirm your new password",
      passwordsMismatch: "Both passwords must match",
      reviewForm: "Please review the form and try again.",
      tooManySignIns: "Too many sign-in attempts. Wait a few minutes and try again.",
      tooManyAttempts: "Too many attempts. Wait a few minutes and try again.",
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
