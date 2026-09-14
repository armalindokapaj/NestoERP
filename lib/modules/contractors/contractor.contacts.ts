import { AccessError, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { fail } from "@/lib/modules/engineering/engineering.shared";
import { contractorDirectoryWhere, contractorsOpen, RECORD } from "./contractor.permissions";
import type { ContactInput } from "./contractor.schema";
import { findReadableContractor } from "./contractor.service";
import type { ContactDTO, ContactRole } from "./contractor.types";

/**
 * Contractor contacts (PRD #46 §20-§24, §213).
 *
 * A contact is a business card, not an account: nobody here signs in, and only
 * what the company needs to reach them is kept (§22, §23). A contact named on a
 * project assignment is deactivated rather than removed, so the assignment's
 * history still says who it was.
 */

const CONTACT_SELECT = { id: true, contractorId: true, name: true, roleTitle: true, contactRole: true, email: true, phone: true, active: true, notes: true } as const;

function toDTO(row: { id: string; name: string; roleTitle: string | null; contactRole: string | null; email: string | null; phone: string | null; active: boolean; notes: string | null }): ContactDTO {
  return { id: row.id, name: row.name, roleTitle: row.roleTitle, contactRole: row.contactRole as ContactRole | null, email: row.email, phone: row.phone, active: row.active, notes: row.notes };
}

export async function listContacts(context: UserContext, contractorId: string): Promise<ContactDTO[]> {
  const contractor = await findReadableContractor(context, contractorId);
  if (!contractorsOpen(context, "contractor_contact.view")) throw new AccessError("FORBIDDEN", "You cannot see contractor contacts.");
  const rows = await prisma.contractorContact.findMany({ where: { companyId: context.companyId, contractorId: contractor.id }, orderBy: [{ active: "desc" }, { name: "asc" }], take: 200, select: CONTACT_SELECT });
  return rows.map(toDTO);
}

async function findManageableContact(context: UserContext, contactId: string) {
  assertPermission(context, "contractor_contact.manage");
  const row = await prisma.contractorContact.findFirst({
    where: { id: contactId, companyId: context.companyId, contractor: { is: contractorDirectoryWhere(context) } },
    select: { ...CONTACT_SELECT, contractor: { select: { id: true, legalName: true, status: true } } },
  });
  if (!row) throw fail("CONTRACTOR_CONTACT_NOT_FOUND", "That contact could not be found.", "NOT_FOUND");
  if (row.contractor.status === "ARCHIVED" || row.contractor.status === "OFFBOARDED") throw fail("CONTRACTOR_READ_ONLY", "Reactivate this contractor before changing its contacts.", "CONFLICT");
  return row;
}

export async function createContact(context: UserContext, contractorId: string, input: ContactInput): Promise<ContactDTO> {
  const contractor = await findReadableContractor(context, contractorId);
  assertPermission(context, "contractor_contact.manage");
  if (contractor.status === "ARCHIVED" || contractor.status === "OFFBOARDED") throw fail("CONTRACTOR_READ_ONLY", "Reactivate this contractor before changing its contacts.", "CONFLICT");
  return prisma.$transaction(async (tx) => {
    const row = await tx.contractorContact.create({ data: { companyId: context.companyId, contractorId: contractor.id, ...input }, select: CONTACT_SELECT });
    await recordUserAction(context, { actionKey: AuditAction.CONTRACTOR_CONTACT_CHANGED, entity: { type: RECORD, id: contractor.id, label: contractor.legalName }, after: { contactId: row.id, name: row.name, contactRole: row.contactRole, active: row.active } }, { tx });
    return toDTO(row);
  });
}

export async function updateContact(context: UserContext, contactId: string, input: ContactInput): Promise<ContactDTO> {
  const contact = await findManageableContact(context, contactId);
  return prisma.$transaction(async (tx) => {
    const row = await tx.contractorContact.update({ where: { id: contact.id }, data: input, select: CONTACT_SELECT });
    await recordUserAction(context, { actionKey: AuditAction.CONTRACTOR_CONTACT_CHANGED, entity: { type: RECORD, id: contact.contractor.id, label: contact.contractor.legalName }, after: { contactId: row.id, name: row.name, contactRole: row.contactRole, active: row.active } }, { tx });
    return toDTO(row);
  });
}

/** Removed when nothing names them; otherwise kept, inactive, for the record (§23). */
export async function removeContact(context: UserContext, contactId: string): Promise<{ removed: boolean }> {
  const contact = await findManageableContact(context, contactId);
  const named = await prisma.projectContractorAssignment.count({ where: { primaryContractorContactId: contact.id } });
  await prisma.$transaction(async (tx) => {
    if (named) await tx.contractorContact.update({ where: { id: contact.id }, data: { active: false } });
    else await tx.contractorContact.delete({ where: { id: contact.id } });
    await recordUserAction(context, { actionKey: AuditAction.CONTRACTOR_CONTACT_CHANGED, entity: { type: RECORD, id: contact.contractor.id, label: contact.contractor.legalName }, after: { contactId: contact.id, removed: !named, active: false } }, { tx });
  });
  return { removed: !named };
}
