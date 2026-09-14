import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import type { UserContext } from "@/lib/context/types";

/**
 * The business-record registry contract (PRD #38 §28, §29, §52, §53).
 *
 * One definition per kind of record NESTO lets people attach files to, discuss,
 * or be notified about. Documents, collaboration and notification deep links
 * all read the same definition, so "may this person see this record?" has one
 * answer in the product rather than one per feature — the drift PRD #38 §52
 * exists to end.
 */

/** A record as one reader is allowed to see it. */
export type RecordSummary = {
  type: RecordType;
  id: string;
  companyId: string;
  /** What to call it in a notification, a breadcrumb or a comment thread. */
  label: string;
  /** The record's own page. */
  href: string;
  projectId: string | null;
  /** Archived records stay readable, but take no new comments or files. */
  archived: boolean;
  /**
   * Still open to discussion, but its evidence is fixed: a submitted, reviewed
   * or locked daily log takes no new files (PRD #43 §192, §261).
   */
  filesClosed?: boolean;
  /**
   * The people naturally responsible for it — owner, assignee, reporter,
   * creator — who are subscribed to its discussion automatically (PRD #38 §33).
   */
  stakeholderMemberIds: string[];
};

export type DocumentCapability = {
  /** Permissions needed to read files on this record, beyond `document.view` and the record itself. */
  view: Permission[];
  /**
   * Permissions needed to add a file, beyond `document.create` and the record.
   * `null` means the record type deliberately takes no uploads, and no page may
   * offer "Add document" for it (PRD #38 §54, §55).
   */
  upload: Permission[] | null;
  /** Where the record's files are listed — the return route after an upload. */
  tabHref(summary: RecordSummary): string;
  /** A second door for somebody reading their own record (HR self-service). */
  self?: { permission: Permission; isSelf(context: UserContext, id: string): boolean };
  /** Whether a version of a file on this record can be sent for review (PRD #38 §59). */
  reviewable: boolean;
};

export type CollaborationCapability = {
  /** Permissions beyond reading the record, for records whose discussion is more confidential than the record. */
  requires: Permission[];
};

export type RecordDefinition = {
  type: RecordType;
  moduleKey: ModuleKey;
  /** Singular noun, sentence case. */
  noun: string;
  /** The entity type this record's module writes its Activity under, so collaboration lands in the same feed. */
  activityEntityType: string;
  /** The page prefix when a record's page is `route/id`; absent when it nests under another record. */
  route?: string;
  /** Permissions needed to read a record of this kind at all. */
  viewPermissions: Permission[];
  /**
   * Loads the record inside the reader's own scope. Absent, in another company,
   * out of scope — all answer null, identically (PRD #38 §82, §89).
   */
  find(context: UserContext, id: string): Promise<RecordSummary | null>;
  /**
   * Of these ids, the ones this reader may see — the same clause as `find`, in
   * one query. Used where a list has to be filtered by record access, such as
   * the company document list (PRD #38 §66).
   */
  reachable(context: UserContext, ids: string[]): Promise<string[]>;
  documents: DocumentCapability | null;
  collaboration: CollaborationCapability | null;
};

export const RECORD_TYPES = [
  "project",
  "client",
  "task",
  "document",
  "invoice",
  "expense",
  "budget",
  "commitment",
  "employee",
  "leave_request",
  "lead",
  "opportunity",
  "proposal",
  "contract",
  "amendment",
  "obligation",
  "purchase_request",
  "rfq",
  "purchase_order",
  "goods_receipt",
  "supplier",
  "inventory_item",
  "warehouse",
  "inventory_receipt",
  "stock_issue",
  "stock_adjustment",
  "quality_inspection",
  "quality_defect",
  "non_conformance_report",
  "corrective_action",
  "hse_inspection",
  "hazard",
  "incident",
  "risk_assessment",
  "hse_action",
  "toolbox_talk",
  "work_permit",
  "environmental_observation",
  "stop_work",
  "calendar_event",
  "meeting",
  "timesheet",
  "daily_log",
  "project_milestone",
  "approval_delegation",
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];

export function isRecordType(value: string): value is RecordType {
  return (RECORD_TYPES as readonly string[]).includes(value);
}
