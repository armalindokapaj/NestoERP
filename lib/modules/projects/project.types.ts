import type { ProjectPriority, ProjectStatus } from "@prisma/client";

/**
 * Project DTOs (PRD #10 §103, §104).
 *
 * Responses are shaped explicitly rather than handing back a Prisma model, so a
 * field added to the table cannot leak through an API by accident
 * (PRD #8 §118).
 */
export type ProjectSummaryDTO = {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  priority: ProjectPriority | null;
  client: { id: string; name: string } | null;
  projectManager: { memberId: string; fullName: string } | null;
  startDate: string | null;
  endDate: string | null;
  teamSize: number;
  updatedAt: string;
  archivedAt: string | null;
};

export type ProjectDetailDTO = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  preArchiveStatus: ProjectStatus | null;
  priority: ProjectPriority | null;
  client: { id: string; name: string } | null;
  projectManager: {
    memberId: string;
    userId: string;
    fullName: string;
    avatarUrl: string | null;
    /** Surfaced so an inactive manager is never silently hidden (PRD #10 §171). */
    membershipActive: boolean;
  } | null;
  schedule: { startDate: string | null; endDate: string | null };
  location: { address: string | null; city: string | null; country: string | null };
  /** The built area the project publishes, in m² (D-01 §16). */
  builtArea: number | null;
  /** Among the group's key projects on its dashboard (D-01 §31). */
  isKeyProject: boolean;
  /** The managing company, shown in the workspace breadcrumb (E-05A §26). */
  company: { id: string; name: string; parentGroup: { id: string; name: string } };
  projectType: { id: string; name: string } | null;
  coverImageDocumentId: string | null;
  lastActivityAt: string;
  counts: { members: number; openTasks: number; documents: number };
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type ProjectMemberDTO = {
  id: string;
  companyMemberId: string;
  fullName: string;
  email: string | null;
  avatarUrl: string | null;
  roleLabel: string;
  department: string | null;
  jobTitle: string | null;
  projectRole: string | null;
  isPrimary: boolean;
  status: "ACTIVE" | "INACTIVE";
  membershipActive: boolean;
};

export type ProjectActivityDTO = {
  id: string;
  action: string;
  message: string | null;
  actor: string | null;
  actorMemberId: string | null;
  createdAt: string;
};

export type ProjectTaskSummary = {
  open: number;
  inProgress: number;
  blocked: number;
  completed: number;
  overdue: number;
};


/* -------------------------------------------------------------------------- */
/* Projects page (E-05A §37, §41)                                              */
/* -------------------------------------------------------------------------- */

export type PortfolioProjectDTO = {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  href: string;
  /** The managing company, always named (E-05A §9). `isCurrent` is the session's company. */
  company: { id: string; name: string; logoUrl: string | null; isCurrent: boolean };
  /** Null when there is no cover or this reader cannot open its document (E-05A §73). */
  cover: { documentId: string; thumbnailUrl: string } | null;
  location: { city: string | null; country: string | null };
  projectType: { id: string; name: string } | null;
  /**
   * What this person is on the project — their role on its team, or Project
   * Manager — never their job title (E-05A §55). `others` counts the further
   * roles they hold on it, shown as "Architect +1" (§56).
   */
  myProjectRole: { name: string; others: number } | null;
  isFavorite: boolean;
  lastActivityAt: string;
  createdAt: string;
  /** Decided in the project's own company, by permission and scope — never by role name (E-05A §33, §59). */
  permissions: { open: true; edit: boolean; manageStatus: boolean; archive: boolean; favorite: boolean };
  /** The statuses Change Status may offer; empty without the permission. */
  statusMoves: Array<"PENDING" | "ACTIVE" | "FINISHED">;
};

export type PortfolioListDTO = {
  items: PortfolioProjectDTO[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
  meta: {
    /** Every project this person can discover, before search and filters (E-05A §5). */
    visibleProjectCount: number;
    visibleCompanyCount: number;
    /** What the current search and filters match. */
    matchingCount: number;
  };
};

export type PortfolioFilterOptionsDTO = {
  companies: Array<{ id: string; name: string }>;
  roles: Array<{ value: string; label: string }>;
  projectTypes: Array<{ value: string; label: string }>;
  locations: {
    countries: Array<{ value: string; label: string }>;
    cities: Array<{ value: string; label: string }>;
  };
  /** Where `+ New Project` may create (E-05A §30). */
  creatableCompanies: Array<{ id: string; name: string }>;
};

/** One of a company's project types, as the people who keep the list see it (E-05A §62). */
export type ProjectTypeDTO = {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  /** Projects of every status, archived included, that use it. A used type is retired, not deleted. */
  projectCount: number;
};
