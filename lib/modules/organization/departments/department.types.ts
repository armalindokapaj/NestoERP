/**
 * The shapes of the group's departments as E-13 reads them (§132-§134).
 *
 * Client-safe: types only. Every list here is already cut to what the reader
 * may see; `capabilities` says what they may change, and every change is
 * checked again on the server.
 */

export type DepartmentStatusDTO = "ACTIVE" | "INACTIVE";
export type PositionDTO = "GROUP_HEAD" | "COMPANY_MANAGER" | "MEMBER";

export type CompanySummaryDTO = { id: string; name: string };

export type PersonSummaryDTO = {
  /** The person's profile (`/people/:personId`); null for a login with no person yet. */
  personId: string | null;
  userId: string;
  name: string;
  jobTitle: string | null;
};

/** A head or a manager: the person, and the appointment behind them. */
export type AppointmentDTO = PersonSummaryDTO & { assignmentId: string; since: string | null };

export type GroupDepartmentDTO = {
  id: string;
  key: string;
  code: string;
  name: string;
  description: string | null;
  status: DepartmentStatusDTO;
  /** One of the chart's functions, with roles bound to it; false for one the group added (ADR 0003). */
  bindsRoles: boolean;
  groupHead: AppointmentDTO | null;
  activeCompanyCount: number;
  /** People with a live place in one of its open branches. */
  memberCount: number;
};

export type CompanyDepartmentDTO = {
  id: string;
  groupDepartmentId: string;
  company: CompanySummaryDTO;
  manager: AppointmentDTO | null;
  status: DepartmentStatusDTO;
  memberCount: number;
};

export type DepartmentAssignmentDTO = {
  id: string;
  person: PersonSummaryDTO;
  department: { id: string; code: string; name: string };
  companyDepartment: { id: string; company: CompanySummaryDTO } | null;
  position: PositionDTO;
  scope: "GROUP" | "COMPANY";
  status: "ACTIVE" | "INACTIVE";
  startsAt: string | null;
  endsAt: string | null;
};

/** What this reader may change on one department; each is decided again by the server. */
export type DepartmentCapabilitiesDTO = {
  canConfigure: boolean;
  canAssignHead: boolean;
  /** Companies whose branch this reader may appoint the manager of. */
  managerCompanyIds: string[];
  /** Branches this reader may add people to and take them off. */
  memberBranchIds: string[];
  canViewTeam: boolean;
  canViewAccess: boolean;
};

export type DepartmentCompanyRowDTO = {
  company: CompanySummaryDTO & { status: string };
  branch: CompanyDepartmentDTO | null;
};

export type DepartmentDetailDTO = GroupDepartmentDTO & {
  reach: "GROUP" | "MANAGED" | "COMPANY";
  companies: DepartmentCompanyRowDTO[];
  capabilities: DepartmentCapabilitiesDTO;
};

export type TeamCoverageDTO = {
  assignmentId: string;
  branchId: string;
  company: CompanySummaryDTO;
  position: Exclude<PositionDTO, "GROUP_HEAD">;
  status: "ACTIVE" | "INACTIVE";
  /** Whether they can sign in to that company: a department place is not access (E-13 §29). */
  hasAccess: boolean;
  /** The MEMBER row a manager of this reader's may end; null when this reader may not. */
  removableAssignmentId: string | null;
};

export type TeamMemberDTO = {
  person: PersonSummaryDTO;
  /** The highest position they hold in this department. */
  position: PositionDTO;
  /** The company they work for (their employment's, else their first membership's). */
  primaryCompany: CompanySummaryDTO | null;
  coverage: TeamCoverageDTO[];
  projects: Array<{ projectMemberId: string; projectId: string; code: string; name: string; companyId: string; projectRole: string | null }>;
  /** Projects this reader may put them on, per covered company (E-13 §88); empty when none. */
  assignable: Array<{ companyMemberId: string; company: CompanySummaryDTO; projects: Array<{ id: string; code: string; name: string }> }>;
  canUnassignProjects: boolean;
  status: "ACTIVE" | "NO_ACCESS" | "INACTIVE";
};

export type DepartmentTeamDTO = {
  data: TeamMemberDTO[];
  filters: { companies: CompanySummaryDTO[] };
};

export type CandidateDTO = PersonSummaryDTO & {
  companies: CompanySummaryDTO[];
  /** Whether they can be chosen for what was asked, and if not why. */
  eligible: boolean;
  reason: string | null;
};

export type DepartmentActivityDTO = {
  id: string;
  at: string;
  actionKey: string;
  text: string;
  actor: string | null;
};

export type CompanyDepartmentsDTO = {
  company: CompanySummaryDTO & { status: string };
  rows: Array<{
    department: { id: string; code: string; name: string; status: DepartmentStatusDTO };
    branch: CompanyDepartmentDTO | null;
    canActivate: boolean;
    canAppointManager: boolean;
  }>;
};

/** A person's organizational places, for their profile (E-13 §87). */
export type PersonDepartmentDTO = {
  department: { id: string; code: string; name: string };
  company: CompanySummaryDTO | null;
  position: PositionDTO;
};
