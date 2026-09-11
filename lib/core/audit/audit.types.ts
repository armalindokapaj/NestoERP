import type { AuditActorType, AuditCategory, AuditSeverity } from "@prisma/client";

/**
 * Audit contracts (PRD #28 §29, §135, §355).
 *
 * Severity, category and actor are decided in code. The browser cannot choose
 * how serious its own action was (PRD #28 §147, §216).
 */

export type AuditSnapshotMode = "NONE" | "CHANGES" | "BEFORE_AFTER";

export type AuditPolicy = {
  actionKey: string;
  moduleKey: string;
  category: AuditCategory;
  severity: AuditSeverity;
  snapshotMode: AuditSnapshotMode;
  /** Fields safe to record for this action. Everything else is dropped. */
  allowFields: string[];
  /** Fields recorded as changed without their values (PRD #28 §41, §42). */
  redactFields?: string[];
  /**
   * When true a failed audit write rolls the business mutation back: the action
   * is not allowed to happen unaudited (PRD #28 §49, §136).
   */
  required: boolean;
};

export type AuditActor = {
  type: AuditActorType;
  userId?: string | null;
  memberId?: string | null;
  displayNameSnapshot?: string | null;
  roleSnapshot?: string | null;
};

export type AuditContext = {
  companyId: string;
  actor: AuditActor;
  requestId?: string | null;
  correlationId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type AuditEntityRef = {
  type: string;
  id: string;
  label?: string | null;
};

export type RecordAuditInput = {
  actionKey: string;
  entity?: AuditEntityRef;
  projectId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type AuditChange = { before: unknown; after: unknown };
