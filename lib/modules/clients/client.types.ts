import type { ClientStatus, ClientType, ContactStatus } from "@prisma/client";

/**
 * Client DTOs (PRD #12 §115–§117).
 *
 * Responses are shaped explicitly rather than handing back a Prisma model, so a
 * field added to the table cannot leak through an API by accident.
 */
export type ClientContactSummary = {
  id: string;
  fullName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
};

export type ClientSummaryDTO = {
  id: string;
  code: string | null;
  name: string;
  legalName: string | null;
  type: ClientType;
  status: ClientStatus;
  primaryContact: ClientContactSummary | null;
  /**
   * Projects this viewer can actually open — never the company-wide total, or
   * the count itself would leak (PRD #12 §93, §141).
   */
  activeProjectsCount: number;
  country: string | null;
  updatedAt: string;
};

export type ClientDetailDTO = {
  id: string;
  code: string | null;
  name: string;
  legalName: string | null;
  type: ClientType;
  status: ClientStatus;
  preArchiveStatus: ClientStatus | null;

  contact: { email: string | null; phone: string | null; website: string | null };
  address: { address: string | null; city: string | null; country: string | null };

  primaryContact: (ClientContactSummary & { status: ContactStatus }) | null;

  counts: { visibleProjects: number; visibleDocuments: number; activeContacts: number };

  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;

  /**
   * Server-derived UX hints. The frontend must not treat these as security —
   * every mutation re-checks authorisation.
   */
  capabilities: {
    canEdit: boolean;
    canArchive: boolean;
    canRestore: boolean;
    canViewContacts: boolean;
    canManageContacts: boolean;
    canViewProjects: boolean;
    canViewDocuments: boolean;
    canViewActivity: boolean;
    canViewFinance: boolean;
  };
};

export type ContactDTO = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  status: ContactStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type ClientActivityDTO = {
  id: string;
  action: string;
  message: string | null;
  actor: string | null;
  createdAt: string;
};

/** The Clients overview counters (PRD #12 §7, §8). */
export type ClientOverviewStats = {
  active: number;
  withActiveProjects: number;
  addedThisMonth: number;
  archived: number;
};
