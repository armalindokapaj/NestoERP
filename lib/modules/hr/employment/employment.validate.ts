import type { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { findReadableDocument } from "@/lib/modules/documents/document.parent-access";

/**
 * What a change may name (E-03 §80-§84, §113, §114, §202). Every check reads
 * inside the change's own transaction, and a target that fails is refused with
 * the field it came from — never quietly dropped.
 */

/** A department of this company, open, and — for a branch of the group's — its group department open too (§81). */
export async function validateDepartment(tx: Prisma.TransactionClient, companyId: string, departmentId: string): Promise<{ id: string; name: string }> {
  const department = await tx.department.findFirst({
    where: { id: departmentId, companyId },
    select: { id: true, name: true, status: true, groupDepartment: { select: { status: true } } },
  });
  if (!department) throw new AccessError("VALIDATION_ERROR", "That department is not one of this company's.", { field: "departmentId" });
  if (department.status !== "ACTIVE" || (department.groupDepartment && department.groupDepartment.status !== "ACTIVE")) {
    throw new AccessError("VALIDATION_ERROR", `${department.name} is not active in this company.`, { field: "departmentId", code: "DEPARTMENT_INACTIVE" });
  }
  return { id: department.id, name: department.name };
}

/**
 * A manager who is somebody else, working in this company now, and not
 * managed — at any depth — by the person they would manage (§82, §113, §114).
 * The chain is the employment's own: each manager's running employment here
 * names the next. A manager must be of the employment's own company, the
 * same rule leave approval has always routed on (PRD #16 §32).
 */
export async function validateManager(
  tx: Prisma.TransactionClient,
  input: { companyId: string; managerMemberId: string; subjectMemberId: string | null },
): Promise<{ id: string; name: string }> {
  if (input.subjectMemberId && input.managerMemberId === input.subjectMemberId) {
    throw new AccessError("VALIDATION_ERROR", "Somebody cannot be their own manager.", { field: "managerMemberId", code: "SELF_MANAGER" });
  }
  const manager = await tx.companyMember.findFirst({
    where: { id: input.managerMemberId, companyId: input.companyId, status: "ACTIVE" },
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  });
  if (!manager) throw new AccessError("VALIDATION_ERROR", "That manager is not an active member of this company.", { field: "managerMemberId" });

  if (input.subjectMemberId) {
    const seen = new Set<string>([manager.id]);
    let current: string | null = manager.id;
    for (let depth = 0; current && depth < 100; depth += 1) {
      const above: { managerMemberId: string | null } | null = await tx.employeeProfile.findFirst({
        where: { companyId: input.companyId, companyMemberId: current, employmentStatus: { not: "ENDED" } },
        select: { managerMemberId: true },
      });
      current = above?.managerMemberId ?? null;
      if (current === input.subjectMemberId) {
        throw new AccessError("VALIDATION_ERROR", `${manager.user.firstName} ${manager.user.lastName} reports, directly or through others, to the person they would manage.`, {
          field: "managerMemberId",
          code: "MANAGER_CYCLE",
        });
      }
      if (current && seen.has(current)) break;
      if (current) seen.add(current);
    }
  }
  return { id: manager.id, name: `${manager.user.firstName} ${manager.user.lastName}` };
}

/**
 * A supporting document: one canonical document of the employment's company
 * that the person linking it may open (§45-§49, §202, §244). Nothing is copied;
 * the row keeps the document's id. The database's composite key refuses one of
 * another company whatever this says.
 */
export async function validateDocument(context: UserContext, companyId: string, documentId: string): Promise<{ id: string; name: string }> {
  const document = context.companyId === companyId ? await findReadableDocument(context, documentId) : null;
  if (!document || document.companyId !== companyId || document.status !== "ACTIVE") {
    throw new AccessError("VALIDATION_ERROR", "That document is not one you can open in this company.", { field: "documentId", code: "DOCUMENT_UNAVAILABLE" });
  }
  return { id: document.id, name: document.name };
}

/** For the worker, which links nothing new: the document is still there, in the company (§156). */
export async function documentStillThere(tx: Prisma.TransactionClient, companyId: string, documentId: string): Promise<boolean> {
  return (await tx.document.count({ where: { id: documentId, companyId, status: "ACTIVE" } })) > 0;
}
