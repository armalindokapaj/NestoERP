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

  // Access control (PRD #28 §95)
  TEAM_MEMBER_INVITED: "TEAM_MEMBER_INVITED",
  TEAM_MEMBER_ACTIVATED: "TEAM_MEMBER_ACTIVATED",
  TEAM_MEMBER_DEACTIVATED: "TEAM_MEMBER_DEACTIVATED",
  TEAM_MEMBER_SUSPENDED: "TEAM_MEMBER_SUSPENDED",
  TEAM_MEMBER_ROLE_CHANGED: "TEAM_MEMBER_ROLE_CHANGED",
  TEAM_MEMBER_DEPARTMENT_CHANGED: "TEAM_MEMBER_DEPARTMENT_CHANGED",

  // Configuration (PRD #28 §98)
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

  /* Access control ------------------------------------------------------- */
  { actionKey: AuditAction.TEAM_MEMBER_INVITED, moduleKey: "team", category: "ACCESS_CONTROL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["email", "roleKey"], required: true },
  { actionKey: AuditAction.TEAM_MEMBER_ACTIVATED, moduleKey: "team", category: "ACCESS_CONTROL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status"], required: true },
  { actionKey: AuditAction.TEAM_MEMBER_DEACTIVATED, moduleKey: "team", category: "ACCESS_CONTROL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status"], required: true },
  { actionKey: AuditAction.TEAM_MEMBER_SUSPENDED, moduleKey: "team", category: "ACCESS_CONTROL", severity: "IMPORTANT", snapshotMode: "CHANGES", allowFields: ["status"], required: true },
  // Owner transfer is the single highest-risk access change there is (PRD #28 §97).
  { actionKey: AuditAction.TEAM_MEMBER_ROLE_CHANGED, moduleKey: "team", category: "ACCESS_CONTROL", severity: "CRITICAL", snapshotMode: "CHANGES", allowFields: ["roleKey", "roleName"], required: true },
  { actionKey: AuditAction.TEAM_MEMBER_DEPARTMENT_CHANGED, moduleKey: "team", category: "ACCESS_CONTROL", severity: "INFO", snapshotMode: "CHANGES", allowFields: ["departmentId", "departmentName"], required: false },

  /* Configuration -------------------------------------------------------- */
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
