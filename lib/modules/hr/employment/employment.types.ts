import type {
  EmploymentAssignmentReason,
  EmploymentChangeStatus,
  EmploymentChangeType,
  EmploymentHistorySource,
  EmploymentStatus,
  EmploymentStatusReason,
  EmploymentType,
  WorkLocationType,
} from "@prisma/client";

import type { Day } from "./employment.dates";

/**
 * Employment history as a reader is allowed to see it (E-03 §68-§70, §126-§131).
 *
 * Separate from the employee record's DTO: the current profile never carries
 * the history (§69, §174). Three views of the same rows — HR's, the employee's
 * own, and nothing at all for a colleague — so what a view may not show is not
 * in its payload rather than hidden in the browser. A document appears only
 * when this reader may open it; otherwise there is no trace of it, not even a
 * name (§130, §131).
 */

export type HistoryView = "HR" | "SELF";

export type HistoryDocumentDTO = { id: string; name: string; href: string };

export type AssignmentRowDTO = {
  id: string;
  startDate: Day;
  endDate: Day | null;
  department: { id: string | null; name: string } | null;
  jobTitle: string | null;
  manager: { memberId: string | null; name: string } | null;
  workLocationType: WorkLocationType | null;
  workLocation: string | null;
  employmentType: EmploymentType;
  reason: EmploymentAssignmentReason;
  source: EmploymentHistorySource;
  document: HistoryDocumentDTO | null;
  /** HR's view only. */
  note: string | null;
  createdBy: string | null;
  supersededAt: string | null;
  correctsId: string | null;
  correctionReason: string | null;
};

export type StatusRowDTO = {
  id: string;
  status: EmploymentStatus;
  effectiveFrom: Day;
  effectiveTo: Day | null;
  reason: EmploymentStatusReason;
  /** Only with `hr.employment_history.view_private` (E-03 §24, §105). */
  privateReason: string | null;
  source: EmploymentHistorySource;
  document: HistoryDocumentDTO | null;
  createdBy: string | null;
  supersededAt: string | null;
  correctsId: string | null;
  correctionReason: string | null;
};

export type ScheduledChangeDTO = {
  id: string;
  type: EmploymentChangeType;
  effectiveDate: Day;
  status: EmploymentChangeStatus;
  summary: string;
  requestedBy: string | null;
  createdAt: string;
  failureReason: string | null;
  cancelReason: string | null;
  canCancel: boolean;
};

export type TimelineChangeDTO = { label: string; from: string | null; to: string | null };

export type TimelineEventKind = EmploymentAssignmentReason | "STATUS_CHANGED" | "TERMINATED";

export type TimelineEventDTO = {
  id: string;
  date: Day;
  kind: TimelineEventKind;
  title: string;
  company: { id: string; name: string };
  /** What the employee held from this date: the card's summary line (E-03 §123). */
  summary: string[];
  changes: TimelineChangeDTO[];
  document: HistoryDocumentDTO | null;
  /** HR's view only (E-03 §126 "created by if privileged"). */
  createdBy: string | null;
  corrected: boolean;
};

export type EmploymentCapabilitiesDTO = {
  canChangePosition: boolean;
  canTransferDepartment: boolean;
  canTransferCompany: boolean;
  canChangeManager: boolean;
  canChangeLocation: boolean;
  canChangeEmploymentType: boolean;
  canChangeStatus: boolean;
  canSchedule: boolean;
  canCorrect: boolean;
  canViewPrivateReason: boolean;
};

export type EmploymentHistoryDTO = {
  view: HistoryView;
  employment: {
    id: string;
    memberId: string | null;
    company: { id: string; name: string; legalName: string | null };
    status: EmploymentStatus;
    startDate: Day | null;
    endDate: Day | null;
  };
  current: AssignmentRowDTO | null;
  assignments: AssignmentRowDTO[];
  statuses: StatusRowDTO[];
  scheduled: ScheduledChangeDTO[];
  timeline: TimelineEventDTO[];
  capabilities: EmploymentCapabilitiesDTO;
};

/** A person's history across the group's companies, as far as this reader may see (E-03 §4, §57, §58). */
export type PersonHistoryDTO = {
  personId: string;
  name: string;
  isSelf: boolean;
  employments: EmploymentHistoryDTO[];
  timeline: TimelineEventDTO[];
};

/** What an applied, scheduled or refused change reports back. */
export type EmploymentChangeResultDTO = {
  outcome: "APPLIED" | "SCHEDULED";
  employmentId: string;
  scheduledChangeId: string | null;
  /** A transfer to a company where the person has no NESTO login yet (E-03 §92): an account request is the next step. */
  needsAccountIn: { companyId: string; companyName: string; employmentId: string } | null;
};

/* Reporting (E-03 §141-§144) ------------------------------------------------ */

export type HeadcountRowDTO = { key: string; label: string; count: number };

export type OrganizationReportDTO = {
  asOf: Day;
  period: { from: Day; to: Day };
  headcount: number;
  byCompany: HeadcountRowDTO[];
  byDepartment: HeadcountRowDTO[];
  byTitle: HeadcountRowDTO[];
  byStatus: HeadcountRowDTO[];
  movements: {
    joiners: number;
    leavers: number;
    promotions: number;
    departmentTransfers: number;
    companyTransfers: number;
    managerChanges: number;
    statusChanges: number;
  };
  tenure: { averageYears: number | null; medianYears: number | null; employees: number };
};
