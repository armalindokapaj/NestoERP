import type { Client, ClientStatus, Contact, ContactStatus } from "@prisma/client";

/**
 * Client and contact status rules (PRD #12 §70, §148, §149).
 *
 * Archiving and restoring have their own endpoints and are deliberately absent
 * from the transition table: `ACTIVE → ARCHIVED` through an ordinary update
 * must fail (PRD #12 §68, §71).
 */
const CLIENT_TRANSITIONS: Record<ClientStatus, ClientStatus[]> = {
  ACTIVE: ["INACTIVE"],
  INACTIVE: ["ACTIVE"],
  ARCHIVED: [],
};

/** Statuses a create or edit form may set (PRD #12 §66). */
export const EDITABLE_CLIENT_STATUSES: ClientStatus[] = ["ACTIVE", "INACTIVE"];

export function canTransitionClientStatus(from: ClientStatus, to: ClientStatus): boolean {
  if (from === to) return true;
  return CLIENT_TRANSITIONS[from].includes(to);
}

export function isClientArchived(client: Pick<Client, "status" | "archivedAt">): boolean {
  return client.status === "ARCHIVED" || client.archivedAt !== null;
}

const CONTACT_TRANSITIONS: Record<ContactStatus, ContactStatus[]> = {
  ACTIVE: ["INACTIVE"],
  INACTIVE: ["ACTIVE"],
  ARCHIVED: [],
};

export const EDITABLE_CONTACT_STATUSES: ContactStatus[] = ["ACTIVE", "INACTIVE"];

export function canTransitionContactStatus(from: ContactStatus, to: ContactStatus): boolean {
  if (from === to) return true;
  return CONTACT_TRANSITIONS[from].includes(to);
}

export function isContactArchived(contact: Pick<Contact, "status" | "archivedAt">): boolean {
  return contact.status === "ARCHIVED" || contact.archivedAt !== null;
}

export const clientStatusLabels: Record<ClientStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ARCHIVED: "Archived",
};

export const clientTypeLabels = {
  INDIVIDUAL: "Individual",
  COMPANY: "Company",
  PUBLIC_ENTITY: "Public Entity",
  OTHER: "Other",
} as const;
