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
  auth: ["user", "session", "deviceRegistration", "passwordResetToken", "recoveryEmailChallenge", "authEvent"],
  "core/access": ["role", "permission", "rolePermission", "module", "roleModuleAccess"],
  team: ["companyMember", "department", "companyInvite"],
  // A company and who owns it (D-01 §6): its settings, not a governance module.
  settings: ["company", "companyOwner", "companySettings", "companyIntegrationSettings", "companyNumberingScheme", "companyModule"],
  // The group above the companies, positions in its departments, delegated
  // access, and the account requests between HR and Group IT (E-06 §8-§18, §27).
  organization: [
    "parentGroup",
    "parentGroupMember",
    "parentGroupMemberCompany",
    "groupDepartment",
    "departmentAssignment",
    "accessGrant",
    "userProvisioningRequest",
  ],
  // Access held outside every group (E-06 §19), and where a demonstration
  // tenant's seeded facts come from (D-01 §3).
  platform: [
    "platformAccess",
    "demoRecord",
    "featureFlag",
    "featureFlagOverride",
    "platformSetting",
    "supportAccessSession",
    "threeDProjectConfiguration",
    "threeDModelVersion",
  ],
  // The public pricing configurator and its Platform Admin control plane (6be35d76).
  pricing: ["pricingVersion", "pricingPromotion", "pricingQuote", "pricingLead", "pricingAuditLog"],
  "project-3d": [
    "project3DEntitlement",
    "project3DConfig",
    "project3DModelSlot",
    "project3DModelVersion",
    "project3DUnitMeshBinding",
    "project3DRelease",
    "platform3DEnvironmentPreset",
    "project3DMutationRequest",
  ],

  /* Shared foundation ------------------------------------------------------ */
  shared: ["activity"],
  "core/audit": ["auditEvent"],
  "core/notifications": ["notification", "notificationPreference", "notificationEventOutbox", "attentionItem", "pushDelivery", "notificationQuietHours", "notificationProjectPreference"],
  "core/integrations": ["integrationLink", "integrationAttempt"],
  "core/collaboration": ["collaborationThread", "comment", "mention", "subscription"],
  "core/approvals": ["approvalStep"],
  approvals: ["approvalDelegation", "approvalDecisionReceipt"],
  "core/security": ["rateLimitBucket", "mobileSecurityPolicy"],
  "core/jobs": ["workerHeartbeat", "workerProcess", "jobFailure", "jobIdempotencyKey"],
  // What the server already did for a device-generated operation id (MOB-09 §82).
  "core/sync": ["syncOperation"],
  mail: ["mailDelivery"],

  /* Business domains ------------------------------------------------------- */
  projects: ["project", "projectMember", "projectType"],
  "project-media": ["projectMedia"],
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
    // Collecting a unit's sale: what money settles, and the schedule it is owed on (E-05F §18-§31).
    "paymentAllocation",
    "paymentSchedule",
    "paymentInstallment",
  ],
  // HR owns the person and the candidate as well as the employment (E-06 §82).
  // …and the employment's history: where the employee sat, their status over time, and changes scheduled (E-03, ADR 0004).
  // …and what HR files on an employment and a person's qualifications (E-02): the files themselves stay
  // the documents domain's, reached only through its services (§200, ADR 0007).
  hr: ["employeeProfile", "compensation", "leaveRequest", "leaveBalance", "attendanceRecord", "personProfile", "candidateProfile", "employmentAssignment", "employmentStatusHistory", "employmentChange", "employeeDocumentLink", "personQualification"],
  // Where employees work and with whom: trades, crews and project assignments (E-04 §28-§42). The
  // employment stays HR's; ending one closes these through the door HR is handed (ADR 0006).
  // …and a bulk import's batch: it places people on projects and in crews as it goes, and each
  // employment itself is made through HR's door (E-04 §93-§98).
  workforce: ["workforceTrade", "workforceCrew", "workforceCrewMember", "employeeProjectAssignment", "employeeImportBatch"],
  // A unit's commercial side — profile, prices, reservations, the units in a deal, the status trail
  // (E-05E) — keyed by the canonical unitId; the unit itself stays project-structure's.
  sales: ["lead", "opportunity", "proposal", "proposalLineItem", "salesApproval", "unitCommercialProfile", "unitPriceHistory", "unitReservation", "unitReservationExtension", "opportunityUnit", "unitCommercialStatusHistory", "unitSaleApproval"],
  // A unit sold under a contract, and Sales' request for one (E-05F §88, §12).
  contracts: ["contract", "contractParty", "contractObligation", "contractAmendment", "contractApproval", "contractUnit", "unitContractRequest"],
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
    // The people an incident involves, the workers a permit covers, and site inductions (E-04 §70-§74).
    "hseIncidentPerson",
    "hseWorkPermitWorker",
    "hseInduction",
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
  // Buildings, floors, units and the company's unit types (E-05B §60); a unit's
  // published versions, media and document references, and its publishing
  // requests (E-05D). The Documents they point at stay the Documents domain's.
  // …and the project's sites, where its work happens on the ground (E-04 §38).
  "project-structure": ["projectSite", "projectBuilding", "projectFloor", "projectUnit", "projectUnitType", "unitPublication", "unitMedia", "unitDocumentLink", "unitPublicationApproval"],
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
  // What each company may use: plans, company entitlements, per-module exceptions (Admin Modules PRD #4).
  entitlements: ["entitlementPlan", "companyEntitlement", "companyModuleEntitlement"],
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
  {
    model: "company",
    file: "lib/modules/entitlements/entitlement.service.ts",
    fields: ["configVersion"],
    reason:
      "Admin Modules PRD #4 §82: an entitlement change makes every cached reading of the company's modules stale. The file only increments configVersion — the same cache key module toggles bump through settings — inside the entitlement transaction; it never writes any other company column.",
  },
  {
    model: "companyStorageQuota",
    file: "lib/modules/entitlements/entitlement.service.ts",
    fields: ["maxStorageBytes"],
    reason:
      "Admin Modules PRD #4 §47, §48: the storage limit a plan or the Platform Admin sets is the quota Documents already enforces, so there is one number rather than two that can disagree. The file writes only maxStorageBytes of an existing row, audited as PLATFORM_ENTITLEMENT_LIMITS_CHANGED; the per-file limit and usage stay Documents'.",
  },
  {
    model: "projectBuilding",
    file: "lib/modules/project-3d/project-3d.structure.ts",
    reason:
      "Platform Admin authors a Project's canonical structure while provisioning its 3D Experience (feat(3d): manage canonical project structure). Platform Admin acts without a company membership, so Project Structure's company-scoped service has no context to run in; this file writes only projectBuilding rows of the one Project being provisioned, in one transaction with a platform audit entry; codes stay unique through Project Structure's own database constraints, whose violation this file answers as STRUCTURE_COLLISION.",
  },
  {
    model: "projectFloor",
    file: "lib/modules/project-3d/project-3d.structure.ts",
    reason:
      "Platform Admin authors a Project's canonical structure while provisioning its 3D Experience (feat(3d): manage canonical project structure). Platform Admin acts without a company membership, so Project Structure's company-scoped service has no context to run in; this file writes only projectFloor rows of the one Project being provisioned, in one transaction with a platform audit entry; codes stay unique through Project Structure's own database constraints, whose violation this file answers as STRUCTURE_COLLISION.",
  },
  {
    model: "projectUnit",
    file: "lib/modules/project-3d/project-3d.structure.ts",
    reason:
      "Platform Admin authors a Project's canonical structure while provisioning its 3D Experience (feat(3d): manage canonical project structure). Platform Admin acts without a company membership, so Project Structure's company-scoped service has no context to run in; this file writes only projectUnit rows of the one Project being provisioned, in one transaction with a platform audit entry; codes stay unique through Project Structure's own database constraints, whose violation this file answers as STRUCTURE_COLLISION.",
  },
  /* Provisioning: the first rows of a company, before any module is in use --- */
  {
    model: "*",
    file: "lib/modules/company/company-bootstrap.service.ts",
    reason:
      "Creating a company writes the opening row of several domains at once — its settings, its modules, its numbering, its first invitation — and none of those domains exist to be asked yet. One reviewed transaction, run once per company, never again (PRD #48 §263, §267).",
  },
  {
    model: "*",
    file: "lib/modules/platform/platform-implementation.service.ts",
    reason:
      "Implementing a parent group writes the opening rows of a group before any of its people can: the group and its departments, a company's first memberships for the group's Owner and IT, and the approved initial roster — person, login, memberships, positions and first project assignments — in one transaction per person. Refused once the group is active, after which each row has its owner's door (E-06 §20, §30, §138; PRD #48 §263).",
  },
  {
    model: "*",
    file: "lib/modules/platform/platform-organization-admin.service.ts",
    reason:
      "Adding a user from inside an organization writes the person, the login, the company membership, its department place and its project places in one transaction, so a failure leaves nothing half-made; changing a role, the projects or removing access writes that one company's membership and project places only, named by company and checked against it (Organization-Scoped PRD #7 §16, §20, §63, §92, §93).",
  },
  {
    model: "*",
    file: "lib/modules/platform/platform-user-delete.service.ts",
    reason:
      "Deleting an account made by mistake removes the account together with the memberships, project places, department placements and sessions only it has, in one transaction that the database rolls back whole if any record still names the account. A Platform Admin decision, permission-checked and audited, refused for any account that has signed in (Admin PRD #8 §42, §46).",
  },
  {
    model: "*",
    file: "lib/modules/platform/platform-group-users.service.ts",
    reason:
      "Adding, replacing or removing a Parent Group's own people (Group CEO, Group IT) writes the person, the login, the group seat, the group role in each of the group's companies with its department place, and the ending of project places, in one transaction, so a failure leaves nothing half-made and a CEO replacement never shows two CEOs. Every write names the group and is checked against it; it is a Platform Admin decision, permission-checked and audited, made without a company membership of its own (Admin PRD #8 §15, §63-§66, §72, §73).",
  },
  {
    model: "*",
    file: "lib/modules/platform/group-user-detail.service.ts",
    reason:
      "Suspending or reactivating a person's seat in a Parent Group moves the seat's status under a lock on the group, and ending their own membership in one of the group's companies ends that membership and its project places — each in one transaction with its audit event, so the seat, the company access it carries and the record of the change never disagree. Every row it writes is read under the named group and person inside that transaction and written from the state it was read in, and each request is checked against the actor's capability over the group; a Group CEO's seat needs the CEO capability as well. It acts on a Platform Admin's or a group seat's authority, not through a company membership, so no tenant-scoped service has a context to run it in (Admin PRD #11 §27, §29, §42-§44, §48, §49).",
  },
  {
    model: "*",
    file: "lib/modules/platform/company-leadership.service.ts",
    reason:
      "Naming, replacing or removing a company's CEO writes the person and login of a new CEO, the company membership with its CEO role and department place, the outgoing CEO's membership and project places, and the company's CEO pointer in one transaction, under a row lock on the company, so a failure leaves nothing half-made and two administrators can never leave two CEOs. Every write names the company and is checked against the actor's authority over it, and is audited (Admin PRD #12 §41, §88-§91).",
  },
  {
    model: "*",
    file: "lib/modules/platform/company-users.service.ts",
    reason:
      "Managing a company's people from inside the company writes one person's direct relationship with it — the person and login of a new user, the company membership with its role, department place and project places, its suspension and its removal — each in one transaction with its audit event, so a failure leaves nothing half-made. Every row it writes belongs to the named company (a new person, to that company's organization), each request is checked against the actor's capability over the company's group, and a change to an existing membership names the state it moves from. The group seat is never written here, and removing someone from a company never deletes their account. It acts on a Platform Admin's or a group seat's authority, not through a company membership, so no tenant-scoped service has a context to run it in (Admin PRD #13 §18-§36, §48-§54, §61-§70, §82-§85).",
  },
  {
    model: "*",
    file: "lib/modules/platform/group-company-access.service.ts",
    reason:
      "A seat's company access policy (PRD #10) is carried out as the company memberships it owns, flagged groupDerived: created, role-updated and ended in one transaction with the policy change, and with the company's own lifecycle. Direct memberships are never written here.",
  },
  {
    model: "departmentAssignment",
    file: "lib/modules/platform/group-placement.ts",
    reason:
      "A member's own place in the branch they are placed in (E-13 §24-§29, ADR 0003): moved out of the implementation service so the group-access service and the implementation service can share it without importing each other. The one row it writes is the one that service always wrote.",
  },
  {
    model: "*",
    file: "lib/modules/platform/platform-company.service.ts",
    reason:
      "Attaching a company to a Parent Group or detaching it moves the company and its business root's rows — people, departments, placements, grants, candidates, qualifications, requests and audit history — between roots in one transaction, because the composite (id, parentGroupId) keys between them only hold once all have moved. Group-wide reach is ended in the same transaction so nobody gains access through the move (Simplified Company Creation §6, §7, §11).",
  },
  {
    model: "*",
    file: "lib/modules/platform/platform-project-assignment.service.ts",
    reason:
      "Assigning an unassigned project to a company changes one column of one project, as a compare-and-set on its being unassigned, in the same transaction as its audit event. It is a Platform Admin decision, permission-checked, that no tenant role can make: the project has no company until this runs, so no company-scoped service has a context to run it in (Standalone Project PRD §17, §34, §36, §51).",
  },
  {
    model: "*",
    file: "lib/modules/platform/platform-recovery.service.ts",
    reason:
      "Platform Recovery deletes, restores and permanently removes a company or a group — the company and group statuses with their deletion markers move together in one transaction, so a group and the companies it took down come back as one — and brings an archived document or a removed project-media link back for a company that is closed to its own users. These are Platform Admin decisions, permission-checked and audited, that no tenant role can make, so they cannot be routed through a tenant-scoped service.",
  },
  {
    model: "*",
    file: "lib/modules/platform/platform-control.service.ts",
    reason:
      "The Platform Admin control plane coordinates reviewed, permission-checked and audited changes across tenant domains. It validates each canonical record in its owning scope and keeps cross-domain lifecycle changes in one transaction without creating a second persistence model.",
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
    model: "project",
    domain: "project-media",
    fields: ["coverImageDocumentId", "updatedBy"],
    reason:
      "Project Media owns cover selection and keeps the canonical Project cover pointer synchronized in the same transaction. It cannot change any other Project field, and removing media never deletes the Document.",
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
  { file: "lib/modules/projects/project-workspace.service.ts", reason: "The canonical Project home composes permission-filtered, read-only counts and dates from existing modules without owning their records." },
  { file: "lib/modules/productivity/my-day.service.ts", reason: "My Day composes one authorised, read-only answer from the Tasks, Approvals and Calendar services and owns none of their records (MOB-06 §6-§11)." },
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
    from: "MobileSecurityPolicy.parentGroup",
    to: "ParentGroup",
    reason: "A policy level for a group that is gone. Configuration: the audit row that recorded each change is the history, and it stays.",
  },
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
    from: "ProjectMedia.project",
    to: "Project",
    reason: "Project media rows are presentation links, not file history. A removed Project takes its links, while each canonical Document remains protected independently.",
  },
  {
    from: "DailyLogDocumentLink.document",
    to: "Document",
    reason: "Caption, category and time for a file whose parent is the daily log itself (AUD-10 §3, gap 13). Presentation metadata, not history: only a placeholder that never finished uploading is ever hard-deleted, and a referenced one is marked FAILED by the cleanup rather than removed. The Document and its versions keep their own protections.",
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
