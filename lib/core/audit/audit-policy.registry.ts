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
  AUTH_COMPANY_CONTEXT_SWITCHED: "AUTH_COMPANY_CONTEXT_SWITCHED",
  USER_PROFILE_UPDATED: "USER_PROFILE_UPDATED",

  // Access control (PRD #28 §95)
  TEAM_MEMBER_INVITED: "TEAM_MEMBER_INVITED",
  TEAM_INVITATION_RESENT: "TEAM_INVITATION_RESENT",
  TEAM_INVITATION_CANCELLED: "TEAM_INVITATION_CANCELLED",
  TEAM_MEMBER_ACTIVATED: "TEAM_MEMBER_ACTIVATED",
  TEAM_MEMBER_DEACTIVATED: "TEAM_MEMBER_DEACTIVATED",
  TEAM_MEMBER_SUSPENDED: "TEAM_MEMBER_SUSPENDED",
  TEAM_MEMBER_ROLE_CHANGED: "TEAM_MEMBER_ROLE_CHANGED",
  /** An administrator issued a temporary password (PRD #50 §23). */
  TEAM_MEMBER_PASSWORD_RESET: "TEAM_MEMBER_PASSWORD_RESET",
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
  PROJECT_UPDATED: "PROJECT_UPDATED",
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
  /** A file the scanner never vouched for, given up on after its last attempt (PRD #51 §34, §35). */
  DOCUMENT_SCAN_FAILED: "DOCUMENT_SCAN_FAILED",

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

  // Daily logs (PRD #43 §193, §194): state changes and the entries that matter later, never every edit.
  DAILY_LOG_CREATED: "DAILY_LOG_CREATED",
  DAILY_LOG_UPDATED: "DAILY_LOG_UPDATED",
  DAILY_LOG_SUBMITTED: "DAILY_LOG_SUBMITTED",
  DAILY_LOG_RETURNED: "DAILY_LOG_RETURNED",
  DAILY_LOG_REVIEWED: "DAILY_LOG_REVIEWED",
  DAILY_LOG_LOCKED: "DAILY_LOG_LOCKED",
  DAILY_LOG_VOIDED: "DAILY_LOG_VOIDED",
  DAILY_LOG_CORRECTION_ADDED: "DAILY_LOG_CORRECTION_ADDED",
  DAILY_LOG_DELAY_ADDED: "DAILY_LOG_DELAY_ADDED",
  DAILY_LOG_INSTRUCTION_ADDED: "DAILY_LOG_INSTRUCTION_ADDED",
  DAILY_LOG_TASK_CREATED: "DAILY_LOG_TASK_CREATED",
  DAILY_LOG_SETTINGS_UPDATED: "DAILY_LOG_SETTINGS_UPDATED",

  // Project planning (PRD #44 §23, §208, §209): structure, completion, the baseline and sequencing.
  PROJECT_PHASE_CREATED: "PROJECT_PHASE_CREATED",
  PROJECT_PHASE_UPDATED: "PROJECT_PHASE_UPDATED",
  PROJECT_PHASE_ARCHIVED: "PROJECT_PHASE_ARCHIVED",
  PROJECT_MILESTONE_CREATED: "PROJECT_MILESTONE_CREATED",
  PROJECT_MILESTONE_UPDATED: "PROJECT_MILESTONE_UPDATED",
  PROJECT_MILESTONE_COMPLETED: "PROJECT_MILESTONE_COMPLETED",
  PROJECT_MILESTONE_REOPENED: "PROJECT_MILESTONE_REOPENED",
  PROJECT_MILESTONE_ARCHIVED: "PROJECT_MILESTONE_ARCHIVED",
  PROJECT_MILESTONE_BASELINE_CHANGED: "PROJECT_MILESTONE_BASELINE_CHANGED",
  PROJECT_MILESTONE_DEPENDENCY_ADDED: "PROJECT_MILESTONE_DEPENDENCY_ADDED",
  PROJECT_MILESTONE_DEPENDENCY_REMOVED: "PROJECT_MILESTONE_DEPENDENCY_REMOVED",
  PROJECT_MILESTONE_BLOCKER_CREATED: "PROJECT_MILESTONE_BLOCKER_CREATED",
  PROJECT_MILESTONE_BLOCKER_RESOLVED: "PROJECT_MILESTONE_BLOCKER_RESOLVED",
  PROJECT_PLANNING_BASELINE_LOCK_CHANGED: "PROJECT_PLANNING_BASELINE_LOCK_CHANGED",
  PROJECT_PLANNING_TEMPLATE_APPLIED: "PROJECT_PLANNING_TEMPLATE_APPLIED",
  PROJECT_PLANNING_COPIED: "PROJECT_PLANNING_COPIED",
  PROJECT_PLANNING_SETTINGS_UPDATED: "PROJECT_PLANNING_SETTINGS_UPDATED",

  // Announcements (PRD #45 §54-§56): what was published to whom and when — never who read it.
  ANNOUNCEMENT_CREATED: "ANNOUNCEMENT_CREATED",
  ANNOUNCEMENT_UPDATED: "ANNOUNCEMENT_UPDATED",
  ANNOUNCEMENT_SCHEDULED: "ANNOUNCEMENT_SCHEDULED",
  ANNOUNCEMENT_PUBLISHED: "ANNOUNCEMENT_PUBLISHED",
  ANNOUNCEMENT_EXPIRED: "ANNOUNCEMENT_EXPIRED",
  ANNOUNCEMENT_ARCHIVED: "ANNOUNCEMENT_ARCHIVED",
  ANNOUNCEMENT_PINNED: "ANNOUNCEMENT_PINNED",
  ANNOUNCEMENT_UNPINNED: "ANNOUNCEMENT_UNPINNED",
  ANNOUNCEMENT_ACK_REQUIRED_CHANGED: "ANNOUNCEMENT_ACK_REQUIRED_CHANGED",
  PRODUCTIVITY_SETTINGS_UPDATED: "PRODUCTIVITY_SETTINGS_UPDATED",

  // Contractors and engineering (PRD #46 §229, §230): identifiers and decisions, never RFI text, legal notes or review comments (§233).
  CONTRACTOR_CREATED: "CONTRACTOR_CREATED",
  CONTRACTOR_UPDATED: "CONTRACTOR_UPDATED",
  CONTRACTOR_ARCHIVED: "CONTRACTOR_ARCHIVED",
  CONTRACTOR_REACTIVATED: "CONTRACTOR_REACTIVATED",
  CONTRACTOR_CONTACT_CHANGED: "CONTRACTOR_CONTACT_CHANGED",
  CONTRACTOR_PROJECT_ASSIGNED: "CONTRACTOR_PROJECT_ASSIGNED",
  CONTRACTOR_PROJECT_UPDATED: "CONTRACTOR_PROJECT_UPDATED",
  CONTRACTOR_PROJECT_TERMINATED: "CONTRACTOR_PROJECT_TERMINATED",
  WORK_PACKAGE_CREATED: "WORK_PACKAGE_CREATED",
  WORK_PACKAGE_UPDATED: "WORK_PACKAGE_UPDATED",
  WORK_PACKAGE_COMPLETED: "WORK_PACKAGE_COMPLETED",
  WORK_PACKAGE_ARCHIVED: "WORK_PACKAGE_ARCHIVED",
  CONTRACTOR_COMPLIANCE_CREATED: "CONTRACTOR_COMPLIANCE_CREATED",
  CONTRACTOR_COMPLIANCE_UPDATED: "CONTRACTOR_COMPLIANCE_UPDATED",
  CONTRACTOR_COMPLIANCE_WAIVED: "CONTRACTOR_COMPLIANCE_WAIVED",
  CONTRACTOR_COMPLIANCE_EXPIRED: "CONTRACTOR_COMPLIANCE_EXPIRED",
  CONTRACTOR_COMPLIANCE_ARCHIVED: "CONTRACTOR_COMPLIANCE_ARCHIVED",
  ENGINEERING_DOCUMENT_CREATED: "ENGINEERING_DOCUMENT_CREATED",
  ENGINEERING_DOCUMENT_UPDATED: "ENGINEERING_DOCUMENT_UPDATED",
  ENGINEERING_DOCUMENT_VOIDED: "ENGINEERING_DOCUMENT_VOIDED",
  ENGINEERING_REVISION_CREATED: "ENGINEERING_REVISION_CREATED",
  ENGINEERING_REVISION_SUBMITTED: "ENGINEERING_REVISION_SUBMITTED",
  ENGINEERING_REVISION_REVIEWED: "ENGINEERING_REVISION_REVIEWED",
  ENGINEERING_REVISION_SUPERSEDED: "ENGINEERING_REVISION_SUPERSEDED",
  ENGINEERING_LINK_CHANGED: "ENGINEERING_LINK_CHANGED",
  RFI_CREATED: "RFI_CREATED",
  RFI_UPDATED: "RFI_UPDATED",
  RFI_OPENED: "RFI_OPENED",
  RFI_RESPONDED: "RFI_RESPONDED",
  RFI_CLARIFICATION_REQUESTED: "RFI_CLARIFICATION_REQUESTED",
  RFI_CLOSED: "RFI_CLOSED",
  RFI_VOIDED: "RFI_VOIDED",
  SUBMITTAL_CREATED: "SUBMITTAL_CREATED",
  SUBMITTAL_UPDATED: "SUBMITTAL_UPDATED",
  SUBMITTAL_REVISION_CREATED: "SUBMITTAL_REVISION_CREATED",
  SUBMITTAL_SUBMITTED: "SUBMITTAL_SUBMITTED",
  SUBMITTAL_REVIEWED: "SUBMITTAL_REVIEWED",
  SUBMITTAL_CLOSED: "SUBMITTAL_CLOSED",
  SUBMITTAL_VOIDED: "SUBMITTAL_VOIDED",
  TRANSMITTAL_CREATED: "TRANSMITTAL_CREATED",
  TRANSMITTAL_UPDATED: "TRANSMITTAL_UPDATED",
  TRANSMITTAL_ISSUED: "TRANSMITTAL_ISSUED",
  TRANSMITTAL_VOIDED: "TRANSMITTAL_VOIDED",
  ENGINEERING_SETTINGS_UPDATED: "ENGINEERING_SETTINGS_UPDATED",

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
  // Recorded in the company the session moved into; the auth event keeps both ends (E-05A §26).
  { actionKey: AuditAction.AUTH_COMPANY_CONTEXT_SWITCHED, moduleKey: "settings", category: "AUTHENTICATION", severity: "INFO", snapshotMode: "NONE", allowFields: [], required: false },
  { actionKey: AuditAction.USER_PROFILE_UPDATED, moduleKey: "settings", category: "ACCESS_CONTROL", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["firstName", "lastName", "phone", "jobTitle"], required: false },

  /* Access control ------------------------------------------------------- */
  { actionKey: AuditAction.TEAM_MEMBER_INVITED, moduleKey: "team", category: "ACCESS_CONTROL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["email", "roleKey"], required: true },
  // A resend issues a new credential and retires the old one (PRD #38 §15).
  { actionKey: AuditAction.TEAM_INVITATION_RESENT, moduleKey: "team", category: "ACCESS_CONTROL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["email", "deliveryStatus"], required: false },
  { actionKey: AuditAction.TEAM_INVITATION_CANCELLED, moduleKey: "team", category: "ACCESS_CONTROL", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["email", "status"], required: false },
  { actionKey: AuditAction.TEAM_MEMBER_ACTIVATED, moduleKey: "team", category: "ACCESS_CONTROL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status"], required: true },
  // The password itself is never a field here, and neither is its hash
  // (PRD #50 §23). What is kept: who did it, to whom, and what it forced.
  { actionKey: AuditAction.TEAM_MEMBER_PASSWORD_RESET, moduleKey: "team", category: "ACCESS_CONTROL", severity: "CRITICAL", snapshotMode: "CHANGES", allowFields: ["username", "mustChangePassword", "sessionsRevoked", "expiresAt"], required: true },
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
  { actionKey: AuditAction.PROJECT_CREATED, moduleKey: "projects", category: "PROJECT", severity: "INFO", snapshotMode: "BEFORE_AFTER", allowFields: ["name", "code", "status", "clientId", "projectType"], required: false },
  { actionKey: AuditAction.PROJECT_UPDATED, moduleKey: "projects", category: "PROJECT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["name", "code", "description", "clientId", "priority", "projectType", "startDate", "endDate", "address", "city", "country", "coverImageDocumentId"], required: false },
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
  // Required alike: a file that will never be served, because nothing could
  // prove it clean, is a decision somebody will ask about (PRD #51 §35, §149).
  { actionKey: AuditAction.DOCUMENT_SCAN_FAILED, moduleKey: "documents", category: "DOCUMENT", severity: "IMPORTANT", snapshotMode: "NONE", allowFields: [], required: true },

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
  /* Daily logs ----------------------------------------------------------- */
  { actionKey: AuditAction.DAILY_LOG_CREATED, moduleKey: "dailyLogs", category: "DAILY_LOG", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["projectId", "workDate", "lateEntry"], required: false },
  { actionKey: AuditAction.DAILY_LOG_UPDATED, moduleKey: "dailyLogs", category: "DAILY_LOG", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["fields", "siteCondition"], required: false },
  // Review, lock, void and correction are the record's standing as evidence: each commits with its audit.
  { actionKey: AuditAction.DAILY_LOG_SUBMITTED, moduleKey: "dailyLogs", category: "DAILY_LOG", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["status", "reviewerMemberId", "submissionCount", "lateEntry"], required: true },
  { actionKey: AuditAction.DAILY_LOG_RETURNED, moduleKey: "dailyLogs", category: "DAILY_LOG", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status", "submissionCount"], required: true },
  { actionKey: AuditAction.DAILY_LOG_REVIEWED, moduleKey: "dailyLogs", category: "DAILY_LOG", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status", "submissionCount"], required: true },
  { actionKey: AuditAction.DAILY_LOG_LOCKED, moduleKey: "dailyLogs", category: "DAILY_LOG", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status"], required: true },
  { actionKey: AuditAction.DAILY_LOG_VOIDED, moduleKey: "dailyLogs", category: "DAILY_LOG", severity: "CRITICAL", snapshotMode: "BEFORE_AFTER", allowFields: ["status"], required: true },
  { actionKey: AuditAction.DAILY_LOG_CORRECTION_ADDED, moduleKey: "dailyLogs", category: "DAILY_LOG", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["correctionId", "status"], required: true },
  { actionKey: AuditAction.DAILY_LOG_DELAY_ADDED, moduleKey: "dailyLogs", category: "DAILY_LOG", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["entryId", "category", "impact", "durationMinutes"], required: false },
  { actionKey: AuditAction.DAILY_LOG_INSTRUCTION_ADDED, moduleKey: "dailyLogs", category: "DAILY_LOG", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["entryId", "requiresAction"], required: false },
  { actionKey: AuditAction.DAILY_LOG_TASK_CREATED, moduleKey: "dailyLogs", category: "DAILY_LOG", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["taskId", "linkType", "section", "entryId"], required: false },
  { actionKey: AuditAction.DAILY_LOG_SETTINGS_UPDATED, moduleKey: "dailyLogs", category: "DAILY_LOG", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["logsRequired", "backdateDays", "reviewerRequired", "reviewerMemberId", "workingDays"], required: true },
  /* Project planning ----------------------------------------------------- */
  { actionKey: AuditAction.PROJECT_PHASE_CREATED, moduleKey: "projects", category: "PROJECT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["phaseId", "name", "status"], required: false },
  { actionKey: AuditAction.PROJECT_PHASE_UPDATED, moduleKey: "projects", category: "PROJECT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["phaseId", "name", "status", "progressPercent"], required: false },
  { actionKey: AuditAction.PROJECT_PHASE_ARCHIVED, moduleKey: "projects", category: "PROJECT", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["phaseId", "name"], required: true },
  { actionKey: AuditAction.PROJECT_MILESTONE_CREATED, moduleKey: "projects", category: "PROJECT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["name", "phaseId", "milestoneType", "ownerMemberId", "baselineDate", "plannedDate", "forecastDate", "critical", "externallyCommitted"], required: false },
  { actionKey: AuditAction.PROJECT_MILESTONE_UPDATED, moduleKey: "projects", category: "PROJECT", severity: "INFO", snapshotMode: "BEFORE_AFTER", allowFields: ["name", "status", "phaseId", "ownerMemberId", "plannedDate", "forecastDate", "actualDate", "progressPercent", "critical", "externallyCommitted", "taskId", "linkType", "linkedRecordType", "linkedRecordId"], required: false },
  // Completion, reopening and the baseline are the plan's commitments: each commits with its audit (§207).
  { actionKey: AuditAction.PROJECT_MILESTONE_COMPLETED, moduleKey: "projects", category: "PROJECT", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["status", "actualDate"], required: true },
  { actionKey: AuditAction.PROJECT_MILESTONE_REOPENED, moduleKey: "projects", category: "PROJECT", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["status", "actualDate"], required: true },
  { actionKey: AuditAction.PROJECT_MILESTONE_ARCHIVED, moduleKey: "projects", category: "PROJECT", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status"], required: true },
  { actionKey: AuditAction.PROJECT_MILESTONE_BASELINE_CHANGED, moduleKey: "projects", category: "PROJECT", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["baselineDate"], required: true },
  { actionKey: AuditAction.PROJECT_MILESTONE_DEPENDENCY_ADDED, moduleKey: "projects", category: "PROJECT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["dependencyId", "predecessorMilestoneId", "successorMilestoneId", "lagDays"], required: true },
  { actionKey: AuditAction.PROJECT_MILESTONE_DEPENDENCY_REMOVED, moduleKey: "projects", category: "PROJECT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["dependencyId", "predecessorMilestoneId", "successorMilestoneId", "lagDays"], required: true },
  { actionKey: AuditAction.PROJECT_MILESTONE_BLOCKER_CREATED, moduleKey: "projects", category: "PROJECT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["blockerId", "severity", "ownerMemberId", "dueDate", "taskId"], required: false },
  { actionKey: AuditAction.PROJECT_MILESTONE_BLOCKER_RESOLVED, moduleKey: "projects", category: "PROJECT", severity: "INFO", snapshotMode: "BEFORE_AFTER", allowFields: ["blockerId", "severity", "resolved"], required: false },
  { actionKey: AuditAction.PROJECT_PLANNING_BASELINE_LOCK_CHANGED, moduleKey: "projects", category: "PROJECT", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["baselineLocked"], required: true },
  { actionKey: AuditAction.PROJECT_PLANNING_TEMPLATE_APPLIED, moduleKey: "projects", category: "PROJECT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["templateKey", "phases", "milestones"], required: false },
  { actionKey: AuditAction.PROJECT_PLANNING_COPIED, moduleKey: "projects", category: "PROJECT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["sourceProjectId", "phases", "milestones"], required: false },
  { actionKey: AuditAction.PROJECT_PLANNING_SETTINGS_UPDATED, moduleKey: "projects", category: "CONFIGURATION", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["milestoneReminderDays", "baselineChangeReasonRequired", "notifyExecutivesOnCriticalChanges"], required: true },
  /* Announcements -------------------------------------------------------- */
  { actionKey: AuditAction.ANNOUNCEMENT_CREATED, moduleKey: "announcements", category: "ANNOUNCEMENT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["title", "priority", "audienceType", "projectId", "departmentId", "selectedMembers", "requiresAcknowledgment", "pinned"], required: false },
  { actionKey: AuditAction.ANNOUNCEMENT_UPDATED, moduleKey: "announcements", category: "ANNOUNCEMENT", severity: "INFO", snapshotMode: "BEFORE_AFTER", allowFields: ["title", "priority", "audienceType", "expiresAt", "material"], required: false },
  { actionKey: AuditAction.ANNOUNCEMENT_SCHEDULED, moduleKey: "announcements", category: "ANNOUNCEMENT", severity: "INFO", snapshotMode: "BEFORE_AFTER", allowFields: ["status", "publishAt"], required: true },
  { actionKey: AuditAction.ANNOUNCEMENT_PUBLISHED, moduleKey: "announcements", category: "ANNOUNCEMENT", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status", "priority", "audienceType", "targets"], required: true },
  { actionKey: AuditAction.ANNOUNCEMENT_EXPIRED, moduleKey: "announcements", category: "ANNOUNCEMENT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["status"], required: true },
  { actionKey: AuditAction.ANNOUNCEMENT_ARCHIVED, moduleKey: "announcements", category: "ANNOUNCEMENT", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["status"], required: true },
  { actionKey: AuditAction.ANNOUNCEMENT_PINNED, moduleKey: "announcements", category: "ANNOUNCEMENT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["pinned"], required: false },
  { actionKey: AuditAction.ANNOUNCEMENT_UNPINNED, moduleKey: "announcements", category: "ANNOUNCEMENT", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["pinned"], required: false },
  { actionKey: AuditAction.ANNOUNCEMENT_ACK_REQUIRED_CHANGED, moduleKey: "announcements", category: "ANNOUNCEMENT", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["requiresAcknowledgment"], required: true },
  { actionKey: AuditAction.PRODUCTIVITY_SETTINGS_UPDATED, moduleKey: "announcements", category: "CONFIGURATION", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["announcementsEnabled", "favoritesEnabled", "recentWorkEnabled", "recentWorkRetentionDays", "announcementAckReminderDays", "notifyNormalAnnouncements"], required: true },
  /* Contractors and engineering (PRD #46 §229) ---------------------------- */
  { actionKey: AuditAction.CONTRACTOR_CREATED, moduleKey: "contractors", category: "CONTRACTOR", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["legalName", "status", "supplierId", "countryCode", "registrationNumber", "vatNumber", "duplicateConfirmed"], required: true },
  { actionKey: AuditAction.CONTRACTOR_UPDATED, moduleKey: "contractors", category: "CONTRACTOR", severity: "INFO", snapshotMode: "BEFORE_AFTER", allowFields: ["legalName", "tradingName", "status", "supplierId", "countryCode", "registrationNumber", "vatNumber", "email", "phone"], required: false },
  { actionKey: AuditAction.CONTRACTOR_ARCHIVED, moduleKey: "contractors", category: "CONTRACTOR", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["status"], required: true },
  { actionKey: AuditAction.CONTRACTOR_REACTIVATED, moduleKey: "contractors", category: "CONTRACTOR", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["status"], required: true },
  { actionKey: AuditAction.CONTRACTOR_CONTACT_CHANGED, moduleKey: "contractors", category: "CONTRACTOR", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["contactId", "name", "contactRole", "active", "removed"], required: false },
  { actionKey: AuditAction.CONTRACTOR_PROJECT_ASSIGNED, moduleKey: "contractors", category: "CONTRACTOR", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["contractorId", "projectId", "status", "contractId", "internalManagerMemberId", "startDate", "endDate"], required: true },
  { actionKey: AuditAction.CONTRACTOR_PROJECT_UPDATED, moduleKey: "contractors", category: "CONTRACTOR", severity: "INFO", snapshotMode: "BEFORE_AFTER", allowFields: ["status", "contractId", "internalManagerMemberId", "primaryContractorContactId", "startDate", "endDate"], required: false },
  { actionKey: AuditAction.CONTRACTOR_PROJECT_TERMINATED, moduleKey: "contractors", category: "CONTRACTOR", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["status", "endDate"], required: true },
  { actionKey: AuditAction.WORK_PACKAGE_CREATED, moduleKey: "contractors", category: "CONTRACTOR", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["code", "name", "status", "contractorId", "contractId", "responsibleMemberId", "discipline", "plannedStartDate", "plannedFinishDate"], required: false },
  { actionKey: AuditAction.WORK_PACKAGE_UPDATED, moduleKey: "contractors", category: "CONTRACTOR", severity: "INFO", snapshotMode: "BEFORE_AFTER", allowFields: ["code", "name", "status", "contractorId", "contractId", "responsibleMemberId", "discipline", "plannedStartDate", "plannedFinishDate", "forecastStartDate", "forecastFinishDate", "actualStartDate", "actualFinishDate", "value", "currency"], required: false },
  { actionKey: AuditAction.WORK_PACKAGE_COMPLETED, moduleKey: "contractors", category: "CONTRACTOR", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["status", "actualFinishDate"], required: true },
  { actionKey: AuditAction.WORK_PACKAGE_ARCHIVED, moduleKey: "contractors", category: "CONTRACTOR", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["archived"], required: false },
  { actionKey: AuditAction.CONTRACTOR_COMPLIANCE_CREATED, moduleKey: "contractors", category: "CONTRACTOR", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["type", "title", "status", "documentId", "issuedAt", "expiresAt", "referenceNumber"], required: false },
  { actionKey: AuditAction.CONTRACTOR_COMPLIANCE_UPDATED, moduleKey: "contractors", category: "CONTRACTOR", severity: "INFO", snapshotMode: "BEFORE_AFTER", allowFields: ["type", "title", "status", "documentId", "issuedAt", "expiresAt", "referenceNumber"], required: false },
  { actionKey: AuditAction.CONTRACTOR_COMPLIANCE_WAIVED, moduleKey: "contractors", category: "CONTRACTOR", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["status"], required: true },
  { actionKey: AuditAction.CONTRACTOR_COMPLIANCE_EXPIRED, moduleKey: "contractors", category: "CONTRACTOR", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["status", "expiresAt"], required: true },
  { actionKey: AuditAction.CONTRACTOR_COMPLIANCE_ARCHIVED, moduleKey: "contractors", category: "CONTRACTOR", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["status"], required: false },
  { actionKey: AuditAction.ENGINEERING_DOCUMENT_CREATED, moduleKey: "engineering", category: "ENGINEERING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["documentNumber", "documentType", "discipline", "contractorId", "workPackageId", "reviewerMemberId", "reviewDueAt"], required: false },
  { actionKey: AuditAction.ENGINEERING_DOCUMENT_UPDATED, moduleKey: "engineering", category: "ENGINEERING", severity: "INFO", snapshotMode: "BEFORE_AFTER", allowFields: ["documentNumber", "title", "documentType", "discipline", "contractorId", "workPackageId", "responsibleMemberId", "reviewerMemberId", "reviewDueAt", "sharingClassification", "documentId"], required: false },
  { actionKey: AuditAction.ENGINEERING_DOCUMENT_VOIDED, moduleKey: "engineering", category: "ENGINEERING", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["status"], required: true },
  { actionKey: AuditAction.ENGINEERING_REVISION_CREATED, moduleKey: "engineering", category: "ENGINEERING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["revisionId", "revisionCode", "documentId"], required: false },
  { actionKey: AuditAction.ENGINEERING_REVISION_SUBMITTED, moduleKey: "engineering", category: "ENGINEERING", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["revisionId", "revisionCode", "documentId", "documentVersionId", "status"], required: true },
  { actionKey: AuditAction.ENGINEERING_REVISION_REVIEWED, moduleKey: "engineering", category: "ENGINEERING", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["revisionId", "revisionCode", "status", "decision"], required: true },
  { actionKey: AuditAction.ENGINEERING_REVISION_SUPERSEDED, moduleKey: "engineering", category: "ENGINEERING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["revisionIds", "supersededBy"], required: true },
  { actionKey: AuditAction.ENGINEERING_LINK_CHANGED, moduleKey: "engineering", category: "ENGINEERING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["linkedRecordType", "linkedRecordId", "removed", "taskId"], required: false },
  { actionKey: AuditAction.RFI_CREATED, moduleKey: "engineering", category: "ENGINEERING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["rfiNumber", "status", "priority", "contractorId", "workPackageId", "assignedToMemberId", "dueAt"], required: false },
  { actionKey: AuditAction.RFI_UPDATED, moduleKey: "engineering", category: "ENGINEERING", severity: "INFO", snapshotMode: "BEFORE_AFTER", allowFields: ["priority", "discipline", "contractorId", "workPackageId", "assignedToMemberId", "dueAt", "referenceType", "referenceId", "removed"], required: false },
  { actionKey: AuditAction.RFI_OPENED, moduleKey: "engineering", category: "ENGINEERING", severity: "INFO", snapshotMode: "BEFORE_AFTER", allowFields: ["status", "assignedToMemberId", "dueAt"], required: true },
  { actionKey: AuditAction.RFI_RESPONDED, moduleKey: "engineering", category: "ENGINEERING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["status", "responseId", "finalResponse"], required: true },
  { actionKey: AuditAction.RFI_CLARIFICATION_REQUESTED, moduleKey: "engineering", category: "ENGINEERING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["status", "responseId"], required: true },
  { actionKey: AuditAction.RFI_CLOSED, moduleKey: "engineering", category: "ENGINEERING", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["status"], required: true },
  { actionKey: AuditAction.RFI_VOIDED, moduleKey: "engineering", category: "ENGINEERING", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["status"], required: true },
  { actionKey: AuditAction.SUBMITTAL_CREATED, moduleKey: "engineering", category: "ENGINEERING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["submittalNumber", "submittalType", "contractorId", "workPackageId", "assignedReviewerMemberId", "dueAt", "supplierId"], required: false },
  { actionKey: AuditAction.SUBMITTAL_UPDATED, moduleKey: "engineering", category: "ENGINEERING", severity: "INFO", snapshotMode: "BEFORE_AFTER", allowFields: ["title", "submittalType", "discipline", "contractorId", "workPackageId", "assignedReviewerMemberId", "dueAt", "supplierId", "manufacturer", "productName", "modelNumber"], required: false },
  { actionKey: AuditAction.SUBMITTAL_REVISION_CREATED, moduleKey: "engineering", category: "ENGINEERING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["revisionId", "revisionCode", "documentId"], required: false },
  { actionKey: AuditAction.SUBMITTAL_SUBMITTED, moduleKey: "engineering", category: "ENGINEERING", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["revisionId", "revisionCode", "documentId", "documentVersionId", "status"], required: true },
  { actionKey: AuditAction.SUBMITTAL_REVIEWED, moduleKey: "engineering", category: "ENGINEERING", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["revisionId", "revisionCode", "status", "decision"], required: true },
  { actionKey: AuditAction.SUBMITTAL_CLOSED, moduleKey: "engineering", category: "ENGINEERING", severity: "INFO", snapshotMode: "BEFORE_AFTER", allowFields: ["status"], required: true },
  { actionKey: AuditAction.SUBMITTAL_VOIDED, moduleKey: "engineering", category: "ENGINEERING", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["status"], required: true },
  { actionKey: AuditAction.TRANSMITTAL_CREATED, moduleKey: "engineering", category: "ENGINEERING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["transmittalNumber", "direction", "purpose", "contractorId", "workPackageId", "items"], required: false },
  { actionKey: AuditAction.TRANSMITTAL_UPDATED, moduleKey: "engineering", category: "ENGINEERING", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["direction", "purpose", "contractorId", "workPackageId", "items"], required: false },
  { actionKey: AuditAction.TRANSMITTAL_ISSUED, moduleKey: "engineering", category: "ENGINEERING", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["status", "issuedAt", "items"], required: true },
  { actionKey: AuditAction.TRANSMITTAL_VOIDED, moduleKey: "engineering", category: "ENGINEERING", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["status"], required: true },
  { actionKey: AuditAction.ENGINEERING_SETTINGS_UPDATED, moduleKey: "engineering", category: "CONFIGURATION", severity: "IMPORTANT", snapshotMode: "BEFORE_AFTER", allowFields: ["rfiDefaultDueDays", "submittalDefaultReviewDays", "contractorComplianceReminderDays", "dueSoonDays", "allowSelfReview", "requireSubmittalDueDate"], required: true },
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
