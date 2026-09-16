import { invalidRecordLink } from "@/lib/access/guards";
import { prisma } from "@/lib/database/prisma";

/**
 * Linked-record checks shared by every module (PRD #47 §20, §21, §50, §51, §62).
 *
 * A body field such as `assigneeMemberId` or `incidentId` is a claim made by
 * the client. Before it is written, the server confirms the record it names
 * belongs to the caller's company — and, for project work, to the same project.
 * A database foreign key cannot do this: it proves the row exists, not whose it
 * is. Modules check record links through their own scope builders; these cover
 * the two shapes that recur everywhere.
 */

/**
 * Every non-empty id is a member of this company (active unless told
 * otherwise), or the whole write is refused naming the field.
 */
export async function assertCompanyMembers(
  companyId: string,
  field: string,
  memberIds: ReadonlyArray<string | null | undefined>,
  options: { activeOnly?: boolean } = {},
): Promise<void> {
  const ids = [...new Set(memberIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  const found = await prisma.companyMember.count({
    where: { id: { in: ids }, companyId, ...(options.activeOnly === false ? {} : { status: "ACTIVE" }) },
  });
  if (found !== ids.length) throw invalidRecordLink(field, "CROSS_COMPANY_REFERENCE", "Choose a member of your company.");
}

/**
 * A linked record belongs to the same project as the record it is linked from
 * (§51). `allowUnlinked` accepts a record that belongs to no project at all,
 * for the links where a company-level record is legitimate.
 */
export function assertSameProject(
  field: string,
  expectedProjectId: string | null | undefined,
  linkedProjectId: string | null | undefined,
  options: { allowUnlinked?: boolean } = {},
): void {
  if ((expectedProjectId ?? null) === (linkedProjectId ?? null)) return;
  if (options.allowUnlinked && !linkedProjectId) return;
  throw invalidRecordLink(field, "CROSS_PROJECT_REFERENCE");
}
