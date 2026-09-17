import { SECTION_KEYS } from "@/lib/modules/daily-logs/daily-log.types";
import { NAVIGABLE_TYPES } from "@/lib/modules/productivity/navigable.registry";
import { ownedRows } from "./company-data";

/**
 * Real record ids for a route's dynamic segments, taken from one company
 * (PRD #47 §131, §155 "guessed record id").
 *
 * Attacking with an id that does not exist proves nothing — a missing company
 * predicate answers 404 for a missing row too. So each segment resolves to a
 * row that really exists in the target company, and the parents in the same
 * URL are filled from that row's own foreign keys, so the request reaches the
 * deepest lookup a real client would.
 */

type Source = {
  model: string;
  /** Column holding the value; `id` unless the segment names a link's other end. */
  column?: string;
  /** Extra equalities on the row, e.g. a link's source type. */
  where?: Record<string, string>;
  /** URL segments filled from this row's columns: `{ milestoneId: "successorMilestoneId" }`. */
  fill?: Record<string, string>;
};

type Rule = { when?: RegExp; param: string; source: Source };

/** Segment meanings that depend on where they sit in the URL. First match wins. */
const RULES: Rule[] = [
  { when: /\/clients\/\[clientId\]\/contacts/, param: "contactId", source: { model: "Contact" } },
  { when: /\/contractor-contacts\//, param: "contactId", source: { model: "ContractorContact" } },
  { when: /\/contractor-compliance\//, param: "itemId", source: { model: "ContractorComplianceItem" } },
  { when: /\/engineering-documents\/\[documentId\]\/links\//, param: "linkId", source: { model: "IntegrationLink", where: { sourceEntityType: "engineering_document" }, fill: { documentId: "sourceEntityId" } } },
  { when: /\/submittals\/\[submittalId\]\/links\//, param: "linkId", source: { model: "IntegrationLink", where: { sourceEntityType: "technical_submittal" }, fill: { submittalId: "sourceEntityId" } } },
  { when: /\/work-packages\/\[workPackageId\]\/links\//, param: "linkId", source: { model: "IntegrationLink", where: { sourceEntityType: "work_package" }, fill: { workPackageId: "sourceEntityId" } } },
  { when: /\/daily-logs\/\[dailyLogId\]\/record-links\//, param: "linkId", source: { model: "IntegrationLink", where: { integrationType: "DAILY_LOG_RECORD" }, fill: { dailyLogId: "sourceEntityId" } } },
  { when: /\/daily-logs\/\[dailyLogId\]\/tasks\//, param: "linkId", source: { model: "DailyLogTaskLink" } },
  { when: /\/project-milestones\/\[milestoneId\]\/links\//, param: "linkId", source: { model: "ProjectMilestoneTaskLink" } },
  // A unit's document references, images and published versions (E-05D): the unit segment is filled from the row.
  { when: /\/project-units\/\[unitId\]\/documents\//, param: "linkId", source: { model: "UnitDocumentLink", fill: { unitId: "unitId" } } },
  { when: /\/project-units\/\[unitId\]\/media\/\[mediaId\]/, param: "mediaId", source: { model: "UnitMedia", fill: { unitId: "unitId" } } },
  { when: /\/project-units\/\[unitId\]\/publications\//, param: "publicationId", source: { model: "UnitPublication", fill: { unitId: "unitId" } } },
  // A unit on a deal (E-05E): the deal segment is filled from the link row.
  { when: /\/sales\/opportunities\/\[opportunityId\]\/units\/\[unitId\]/, param: "unitId", source: { model: "OpportunityUnit", column: "unitId", fill: { opportunityId: "opportunityId" } } },
  // A unit on a sale contract (E-05F): the contract segment is filled from the link row.
  { when: /\/contracts\/\[contractId\]\/units\/\[unitId\]/, param: "unitId", source: { model: "ContractUnit", column: "unitId", fill: { contractId: "contractId" } } },
  { when: /\/project-milestones\/\[milestoneId\]\/tasks\/\[taskId\]/, param: "taskId", source: { model: "ProjectMilestoneTaskLink", column: "taskId" } },
  { when: /\/project-milestones\/\[milestoneId\]\/dependencies\//, param: "dependencyId", source: { model: "ProjectMilestoneDependency", fill: { milestoneId: "successorMilestoneId" } } },
  { when: /\/daily-logs\/\[dailyLogId\]\/evidence\//, param: "documentId", source: { model: "DailyLogDocumentLink", column: "documentId" } },
  { when: /\/engineering-documents\//, param: "documentId", source: { model: "EngineeringDocument" } },
  { when: /\/engineering-document-revisions\//, param: "revisionId", source: { model: "EngineeringDocumentRevision" } },
  { when: /\/submittal-revisions\//, param: "revisionId", source: { model: "TechnicalSubmittalRevision" } },
  { when: /\/documents\/uploads\//, param: "sessionId", source: { model: "DocumentUploadSession" } },
  { when: /\/meetings\/\[meetingId\]\/participants\//, param: "memberId", source: { model: "MeetingParticipant", column: "memberId" } },
  { when: /\/calendar\/events\/\[eventId\]\/participants\//, param: "memberId", source: { model: "CalendarEventParticipant", column: "memberId" } },
  { when: /\/hr\/employees\//, param: "memberId", source: { model: "EmployeeProfile", column: "companyMemberId" } },
  // An account request is the company's the person joins (E-06 §27); not a unit's contract request.
  { when: /\/user-provisioning-requests\//, param: "requestId", source: { model: "UserProvisioningRequest" } },
  { when: /\/projects\/\[projectId\]\/members\//, param: "projectMemberId", source: { model: "ProjectMember" } },
];

/** The default meaning of a segment name. */
const BY_NAME: Record<string, string> = {
  actionItemId: "MeetingActionItem",
  allocationId: "PaymentAllocation",
  agendaItemId: "MeetingAgendaItem",
  amendmentId: "ContractAmendment",
  announcementId: "Announcement",
  assignmentId: "ProjectContractorAssignment",
  attendanceId: "AttendanceRecord",
  attentionId: "AttentionItem",
  blockerId: "ProjectMilestoneBlocker",
  budgetId: "ProjectBudget",
  buildingId: "ProjectBuilding",
  clientId: "Client",
  commentId: "Comment",
  commitmentId: "Commitment",
  contractId: "Contract",
  contractorId: "ContractorProfile",
  dailyLogId: "DailyLog",
  decisionId: "MeetingDecision",
  delegationId: "ApprovalDelegation",
  departmentId: "Department",
  documentId: "Document",
  eventId: "CalendarEvent",
  expenseId: "Expense",
  floorId: "ProjectFloor",
  installmentId: "PaymentInstallment",
  inviteId: "CompanyInvite",
  invoiceId: "Invoice",
  leadId: "Lead",
  leaveId: "LeaveRequest",
  meetingId: "Meeting",
  memberId: "CompanyMember",
  milestoneId: "ProjectMilestone",
  notificationId: "Notification",
  obligationId: "ContractObligation",
  opportunityId: "Opportunity",
  partyId: "ContractParty",
  paymentId: "Payment",
  phaseId: "ProjectPhase",
  projectId: "Project",
  proposalId: "Proposal",
  referenceId: "RfiReference",
  reservationId: "UnitReservation",
  reminderId: "CalendarReminder",
  requestId: "UnitContractRequest",
  reviewId: "DocumentReview",
  rfiId: "Rfi",
  scheduleId: "PaymentSchedule",
  sectionId: "MeetingMinutesSection",
  submittalId: "TechnicalSubmittal",
  taskId: "Task",
  timesheetId: "Timesheet",
  transmittalId: "DocumentTransmittal",
  unitId: "ProjectUnit",
  unitTypeId: "ProjectUnitType",
  versionId: "DocumentVersion",
  workLogId: "WorkLog",
  workPackageId: "WorkPackage",
};

const SECTION_MODELS: Record<(typeof SECTION_KEYS)[number], string> = {
  weather: "DailyLogWeatherEntry",
  workforce: "DailyLogWorkforceEntry",
  activities: "DailyLogWorkActivity",
  equipment: "DailyLogEquipmentEntry",
  deliveries: "DailyLogDeliveryEntry",
  visitors: "DailyLogVisitorEntry",
  delays: "DailyLogDelayEntry",
  instructions: "DailyLogInstructionEntry",
};

/** Record types for `[parentType]/[parentId]` (collaboration) — a spread across modules. */
const PARENT_TYPES: Record<string, string> = {
  project: "Project",
  task: "Task",
  client: "Client",
  document: "Document",
  invoice: "Invoice",
  leave_request: "LeaveRequest",
  contract: "Contract",
  purchase_order: "PurchaseOrder",
  quality_inspection: "QualityInspection",
  incident: "HseIncident",
  meeting: "Meeting",
  daily_log: "DailyLog",
  rfi: "Rfi",
  announcement: "Announcement",
};

const NAVIGABLE_MODELS: Record<(typeof NAVIGABLE_TYPES)[number], string> = {
  project: "Project",
  project_milestone: "ProjectMilestone",
  task: "Task",
  meeting: "Meeting",
  daily_log: "DailyLog",
  client: "Client",
  document: "Document",
  contract: "Contract",
  purchase_order: "PurchaseOrder",
  invoice: "Invoice",
};

/**
 * One real id per id-shaped field name, from the target company — what a body
 * field such as `projectId` or `assigneeMemberId` is filled with.
 */
export async function idsByFieldName(companyId: string): Promise<(field: string) => string | undefined> {
  const ids = new Map<string, string>();
  for (const [field, model] of Object.entries(BY_NAME)) {
    const [row] = await ownedRows(model, companyId);
    if (row) ids.set(field, String(row.id));
  }
  return (field) => {
    if (ids.has(field)) return ids.get(field);
    // assigneeMemberId, reviewerMemberId, ownerMemberId → a member; parentTaskId → a task.
    const suffix = [...ids.keys()].find((known) => field.endsWith(known.charAt(0).toUpperCase() + known.slice(1)));
    return suffix ? ids.get(suffix) : undefined;
  };
}

function sourceFor(pattern: string, param: string): Source | null {
  const rule = RULES.find((candidate) => candidate.param === param && (!candidate.when || candidate.when.test(pattern)));
  if (rule) return rule.source;
  const model = BY_NAME[param];
  return model ? { model } : null;
}

const text = (value: unknown) => (value instanceof Date ? value.toISOString().slice(0, 10) : value == null ? "" : String(value));

export type ParamVariant = { params: Record<string, string>; label: string };

export type ParamContext = {
  companyId: string;
  /** Only rows on these projects (PRD #47 §139): the project itself, or rows whose projectId names one. */
  projectIds?: string[];
  /** `providerKey:approvalId` pairs the target company's Owner can see in the approvals queue. */
  approvals: { providerKey: string; approvalId: string }[];
  /** A session id belonging to a member of the target company. */
  sessionId: string | null;
  /**
   * Skip rows this member raised, owns or is assigned to. Set for a
   * project-isolation sweep, where the attacker's own records on another
   * project are legitimately theirs (PRD #19 §218, PRD #47 §56, §57).
   */
  exceptMemberId?: string;
};

/**
 * Parameter sets for one route against one company. Empty when a segment
 * cannot be filled from real data — the caller reports it as uncovered rather
 * than attacking with an id that proves nothing.
 */
export async function paramVariants(pattern: string, params: string[], context: ParamContext): Promise<ParamVariant[]> {
  if (params.length === 0) return [{ params: {}, label: "" }];
  const { companyId } = context;
  /** The row filter for a model under the project restriction; null when the model cannot be tied to a project. */
  const scoped = (model: string, where: Record<string, string | string[]> = {}): Record<string, string | string[]> | null => {
    if (!context.projectIds) return where;
    return model === "Project" ? { ...where, id: context.projectIds } : { ...where, projectId: context.projectIds };
  };
  const rowsOf = async (model: string, where: Record<string, string | string[]> = {}) => {
    const filter = scoped(model, where);
    return filter ? ownedRows(model, companyId, filter, 5, context.exceptMemberId) : [];
  };

  if (params.includes("providerKey")) {
    return context.projectIds ? [] : context.approvals.map((ref) => ({ params: { ...ref }, label: ref.providerKey }));
  }

  if (params.includes("parentType")) {
    const variants: ParamVariant[] = [];
    for (const [type, model] of Object.entries(PARENT_TYPES)) {
      const [row] = await rowsOf(model);
      if (row) variants.push({ params: { parentType: type, parentId: text(row.id) }, label: type });
    }
    return variants;
  }

  if (params.includes("entityType")) {
    const variants: ParamVariant[] = [];
    for (const [type, model] of Object.entries(NAVIGABLE_MODELS)) {
      const [row] = await rowsOf(model);
      if (row) variants.push({ params: { entityType: type, entityId: text(row.id) }, label: type });
    }
    return variants;
  }

  if (params.includes("section")) {
    const variants: ParamVariant[] = [];
    for (const section of SECTION_KEYS) {
      if (context.projectIds) break;
      const [row] = await ownedRows(SECTION_MODELS[section], companyId);
      if (!row) continue;
      const filled: Record<string, string> = { dailyLogId: text(row.dailyLogId), section };
      if (params.includes("entryId")) filled.entryId = text(row.id);
      variants.push({ params: filled, label: section });
    }
    return variants;
  }

  if (pattern.startsWith("/api/me/sessions/")) {
    return context.sessionId && !context.projectIds ? [{ params: { sessionId: context.sessionId }, label: "" }] : [];
  }

  if (params.includes("date")) {
    const [row] = await rowsOf("DailyLog");
    return row ? [{ params: { projectId: text(row.projectId), date: text(row.logDate) }, label: "" }] : [];
  }

  // Deepest segment first: its row carries the ids of the parents above it.
  const filled: Record<string, string> = {};
  for (const param of [...params].reverse()) {
    if (filled[param]) continue;
    const source = sourceFor(pattern, param);
    if (!source) return [];
    const [row] = await rowsOf(source.model, source.where);
    if (!row) return [];
    filled[param] = text(row[source.column ?? "id"]);
    for (const other of params) {
      if (filled[other]) continue;
      const column = source.fill?.[other] ?? (other in row ? other : null);
      if (column && row[column]) filled[other] = text(row[column]);
    }
  }
  return [{ params: filled, label: "" }];
}
