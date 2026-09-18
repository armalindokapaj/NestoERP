/**
 * The shapes of a person as the group sees them (E-01 §32, §119-§121; E-08 §67).
 *
 * Three serializers, three endpoints, never one payload trimmed in the browser:
 * the work profile every colleague reads, the employment view HR reads, and the
 * private view only the person and HR read. The work profile carries nothing of
 * the other two — not a salary, not a personal number, not a reason.
 */

/** Safe to show a colleague (E-01 §22): a state, never why. */
export type WorkStatus = "ACTIVE" | "ON_LEAVE" | "SUSPENDED" | "INACTIVE";

export type PersonCardDTO = {
  personId: string;
  name: string;
  preferredName: string | null;
  initials: { firstName: string; lastName: string };
  jobTitle: string | null;
  employingCompany: { id: string; name: string } | null;
  department: { name: string; groupDepartmentKey: string | null } | null;
  workEmail: string | null;
  workPhone: string | null;
  workPhoneExtension: string | null;
  officeLocation: string | null;
  status: WorkStatus;
  activeProjectCount: number;
};

export type PersonPlacementDTO = {
  company: { id: string; name: string };
  role: { key: string; label: string };
  jobTitle: string | null;
  department: string | null;
  positions: string[];
};

export type PersonProjectDTO = {
  /** Only for a project the reader can open: the summary names a project, it does not hand out its id (§44). */
  projectId: string | null;
  code: string;
  name: string;
  company: { id: string; name: string };
  projectRole: string | null;
  status: string;
  joinedAt: string | null;
  leftAt: string | null;
  /** Only when the reader can open it (E-01 §45); the summary is not access (§44). */
  href: string | null;
};

export type PersonActivityDTO = { at: string; kind: "PROJECT_JOINED" | "PROJECT_LEFT" | "POSITION_STARTED" | "POSITION_ENDED"; text: string };

import type { PersonDepartmentDTO } from "@/lib/modules/organization/departments/department.types";

export type WorkProfileDTO = PersonCardDTO & {
  professionalBio: string | null;
  parentGroup: { name: string };
  /** The NESTO role, kept apart from the job title (E-01 §24, E-08 §25). */
  role: { key: string; label: string } | null;
  manager: { personId: string | null; name: string; jobTitle: string | null } | null;
  companies: PersonPlacementDTO[];
  groupPositions: string[];
  /** Every department they hold a place in: department, company, position (E-13 §87). */
  departments: PersonDepartmentDTO[];
  projects: PersonProjectDTO[];
  activity: PersonActivityDTO[];
  /** Which restricted views this reader may open; each is re-checked on its own endpoint. */
  capabilities: {
    isSelf: boolean;
    canEditOwn: boolean;
    canManage: boolean;
    canViewEmployment: boolean;
    /** The employment history of E-03: the person's own, or HR's in scope — never a colleague's (E-03 §56). */
    canViewHistory: boolean;
    canViewPrivate: boolean;
  };
};

export type DirectoryDTO = {
  data: PersonCardDTO[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  /** Whether "include people who no longer work here" is the reader's to choose (E-01 §40). */
  canIncludeInactive: boolean;
};

export type EmploymentViewDTO = {
  id: string;
  company: { id: string; name: string; legalName: string | null; registrationNumber: string | null };
  employeeNumber: string | null;
  status: string;
  type: string;
  startDate: string | null;
  probationEndDate: string | null;
  endDate: string | null;
  workLocation: string | null;
  /** Where the employment says they sit (E-03 §54, §160). */
  department: string | null;
  jobTitle: string | null;
  manager: string | null;
  /** HR's own page for this employment, when the reader may open it; pay is only ever there (E-01 §99). */
  hrHref: string | null;
  compensationHref: string | null;
};

export type PrivateProfileDTO = {
  personalEmail: string | null;
  personalPhone: string | null;
  dateOfBirth: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
};
