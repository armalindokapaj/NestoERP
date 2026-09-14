import type { AuditPolicy } from "./audit.types";

/**
 * The audit policy registry (PRD #28 §134-§137, §192-§194).
 *
 * Every audited action is declared once, here, with its category, severity and
 * the exact fields that may be recorded. Action keys are constants because a
 * renamed key breaks historical evidence (PRD #28 §25, §194).
 */

export const AuditAction = {
  // Authentication (PRD #28 §91)
  AUTH_LOGIN_SUCCEEDED: "AUTH_LOGIN_SUCCEEDED",
  AUTH_LOGIN_FAILED: "AUTH_LOGIN_FAILED",
  AUTH_LOGOUT: "AUTH_LOGOUT",
  AUTH_PASSWORD_RESET_REQUESTED: "AUTH_PASSWORD_RESET_REQUESTED",
  AUTH_PASSWORD_RESET_COMPLETED: "AUTH_PASSWORD_RESET_COMPLETED",
  // Account basics (PRD #38 §20, §156)
  AUTH_PASSWORD_CHANGED: "AUTH_PASSWORD_CHANGED",
  AUTH_SESSIONS_REVOKED: "AUTH_SESSIONS_REVOKED",
  USER_PROFILE_UPDATED: "USER_PROFILE_UPDATED",

  // Access control (PRD #28 §95)
  TEAM_MEMBER_INVITED: "TEAM_MEMBER_INVITED",
  TEAM_INVITATION_RESENT: "TEAM_INVITATION_RESENT",
  TEAM_INVITATION_CANCELLED: "TEAM_INVITATION_CANCELLED",
  TEAM_MEMBER_ACTIVATED: "TEAM_MEMBER_ACTIVATED",
  TEAM_MEMBER_DEACTIVATED: "TEAM_MEMBER_DEACTIVATED",
  TEAM_MEMBER_SUSPENDED: "TEAM_MEMBER_SUSPENDED",
  TEAM_MEMBER_ROLE_CHANGED: "TEAM_MEMBER_ROLE_CHANGED",
  TEAM_MEMBER_DEPARTMENT_CHANGED: "TEAM_MEMBER_DEPARTMENT_CHANGED",

  // Configuration (PRD #28 §98)
  /** A company provisioned by the bootstrap CLI rather than a seed (PRD #38 §19). */
  COMPANY_CREATED: "COMPANY_CREATED",
  COMPANY_SETTINGS_UPDATED: "COMPANY_SETTINGS_UPDATED",
  COMPANY_MODULE_ENABLED: "COMPANY_MODULE_ENABLED",
  COMPANY_MODULE_DISABLED: "COMPANY_MODULE_DISABLED",
  COMPANY_INTEGRATION_SETTING_CHANGED: "COMPANY_INTEGRATION_SETTING_CHANGED",
  COMPANY_NUMBERING_CHANGED: "COMPANY_NUMBERING_CHANGED",
  COMPANY_BASE_CURRENCY_CHANGED: "COMPANY_BASE_CURRENCY_CHANGED",
  COMPANY_TIMEZONE_CHANGED: "COMPANY_TIMEZONE_CHANGED",

  // Finance (PRD #28 §102)
  FINANCE_INVOICE_APPROVED: "FINANCE_INVOICE_APPROVED",
  FINANCE_INVOICE_REJECTED: "FINANCE_INVOICE_REJECTED",
  FINANCE_INVOICE_VOIDED: "FINANCE_INVOICE_VOIDED",
  FINANCE_EXPENSE_APPROVED: "FINANCE_EXPENSE_APPROVED",
  FINANCE_EXPENSE_REJECTED: "FINANCE_EXPENSE_REJECTED",
  FINANCE_PAYMENT_RECORDED: "FINANCE_PAYMENT_RECORDED",
  FINANCE_PAYMENT_REVERSED: "FINANCE_PAYMENT_REVERSED",
  FINANCE_BUDGET_APPROVED: "FINANCE_BUDGET_APPROVED",
  FINANCE_COMMITMENT_CREATED: "FINANCE_COMMITMENT_CREATED",
  FINANCE_COMMITMENT_CANCELLED: "FINANCE_COMMITMENT_CANCELLED",

  // Sales (PRD #28 §106)
  SALES_OPPORTUNITY_WON: "SALES_OPPORTUNITY_WON",
  SALES_OPPORTUNITY_LOST: "SALES_OPPORTUNITY_LOST",
  SALES_PROPOSAL_ACCEPTED: "SALES_PROPOSAL_ACCEPTED",
  SALES_LEAD_CONVERTED: "SALES_LEAD_CONVERTED",

  // Clients (PRD #28 §107)
  CLIENT_ARCHIVED: "CLIENT_ARCHIVED",
  CLIENT_RESTORED: "CLIENT_RESTORED",

  // HR (PRD #28 §124)
  HR_EMPLOYMENT_STATUS_CHANGED: "HR_EMPLOYMENT_STATUS_CHANGED",
  HR_LEAVE_REQUEST_APPROVED: "HR_LEAVE_REQUEST_APPROVED",
  HR_LEAVE_REQUEST_REJECTED: "HR_LEAVE_REQUEST_REJECTED",
  HR_COMPENSATION_CHANGED: "HR_COMPENSATION_CHANGED",

  // Projects (PRD #28 §127)
  PROJECT_CREATED: "PROJECT_CREATED",
  PROJECT_STATUS_CHANGED: "PROJECT_STATUS_CHANGED",
  PROJECT_MANAGER_CHANGED: "PROJECT_MANAGER_CHANGED",
  PROJECT_ARCHIVED: "PROJECT_ARCHIVED",
  PROJECT_RESTORED: "PROJECT_RESTORED",

  // Documents (PRD #28 §129)
  DOCUMENT_DOWNLOAD_GRANTED: "DOCUMENT_DOWNLOAD_GRANTED",
  DOCUMENT_PREVIEW_GRANTED: "DOCUMENT_PREVIEW_GRANTED",
  DOCUMENT_ARCHIVED: "DOCUMENT_ARCHIVED",
  DOCUMENT_RESTORED: "DOCUMENT_RESTORED",
  /** A file a scanner refused. Worth evidence in its own right (PRD #29 §63). */
  DOCUMENT_REJECTED_MALWARE: "DOCUMENT_REJECTED_MALWARE",

  // Document versions and review (PRD #38 §156)
  DOCUMENT_VERSION_CREATED: "DOCUMENT_VERSION_CREATED",
  DOCUMENT_REVIEW_REQUESTED: "DOCUMENT_REVIEW_REQUESTED",
  DOCUMENT_REVIEW_DECIDED: "DOCUMENT_REVIEW_DECIDED",

  // Collaboration (PRD #38 §35, §156) — metadata only, never the comment text
  COMMENT_CREATED: "COMMENT_CREATED",
  COMMENT_EDITED: "COMMENT_EDITED",
  COMMENT_ARCHIVED: "COMMENT_ARCHIVED",

  // Calendar (PRD #39 §112) — never a private description, never a personal title
  CALENDAR_EVENT_CREATED: "CALENDAR_EVENT_CREATED",
  CALENDAR_EVENT_UPDATED: "CALENDAR_EVENT_UPDATED",
  CALENDAR_EVENT_ARCHIVED: "CALENDAR_EVENT_ARCHIVED",
  CALENDAR_PARTICIPANT_ADDED: "CALENDAR_PARTICIPANT_ADDED",
  CALENDAR_PARTICIPANT_REMOVED: "CALENDAR_PARTICIPANT_REMOVED",
  CALENDAR_VISIBILITY_CHANGED: "CALENDAR_VISIBILITY_CHANGED",

  // Meetings (PRD #40 §181, §182) — ids and safe metadata, never minutes text
  MEETING_CREATED: "MEETING_CREATED",
  MEETING_UPDATED: "MEETING_UPDATED",
  MEETING_SCHEDULED: "MEETING_SCHEDULED",
  MEETING_STARTED: "MEETING_STARTED",
  MEETING_COMPLETED: "MEETING_COMPLETED",
  MEETING_CANCELLED: "MEETING_CANCELLED",
  MEETING_PARTICIPANT_ADDED: "MEETING_PARTICIPANT_ADDED",
  MEETING_PARTICIPANT_REMOVED: "MEETING_PARTICIPANT_REMOVED",
  MEETING_ORGANIZER_CHANGED: "MEETING_ORGANIZER_CHANGED",
  MEETING_MINUTES_FINALIZED: "MEETING_MINUTES_FINALIZED",
  MEETING_MINUTES_REOPENED: "MEETING_MINUTES_REOPENED",
  MEETING_DECISION_CREATED: "MEETING_DECISION_CREATED",
  MEETING_ACTION_CREATED: "MEETING_ACTION_CREATED",
  MEETING_ACTION_TASK_CREATED: "MEETING_ACTION_TASK_CREATED",

  // Approvals (PRD #41 §56, §57): the cycle itself, next to each module's own
  // record transition — approval id, source, decision and actor, never the record.
  APPROVAL_REQUEST_CREATED: "APPROVAL_REQUEST_CREATED",
  APPROVAL_STEP_ASSIGNED: "APPROVAL_STEP_ASSIGNED",
  APPROVAL_STEP_APPROVED: "APPROVAL_STEP_APPROVED",
  APPROVAL_APPROVED: "APPROVAL_APPROVED",
  APPROVAL_REJECTED: "APPROVAL_REJECTED",
  APPROVAL_RETURNED: "APPROVAL_RETURNED",
  APPROVAL_CANCELLED: "APPROVAL_CANCELLED",
  APPROVAL_REASSIGNED: "APPROVAL_REASSIGNED",
  APPROVAL_DELEGATION_CREATED: "APPROVAL_DELEGATION_CREATED",
  APPROVAL_DELEGATION_REVOKED: "APPROVAL_DELEGATION_REVOKED",
  APPROVAL_POLICY_UPDATED: "APPROVAL_POLICY_UPDATED",

  // Timesheets (PRD #42 §112, §113, §223): persisted changes only, never entry text.
  TIMESHEET_CREATED: "TIMESHEET_CREATED",
  WORKLOG_CREATED: "WORKLOG_CREATED",
  WORKLOG_UPDATED: "WORKLOG_UPDATED",
  WORKLOG_ARCHIVED: "WORKLOG_ARCHIVED",
  TIMESHEET_SUBMITTED: "TIMESHEET_SUBMITTED",
  TIMESHEET_APPROVED: "TIMESHEET_APPROVED",
  TIMESHEET_RETURNED: "TIMESHEET_RETURNED",
  TIMESHEET_REJECTED: "TIMESHEET_REJECTED",
  TIMESHEET_REOPENED: "TIMESHEET_REOPENED",
  TIMESHEET_APPROVER_CHANGED: "TIMESHEET_APPROVER_CHANGED",
  TIMESHEET_SETTINGS_UPDATED: "TIMESHEET_SETTINGS_UPDATED",

  // Reporting (PRD #28 §130)
  REPORT_EXPORTED_CSV: "REPORT_EXPORTED_CSV",
  REPORT_EXPORTED_XLSX: "REPORT_EXPORTED_XLSX",
  AUDIT_LOG_EXPORTED: "AUDIT_LOG_EXPORTED",
} as const;

export type AuditActionKey = (typeof AuditAction)[keyof typeof AuditAction];

const POLICIES: AuditPolicy[] = [
  /* Authentication ------------------------------------------------------- */
  { actionKey: AuditAction.AUTH_LOGIN_SUCCEEDED, moduleKey: "settings", category: "AUTHENTICATION", severity: "INFO", snapshotMode: "NONE", allowFields: [], required: false },
  { actionKey: AuditAction.AUTH_LOGIN_FAILED, moduleKey: "settings", category: "AUTHENTICATION", severity: "INFO", snapshotMode: "NONE", allowFields: [], required: false },
  { actionKey: AuditAction.AUTH_LOGOUT, moduleKey: "settings", category: "AUTHENTICATION", severity: "INFO", snapshotMode: "NONE", allowFields: [], required: false },
  { actionKey: AuditAction.AUTH_PASSWORD_RESET_REQUESTED, moduleKey: "settings", category: "AUTHENTICATION", severity: "IMPORTANT", snapshotMode: "NONE", allowFields: [], required: false },
  { actionKey: AuditAction.AUTH_PASSWORD_RESET_COMPLETED, moduleKey: "settings", category: "AUTHENTICATION", severity: "IMPORTANT", snapshotMode: "NONE", allowFields: [], required: true },
  // Never the password, old or new — that it changed is the whole record (PRD #38 §156).
  { actionKey: AuditAction.AUTH_PASSWORD_CHANGED, moduleKey: "settings", category: "AUTHENTICATION", severity: "IMPORTANT", snapshotMode: "NONE", allowFields: [], required: true },
  { actionKey: AuditAction.AUTH_SESSIONS_REVOKED, moduleKey: "settings", category: "AUTHENTICATION", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["scope", "revoked"], required: false },
  { actionKey: AuditAction.USER_PROFILE_UPDATED, moduleKey: "settings", category: "ACCESS_CONTROL", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["firstName", "lastName", "phone", "jobTitle"], required: false },

  /* Access control ------------------------------------------------------- */
  { actionKey: AuditAction.TEAM_MEMBER_INVITED, moduleKey: "team", category: "ACCESS_CONTROL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["email", "roleKey"], required: true },
  // A resend issues a new credential and retires the old one (PRD #38 §15).
  { actionKey: AuditAction.TEAM_INVITATION_RESENT, moduleKey: "team", category: "ACCESS_CONTROL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["email", "deliveryStatus"], required: false },
  { actionKey: AuditAction.TEAM_INVITATION_CANCELLED, moduleKey: "team", category: "ACCESS_CONTROL", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["email", "status"], required: false },
  { actionKey: AuditAction.TEAM_MEMBER_ACTIVATED, moduleKey: "team", category: "ACCESS_CONTROL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status"], required: true },
  { actionKey: AuditAction.TEAM_MEMBER_DEACTIVATED, moduleKey: "team", category: "ACCESS_CONTROL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status"], required: true },
  { actionKey: AuditAction.TEAM_MEMBER_SUSPENDED, moduleKey: "team", category: "ACCESS_CONTROL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status"], required: true },
  // Owner transfer is the single highest-risk access change there is (PRD #28 §97).
  { actionKey: AuditAction.TEAM_MEMBER_ROLE_CHANGED, moduleKey: "team", category: "ACCESS_CONTROL", severity: "CRITICAL", snapshotMode: "CHANGES", allowFields: ["roleKey", "roleName"], required: true },
  { actionKey: AuditAction.TEAM_MEMBER_DEPARTMENT_CHANGED, moduleKey: "team", category: "ACCESS_CONTROL", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["departmentId", "departmentName"], required: false },

  /* Configuration -------------------------------------------------------- */
  { actionKey: AuditAction.COMPANY_CREATED, moduleKey: "settings", category: "CONFIGURATION", severity: "CRITICAL", snapshotMode: "CHANGES", allowFields: ["name", "slug", "ownerEmail", "modules"], required: true },
  { actionKey: AuditAction.COMPANY_SETTINGS_UPDATED, moduleKey: "settings", category: "CONFIGURATION", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["locale", "timezone", "dateFormat", "fiscalYearStartMonth", "defaultPaymentTermsDays", "defaultTaxRate"], required: false },
  { actionKey: AuditAction.COMPANY_MODULE_ENABLED, moduleKey: "settings", category: "CONFIGURATION", severity: "CRITICAL", snapshotMode: "CHANGES", allowFields: ["moduleKey", "enabled"], required: true },
  { actionKey: AuditAction.COMPANY_MODULE_DISABLED, moduleKey: "settings", category: "CONFIGURATION", severity: "CRITICAL", snapshotMode: "CHANGES", allowFields: ["moduleKey", "enabled"], required: true },
  { actionKey: AuditAction.COMPANY_INTEGRATION_SETTING_CHANGED, moduleKey: "settings", category: "CONFIGURATION", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["qualityGateForInventoryReceipts", "autoCreateFinanceCommitmentFromApprovedPo"], required: true },
  { actionKey: AuditAction.COMPANY_NUMBERING_CHANGED, moduleKey: "settings", category: "CONFIGURATION", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["moduleKey", "entityType", "mode", "prefix", "yearMode", "padding"], required: false },
  // Base currency has no FX engine behind it: changing it reinterprets money (PRD #28 §101).
  { actionKey: AuditAction.COMPANY_BASE_CURRENCY_CHANGED, moduleKey: "settings", category: "CONFIGURATION", severity: "CRITICAL", snapshotMode: "CHANGES", allowFields: ["baseCurrency"], required: true },
  { actionKey: AuditAction.COMPANY_TIMEZONE_CHANGED, moduleKey: "settings", category: "CONFIGURATION", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["timezone"], required: false },

  /* Finance -------------------------------------------------------------- */
  { actionKey: AuditAction.FINANCE_INVOICE_APPROVED, moduleKey: "finance", category: "FINANCIAL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status", "totalAmount", "currency"], required: true },
  { actionKey: AuditAction.FINANCE_INVOICE_REJECTED, moduleKey: "finance", category: "FINANCIAL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status"], required: true },
  { actionKey: AuditAction.FINANCE_INVOICE_VOIDED, moduleKey: "finance", category: "FINANCIAL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status", "totalAmount", "currency"], required: true },
  { actionKey: AuditAction.FINANCE_EXPENSE_APPROVED, moduleKey: "finance", category: "FINANCIAL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status", "amount", "currency"], required: true },
  { actionKey: AuditAction.FINANCE_EXPENSE_REJECTED, moduleKey: "finance", category: "FINANCIAL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status"], required: true },
  { actionKey: AuditAction.FINANCE_PAYMENT_RECORDED, moduleKey: "finance", category: "FINANCIAL", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["amount", "currency", "direction", "status"], required: true },
  { actionKey: AuditAction.FINANCE_PAYMENT_REVERSED, moduleKey: "finance", category: "FINANCIAL", severity: "CRITICAL", snapshotMode: "BEFORE_AFTER", allowFields: ["amount", "currency", "status"], required: true },
  { actionKey: AuditAction.FINANCE_BUDGET_APPROVED, moduleKey: "finance", category: "FINANCIAL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status", "amount", "currency"], required: true },
  { actionKey: AuditAction.FINANCE_COMMITMENT_CREATED, moduleKey: "finance", category: "FINANCIAL", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["amount", "currency", "status"], required: true },
  { actionKey: AuditAction.FINANCE_COMMITMENT_CANCELLED, moduleKey: "finance", category: "FINANCIAL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status"], required: true },

  /* Sales ---------------------------------------------------------------- */
  { actionKey: AuditAction.SALES_OPPORTUNITY_WON, moduleKey: "sales", category: "SALES", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["stage", "expectedValue", "currency"], required: false },
  { actionKey: AuditAction.SALES_OPPORTUNITY_LOST, moduleKey: "sales", category: "SALES", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["stage"], required: false },
  { actionKey: AuditAction.SALES_PROPOSAL_ACCEPTED, moduleKey: "sales", category: "SALES", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status", "totalAmount", "currency"], required: true },
  { actionKey: AuditAction.SALES_LEAD_CONVERTED, moduleKey: "sales", category: "SALES", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status", "convertedClientId"], required: false },

  /* Clients -------------------------------------------------------------- */
  { actionKey: AuditAction.CLIENT_ARCHIVED, moduleKey: "clients", category: "PROJECT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["status", "archivedAt"], required: false },
  { actionKey: AuditAction.CLIENT_RESTORED, moduleKey: "clients", category: "PROJECT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["status", "archivedAt"], required: false },

  /* HR ------------------------------------------------------------------- */
  { actionKey: AuditAction.HR_EMPLOYMENT_STATUS_CHANGED, moduleKey: "hr", category: "HR", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["employmentStatus"], required: true },
  { actionKey: AuditAction.HR_LEAVE_REQUEST_APPROVED, moduleKey: "hr", category: "HR", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["status", "startDate", "endDate"], required: false },
  { actionKey: AuditAction.HR_LEAVE_REQUEST_REJECTED, moduleKey: "hr", category: "HR", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["status"], required: false },
  // That pay changed is auditable; what it changed to is not, without
  // audit.sensitive.view (PRD #28 §125, §393).
  { actionKey: AuditAction.HR_COMPENSATION_CHANGED, moduleKey: "hr", category: "HR", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["amount", "currency", "effectiveFrom"], redactFields: ["amount"], required: true },

  /* Projects ------------------------------------------------------------- */
  { actionKey: AuditAction.PROJECT_CREATED, moduleKey: "projects", category: "PROJECT", severity: "INFO", snapshotMode: "BEFORE_AFTER", allowFields: ["name", "code", "status", "clientId"], required: false },
  { actionKey: AuditAction.PROJECT_STATUS_CHANGED, moduleKey: "projects", category: "PROJECT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["status"], required: false },
  { actionKey: AuditAction.PROJECT_MANAGER_CHANGED, moduleKey: "projects", category: "PROJECT", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["managerMemberId", "managerName"], required: false },
  { actionKey: AuditAction.PROJECT_ARCHIVED, moduleKey: "projects", category: "PROJECT", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status", "archivedAt"], required: false },
  { actionKey: AuditAction.PROJECT_RESTORED, moduleKey: "projects", category: "PROJECT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["status", "archivedAt"], required: false },

  /* Documents ------------------------------------------------------------ */
  { actionKey: AuditAction.DOCUMENT_DOWNLOAD_GRANTED, moduleKey: "documents", category: "DOCUMENT", severity: "INFO", snapshotMode: "NONE", allowFields: [], required: false },
  { actionKey: AuditAction.DOCUMENT_ARCHIVED, moduleKey: "documents", category: "DOCUMENT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["status", "archivedAt"], required: false },
  { actionKey: AuditAction.DOCUMENT_RESTORED, moduleKey: "documents", category: "DOCUMENT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["status", "archivedAt"], required: false },
  { actionKey: AuditAction.DOCUMENT_PREVIEW_GRANTED, moduleKey: "documents", category: "DOCUMENT", severity: "INFO", snapshotMode: "NONE", allowFields: [], required: false },
  // Required: a file refused for malware is evidence, and a refusal nobody can
  // later find is not much of a control (PRD #28 §49, PRD #29 §63).
  { actionKey: AuditAction.DOCUMENT_REJECTED_MALWARE, moduleKey: "documents", category: "DOCUMENT", severity: "CRITICAL", snapshotMode: "NONE", allowFields: [], required: true },

  /* Document versions and review ---------------------------------------- */
  { actionKey: AuditAction.DOCUMENT_VERSION_CREATED, moduleKey: "documents", category: "DOCUMENT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["versionNumber", "sizeBytes", "checksumSha256"], required: false },
  { actionKey: AuditAction.DOCUMENT_REVIEW_REQUESTED, moduleKey: "documents", category: "DOCUMENT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["versionNumber", "reviewerMemberId"], required: false },
  // A decision is evidence someone checked a file, so it commits with the decision.
  { actionKey: AuditAction.DOCUMENT_REVIEW_DECIDED, moduleKey: "documents", category: "DOCUMENT", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status", "versionNumber", "onBehalfOfMemberId"], required: true },

  /* Collaboration -------------------------------------------------------- */
  // The body is deliberately absent from allowFields: audit proves that a
  // comment existed and who wrote it, not what it said (PRD #38 §34, §156).
  { actionKey: AuditAction.COMMENT_CREATED, moduleKey: "collaboration", category: "COLLABORATION", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["parentType", "parentId", "mentionCount", "length"], required: false },
  { actionKey: AuditAction.COMMENT_EDITED, moduleKey: "collaboration", category: "COLLABORATION", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["parentType", "parentId", "length"], required: false },
  { actionKey: AuditAction.COMMENT_ARCHIVED, moduleKey: "collaboration", category: "COLLABORATION", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["parentType", "parentId", "archivedAt"], required: false },

  /* Calendar ------------------------------------------------------------- */
  { actionKey: AuditAction.CALENDAR_EVENT_CREATED, moduleKey: "calendar", category: "CALENDAR", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["eventType", "visibility", "allDay", "recurring", "projectId", "departmentId", "participantCount"], required: false },
  { actionKey: AuditAction.CALENDAR_EVENT_UPDATED, moduleKey: "calendar", category: "CALENDAR", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["eventType", "allDay", "recurring", "projectId", "departmentId", "moved"], required: false },
  { actionKey: AuditAction.CALENDAR_EVENT_ARCHIVED, moduleKey: "calendar", category: "CALENDAR", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["eventType", "visibility"], required: false },
  { actionKey: AuditAction.CALENDAR_PARTICIPANT_ADDED, moduleKey: "calendar", category: "CALENDAR", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["memberIds", "count"], required: false },
  { actionKey: AuditAction.CALENDAR_PARTICIPANT_REMOVED, moduleKey: "calendar", category: "CALENDAR", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["memberId"], required: false },
  // Who can see an event is an access decision, so a change to it is recorded as one.
  { actionKey: AuditAction.CALENDAR_VISIBILITY_CHANGED, moduleKey: "calendar", category: "CALENDAR", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["from", "to", "projectId", "departmentId"], required: true },

  /* Meetings ------------------------------------------------------------- */
  { actionKey: AuditAction.MEETING_CREATED, moduleKey: "meetings", category: "MEETING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["meetingType", "visibility", "status", "projectId", "departmentId", "participantCount", "seriesId", "occurrences"], required: false },
  { actionKey: AuditAction.MEETING_UPDATED, moduleKey: "meetings", category: "MEETING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["fields", "scope", "occurrences", "afterCompletion"], required: false },
  { actionKey: AuditAction.MEETING_SCHEDULED, moduleKey: "meetings", category: "MEETING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["startsAt"], required: false },
  { actionKey: AuditAction.MEETING_STARTED, moduleKey: "meetings", category: "MEETING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["startedAt"], required: false },
  { actionKey: AuditAction.MEETING_COMPLETED, moduleKey: "meetings", category: "MEETING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["completedAt"], required: false },
  { actionKey: AuditAction.MEETING_CANCELLED, moduleKey: "meetings", category: "MEETING", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["scope", "occurrences", "hadReason"], required: false },
  { actionKey: AuditAction.MEETING_PARTICIPANT_ADDED, moduleKey: "meetings", category: "MEETING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["memberIds", "count"], required: false },
  { actionKey: AuditAction.MEETING_PARTICIPANT_REMOVED, moduleKey: "meetings", category: "MEETING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["memberId"], required: false },
  // Who runs a meeting decides who may change it, so a transfer is access evidence.
  { actionKey: AuditAction.MEETING_ORGANIZER_CHANGED, moduleKey: "meetings", category: "MEETING", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["from", "to"], required: true },
  { actionKey: AuditAction.MEETING_MINUTES_FINALIZED, moduleKey: "meetings", category: "MEETING", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["sections", "decisions", "actions"], required: true },
  { actionKey: AuditAction.MEETING_MINUTES_REOPENED, moduleKey: "meetings", category: "MEETING", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["reason"], required: true },
  { actionKey: AuditAction.MEETING_DECISION_CREATED, moduleKey: "meetings", category: "MEETING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["decisionNumber"], required: false },
  { actionKey: AuditAction.MEETING_ACTION_CREATED, moduleKey: "meetings", category: "MEETING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["ownerMemberId", "hasDueDate"], required: false },
  { actionKey: AuditAction.MEETING_ACTION_TASK_CREATED, moduleKey: "meetings", category: "MEETING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["actionId", "taskId"], required: false },

  /* Approvals ------------------------------------------------------------ */
  { actionKey: AuditAction.APPROVAL_REQUEST_CREATED, moduleKey: "approvals", category: "APPROVAL", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["approvalId", "providerKey", "sourceType", "steps"], required: false },
  { actionKey: AuditAction.APPROVAL_STEP_ASSIGNED, moduleKey: "approvals", category: "APPROVAL", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["approvalId", "providerKey", "sourceType", "step", "stepLabel"], required: false },
  // A decision is evidence: it commits with the decision or the decision does not happen (PRD #41 §248).
  { actionKey: AuditAction.APPROVAL_STEP_APPROVED, moduleKey: "approvals", category: "APPROVAL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["approvalId", "providerKey", "sourceType", "step", "stepLabel", "onBehalfOfMemberId", "hasNote"], required: true },
  { actionKey: AuditAction.APPROVAL_APPROVED, moduleKey: "approvals", category: "APPROVAL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["approvalId", "providerKey", "sourceType", "decision", "step", "onBehalfOfMemberId", "hasNote"], required: true },
  { actionKey: AuditAction.APPROVAL_REJECTED, moduleKey: "approvals", category: "APPROVAL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["approvalId", "providerKey", "sourceType", "decision", "step", "onBehalfOfMemberId", "hasNote"], required: true },
  { actionKey: AuditAction.APPROVAL_RETURNED, moduleKey: "approvals", category: "APPROVAL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["approvalId", "providerKey", "sourceType", "decision", "step", "onBehalfOfMemberId", "hasNote"], required: true },
  { actionKey: AuditAction.APPROVAL_CANCELLED, moduleKey: "approvals", category: "APPROVAL", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["approvalId", "providerKey", "sourceType", "count"], required: false },
  { actionKey: AuditAction.APPROVAL_REASSIGNED, moduleKey: "approvals", category: "APPROVAL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["approvalId", "providerKey", "sourceType", "from", "to"], required: true },
  { actionKey: AuditAction.APPROVAL_DELEGATION_CREATED, moduleKey: "approvals", category: "APPROVAL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["fromMemberId", "toMemberId", "providerKey", "startsAt", "endsAt", "hasReason"], required: true },
  { actionKey: AuditAction.APPROVAL_DELEGATION_REVOKED, moduleKey: "approvals", category: "APPROVAL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["fromMemberId", "toMemberId", "providerKey", "revokedAt"], required: true },
  /* Timesheets ----------------------------------------------------------- */
  { actionKey: AuditAction.TIMESHEET_CREATED, moduleKey: "timesheets", category: "TIMESHEET", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["memberId", "periodStart"], required: false },
  { actionKey: AuditAction.WORKLOG_CREATED, moduleKey: "timesheets", category: "TIMESHEET", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["timesheetId", "workDate", "minutes", "workType", "projectId", "taskId", "billable"], required: false },
  { actionKey: AuditAction.WORKLOG_UPDATED, moduleKey: "timesheets", category: "TIMESHEET", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["workDate", "minutes", "workType", "projectId", "taskId", "billable", "overtimeFlag"], required: false },
  { actionKey: AuditAction.WORKLOG_ARCHIVED, moduleKey: "timesheets", category: "TIMESHEET", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["timesheetId", "workDate", "minutes"], required: false },
  { actionKey: AuditAction.TIMESHEET_SUBMITTED, moduleKey: "timesheets", category: "TIMESHEET", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["approvalId", "submissionVersion", "approverMemberId", "totalMinutes"], required: true },
  // A decision on somebody's week is evidence: it commits with its audit or not at all.
  { actionKey: AuditAction.TIMESHEET_APPROVED, moduleKey: "timesheets", category: "TIMESHEET", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["approvalId", "status", "submissionVersion", "onBehalfOfMemberId", "hasNote"], required: true },
  { actionKey: AuditAction.TIMESHEET_RETURNED, moduleKey: "timesheets", category: "TIMESHEET", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["approvalId", "status", "submissionVersion", "onBehalfOfMemberId", "hasNote"], required: true },
  { actionKey: AuditAction.TIMESHEET_REJECTED, moduleKey: "timesheets", category: "TIMESHEET", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["approvalId", "status", "submissionVersion", "onBehalfOfMemberId", "hasNote"], required: true },
  { actionKey: AuditAction.TIMESHEET_REOPENED, moduleKey: "timesheets", category: "TIMESHEET", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status"], required: true },
  { actionKey: AuditAction.TIMESHEET_APPROVER_CHANGED, moduleKey: "timesheets", category: "TIMESHEET", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["memberId", "approverMemberId"], required: true },
  { actionKey: AuditAction.TIMESHEET_SETTINGS_UPDATED, moduleKey: "timesheets", category: "TIMESHEET", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["weekStartsOn", "standardDailyMinutes", "standardWeeklyMinutes", "incrementMinutes", "enforceIncrement", "backdateDays", "submitDay", "submitTime", "descriptionsRequired", "membersSetBillable"], required: true },
  { actionKey: AuditAction.APPROVAL_POLICY_UPDATED, moduleKey: "procurement", category: "APPROVAL", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["financeStepAbove", "executiveStepAbove", "executiveRoleKey", "currency"], required: true },

  /* Reporting ------------------------------------------------------------ */
  { actionKey: AuditAction.REPORT_EXPORTED_CSV, moduleKey: "settings", category: "REPORTING", severity: "IMPORTANT", snapshotMode: "NONE", allowFields: [], required: false },
  { actionKey: AuditAction.REPORT_EXPORTED_XLSX, moduleKey: "settings", category: "REPORTING", severity: "IMPORTANT", snapshotMode: "NONE", allowFields: [], required: false },
  { actionKey: AuditAction.AUDIT_LOG_EXPORTED, moduleKey: "settings", category: "REPORTING", severity: "IMPORTANT", snapshotMode: "NONE", allowFields: [], required: false },
];

const BY_KEY = new Map<string, AuditPolicy>();
for (const policy of POLICIES) {
  // A duplicate key would make historical evidence ambiguous (PRD #28 §192).
  if (BY_KEY.has(policy.actionKey)) {
    throw new Error(`Duplicate audit action key: ${policy.actionKey}`);
  }
  BY_KEY.set(policy.actionKey, policy);
}

export function findAuditPolicy(actionKey: string): AuditPolicy | undefined {
  return BY_KEY.get(actionKey);
}

export function auditPolicies(): AuditPolicy[] {
  return [...POLICIES];
}
