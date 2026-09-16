/**
 * The domain ownership registry (PRD #48 §8, §9, §300).
 *
 * One row of the database has one domain responsible for what goes into it:
 * its validation, its invariants, its state transitions, its audit semantics.
 * Everybody else asks that domain. This file is where "everybody else" is
 * decided, and `verify-ownership.ts` is what makes it true of the code rather
 * than true of a document (PRD #48 §185, §186).
 *
 * A domain here is a directory, because that is what a file can be checked
 * against. `lib/modules/finance/**` is `finance`; `lib/core/notifications/**`
 * is `core/notifications`. Nothing in `app/` may write at all: a route or an
 * action calls a service (PRD #48 §108, §109).
 */

/** The domain a source file belongs to, from where it lives. */
export function domainOfFile(file: string): string {
  const parts = file.split("/");
  if (parts[0] === "lib" && parts[1] === "modules") return parts[2] ?? "lib";
  if (parts[0] === "lib" && parts[1] === "core") return `core/${parts[2] ?? ""}`;
  if (parts[0] === "lib") return parts[1] ?? "lib";
  if (parts[0] === "app") return "app";
  if (parts[0] === "scripts") return "scripts";
  return parts[0] ?? "";
}

/**
 * Model → owning domain, by Prisma's delegate name.
 *
 * Grouped by owner, because the useful question is "what does Finance own?"
 * rather than "who owns invoices?" — and because a domain's list read whole is
 * how a missing model gets noticed.
 */
const OWNED: Record<string, string[]> = {
  /* Identity and access ---------------------------------------------------- */
  auth: ["user", "session", "passwordResetToken", "authEvent"],
  "core/access": ["role", "permission", "rolePermission", "module", "roleModuleAccess"],
  team: ["companyMember", "department", "companyInvite"],
  settings: ["company", "companySettings", "companyIntegrationSettings", "companyNumberingScheme", "companyModule"],

  /* Shared foundation ------------------------------------------------------ */
  shared: ["activity"],
  "core/audit": ["auditEvent"],
  "core/notifications": ["notification", "notificationPreference", "notificationEventOutbox", "attentionItem"],
  "core/integrations": ["integrationLink", "integrationAttempt"],
  "core/collaboration": ["collaborationThread", "comment", "mention", "subscription"],
  "core/approvals": ["approvalStep"],
  approvals: ["approvalDelegation", "approvalDecisionReceipt"],
  "core/security": ["rateLimitBucket"],
  "core/jobs": ["workerHeartbeat", "workerProcess", "jobFailure", "jobIdempotencyKey"],
  mail: ["mailDelivery"],

  /* Business domains ------------------------------------------------------- */
  projects: ["project", "projectMember", "projectType"],
  clients: ["client", "contact"],
  tasks: ["task"],
  documents: [
    "document",
    "documentVersion",
    "documentReview",
    "documentUploadSession",
    "companyStorageQuota",
    "companyStorageUsage",
  ],
  finance: [
    "invoice",
    "invoiceLineItem",
    "expense",
    "payment",
    "projectBudget",
    "projectBudgetLineItem",
    "commitment",
    "financeApproval",
    "financeSettings",
  ],
  hr: ["employeeProfile", "compensation", "leaveRequest", "leaveBalance", "attendanceRecord"],
  sales: ["lead", "opportunity", "proposal", "proposalLineItem", "salesApproval"],
  contracts: ["contract", "contractParty", "contractObligation", "contractAmendment", "contractApproval"],
  procurement: [
    "supplier",
    "purchaseRequest",
    "purchaseRequestItem",
    "rFQ",
    "rFQSupplier",
    "rFQItem",
    "supplierQuote",
    "supplierQuoteItem",
    "purchaseOrder",
    "purchaseOrderItem",
    "goodsReceipt",
    "goodsReceiptItem",
    "procurementApproval",
    "procurementApprovalPolicy",
  ],
  inventory: [
    "inventoryItem",
    "warehouse",
    "inventoryLocation",
    "inventoryBalance",
    "stockMovement",
    "inventoryReceipt",
    "inventoryReceiptLine",
    "stockIssue",
    "stockIssueLine",
    "stockReturn",
    "stockReturnLine",
    "stockTransfer",
    "stockTransferLine",
    "stockAdjustment",
    "stockAdjustmentLine",
    "stockReservation",
  ],
  qaqc: [
    "qualityRecord",
    "inspectionRequest",
    "inspectionTemplate",
    "inspectionTemplateItem",
    "qualityInspection",
    "inspectionChecklistItem",
    "materialInspectionDecision",
    "qualityMaterialRelease",
    "qualityDefect",
    "nonConformanceReport",
    "correctiveAction",
    "qualityApproval",
  ],
  hse: [
    "hseRecord",
    "hseInspectionTemplate",
    "hseInspectionTemplateItem",
    "hseInspection",
    "hseInspectionChecklistItem",
    "hseHazard",
    "hseIncident",
    "hseRiskAssessment",
    "hseRiskAssessmentItem",
    "hseAction",
    "toolboxTalk",
    "toolboxTalkParticipant",
    "hseWorkPermit",
    "ppeCheck",
    "environmentalObservation",
    "stopWorkRecord",
    "hseApproval",
  ],
  calendar: ["calendarEvent", "calendarEventParticipant", "calendarReminder", "calendarReminderDelivery"],
  meetings: [
    "meetingSeries",
    "meeting",
    "meetingParticipant",
    "meetingAgendaItem",
    "meetingMinutesSection",
    "meetingDecision",
    "meetingActionItem",
  ],
  timesheets: ["timesheet", "workLog", "timesheetApproval", "timesheetSettings", "timesheetApproverAssignment"],
  "daily-logs": [
    "dailyLog",
    "dailyLogWeatherEntry",
    "dailyLogWorkforceEntry",
    "dailyLogWorkActivity",
    "dailyLogEquipmentEntry",
    "dailyLogDeliveryEntry",
    "dailyLogVisitorEntry",
    "dailyLogDelayEntry",
    "dailyLogInstructionEntry",
    "dailyLogTaskLink",
    "dailyLogDocumentLink",
    "dailyLogCorrection",
    "dailyLogSettings",
    "projectDailyLogSettings",
  ],
  "project-planning": [
    "projectPhase",
    "projectMilestone",
    "projectMilestoneDependency",
    "projectMilestoneBlocker",
    "projectMilestoneTaskLink",
    "projectPlanningSettings",
  ],
  announcements: [
    "announcement",
    "announcementAudienceMember",
    "announcementRead",
    "announcementAcknowledgment",
    "announcementTarget",
  ],
  productivity: ["userFavorite", "recentItem", "productivitySettings"],
  contractors: ["contractorProfile", "contractorContact", "projectContractorAssignment", "contractorComplianceItem"],
  "work-packages": ["workPackage"],
  engineering: [
    "engineeringDocument",
    "engineeringDocumentRevision",
    "rfi",
    "rfiResponse",
    "rfiReference",
    "technicalSubmittal",
    "technicalSubmittalRevision",
    "documentTransmittal",
    "documentTransmittalItem",
    "engineeringSettings",
  ],
  company: ["supportRequest"],
};

export const MODEL_OWNER: Record<string, string> = Object.fromEntries(
  Object.entries(OWNED).flatMap(([domain, models]) => models.map((model) => [model, domain])),
);

/**
 * A write by somebody other than the owner, reviewed and allowed to stand.
 *
 * Every entry is a decision, not a backlog item: it says why the owner's door
 * is the wrong shape for this caller, and what stops the exception growing
 * into a second owner. `fields` is the usual answer — a domain that owns some
 * columns of a shared row and none of the others (PRD #48 §105, §267).
 */
export type OwnershipException = {
  /** A model's delegate name, or `*` for a file allowed to write across domains. */
  model: string;
  reason: string;
  /** When present, the write may name only these columns. */
  fields?: string[];
} & ({ domain: string; file?: never } | { file: string; domain?: never });

export const OWNERSHIP_EXCEPTIONS: OwnershipException[] = [
  /* Provisioning: the first rows of a company, before any module is in use --- */
  {
    model: "*",
    file: "lib/modules/company/company-bootstrap.service.ts",
    reason:
      "Creating a company writes the opening row of several domains at once — its settings, its modules, its numbering, its first invitation — and none of those domains exist to be asked yet. One reviewed transaction, run once per company, never again (PRD #48 §263, §267).",
  },
  {
    model: "*",
    file: "lib/config/company-config.service.ts",
    reason:
      "The same provisioning, for a company being reconfigured from the deployment's own defaults rather than by a person (PRD #48 §266).",
  },

  /* Retention: the policy sweeper ------------------------------------------ */
  {
    model: "*",
    file: "lib/core/retention/retention.service.ts",
    reason:
      "Retention deletes across every domain by design: it is the one place that knows how long each class of record is kept, and it only ever deletes what its policy names (PRD #33). A domain cannot own its own expiry without every domain reimplementing the schedule.",
  },

  /* Co-owned columns on a shared row --------------------------------------- */
  {
    model: "project",
    domain: "project-planning",
    fields: ["planningTemplateKey", "planningBaselineLocked"],
    reason:
      "Planning is part of the Projects module (PRD #44 §9) and its two settings live on the project row rather than in a table of their own. Projects owns everything else about the row; these two columns mean nothing outside Planning.",
  },
  {
    model: "user",
    domain: "account",
    fields: ["firstName", "lastName", "phone"],
    reason:
      "A person's own name and phone number are theirs to change. Auth owns the credential and the account's status; the profile columns are the account page's, and it may not touch anything else on the row.",
  },
  {
    model: "companyNumberingScheme",
    domain: "core/numbering",
    fields: ["nextSequence", "currentYear"],
    reason:
      "Settings owns the scheme — its prefix, padding and mode. The sequence counter is not configuration: it is allocated under a row lock while a record is being numbered, and only the allocator may move it (PRD #48 §137-§139).",
  },
  {
    model: "companyModule",
    domain: "core/access",
    reason:
      "Settings owns which modules a company has switched on. Access sync seeds the rows for a module newly added to the deployment, so a company that predates it has a row to toggle — provisioning, like the bootstrap above, and it never changes `enabled` on a row that exists (PRD #48 §264).",
  },
];

/**
 * Files that exist to know about every domain (PRD #48 §273).
 *
 * A registry is how this codebase inverts a dependency without a container:
 * one file lists the record types, the scheduled jobs, the attention
 * conditions, the calendar providers, the approval providers, the search
 * providers. The platform does not depend on Finance because it wants to — it
 * depends on the list, and the list happens to name Finance.
 *
 * Their imports are cut from the dependency graph, because counting them turns
 * every domain into everyone's neighbour and the graph stops saying anything.
 * What remains after the cut is the thing worth watching: two domains that
 * reach for each other directly.
 */
export const AGGREGATION_POINTS: Array<{ file: string; reason: string }> = [
  { file: "lib/core/records/record.registry.ts", reason: "Every record type a person can open, in one list (PRD #47 §76)." },
  { file: "lib/core/jobs/job.handlers.ts", reason: "Every scheduled job, bound to its handler (PRD #38 §92)." },
  { file: "lib/core/notifications/attention.conditions.ts", reason: "Every attention condition and what makes it true (PRD #38 §83)." },
  { file: "lib/core/search/search.providers.ts", reason: "Every searchable record type (PRD #26 §31)." },
  { file: "lib/modules/calendar/calendar.providers.ts", reason: "Every source of dated things the calendar shows (PRD #39 §22)." },
  { file: "lib/modules/approvals/approvals.registry.ts", reason: "Every approval source the centre routes (PRD #41 §17)." },
  { file: "lib/modules/productivity/navigable.registry.ts", reason: "Every record type that can be starred (PRD #45 §81)." },
  { file: "lib/modules/dashboard/dashboard.service.ts", reason: "Every KPI on the dashboard, read-only across domains (PRD #48 §102)." },
  { file: "lib/core/state/registry.ts", reason: "Every declared state machine, so the gate and the docs can read them (PRD #49 §154)." },
];

/**
 * Cross-domain cascade deletes that are allowed to stand (PRD #48 §130, §131).
 *
 * A cascade from one domain's table to another's is how history gets destroyed
 * by a delete nobody thought about. Two shapes are fine and the rest must be
 * argued for:
 *
 *   - **`… → Company`.** Deleting a company deletes the company's data. That
 *     is what tenancy means, it is not a runtime operation, and RESTRICT would
 *     only mean a deletion that stops halfway.
 *   - **Configuration, not history.** A settings row for a thing that no
 *     longer exists is noise; a record of something that happened is not.
 */
export const CASCADE_EXCEPTIONS: Array<{ from: string; to: string; reason: string }> = [
  {
    from: "CompanyModule.module",
    to: "Module",
    reason: "A module removed from the deployment takes its per-company on/off rows with it. Configuration, and the module no longer exists to configure.",
  },
  {
    from: "ProjectDailyLogSettings.project",
    to: "Project",
    reason: "Per-project daily-log settings for a project that is gone. The logs themselves restrict, which is the row that matters.",
  },
  {
    from: "Session.membership",
    to: "CompanyMember",
    reason: "A membership that no longer exists must not leave a session that still carries its access. This is the cascade doing the right thing, and the only reason it never fires is that a membership is deactivated rather than deleted (PRD #14 §242).",
  },
  {
    from: "DocumentUploadSession.member",
    to: "CompanyMember",
    reason: "An upload that was in flight. Ephemeral technical data, explicitly hard-deletable, and the finished document restricts instead (PRD #48 §129).",
  },
  {
    from: "TimesheetApproverAssignment.member",
    to: "CompanyMember",
    reason: "Routing for a person who is gone. The subject cascades; the approver on the same row restricts, so somebody who decides for others cannot be removed out from under them.",
  },
];
