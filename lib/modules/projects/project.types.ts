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
/* Projects page (E-05A; Projects Workspace Grid §88)                          */
/* -------------------------------------------------------------------------- */

/**
 * One card on the Projects page (Projects Workspace Grid §42, §88, §89): what
 * the card draws, and nothing it does not.
 */
export type ProjectCardDTO = {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  href: string;
  /** The project's company, always named (§59). `isCurrent`: the company the session works in. */
  company: { id: string; name: string; isCurrent: boolean };
  /** Null when the project records neither a city nor a country (§62). */
  location: { city: string | null; country: string | null } | null;
  /** Null when there is no cover or this reader cannot open its document (E-05A §73). */
  cover: { thumbnailUrl: string } | null;
  /** What the placeholder shows in place of a cover (§44, §47). */
  initials: string;
  isFavorite: boolean;
  /** Whether the project's company has favorites switched on. */
  canFavorite: boolean;
};

/** A key project on the group dashboard (D-01 §31): the card, and its type. */
export type KeyProjectDTO = ProjectCardDTO & { projectType: { id: string; name: string } | null };

export type PortfolioListDTO = {
  items: ProjectCardDTO[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
  meta: {
    /** Every project this person can discover in the workspace, before any search (§15, §18). */
    visibleProjectCount: number;
    /** The companies those projects belong to (§19). */
    visibleCompanyCount: number;
    /** The one company they belong to, when it is one — what the header names (§17, §69). */
    onlyCompany: { id: string; name: string } | null;
    /** What the search matches — the visible count when there is no search (§148). */
    matchingCount: number;
  };
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
