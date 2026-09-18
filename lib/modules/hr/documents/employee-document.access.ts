import type { EmployeeDocumentCategory, EmployeeDocumentVisibility, Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { buildEmployeeScopeWhere } from "@/lib/modules/hr/hr.scope";
import { CATEGORY_RULES, categoriesOfClass, type DocumentClass } from "./employee-document.types";

/**
 * Who may open an employee document (E-02 §7, §33-§46, §105-§111, §120; ADR 0007).
 *
 * Seeing somebody's profile is not seeing their documents (§7), and reaching
 * HR is not reading all of the employee file (§110). A reader in the
 * document's company opens it through one of four doors, each a clause built
 * here and applied in the query that loads the rows — never a list loaded and
 * filtered afterwards (§204-§206):
 *
 *   HR       `hr.document.view`, the employment in their HR scope and not
 *            their own; any visibility but the employee's private one; the
 *            professional file only, unless they also hold
 *            `hr.document.private.view` (contracts, letters, identity) or
 *            `hr.compensation.view` (pay evidence)
 *   self     their own employment, `hr.self.documents`: what is filed for the
 *            employee — never what HR keeps from them
 *   Finance  `hr.document.finance.view`, explicit: pay evidence HR shared with
 *            Finance (EMPLOYEE_HR_FINANCE)
 *   restricted `hr.document.restricted.view`, explicit: what HR marked for
 *            management (RESTRICTED_MANAGEMENT)
 *
 * A file uploaded on the employment and not yet filed has no category, so it
 * is treated as the most private kind: HR-private readers and whoever
 * uploaded it. Company isolation is the first term of every clause.
 */

export const EMPLOYEE_RECORD_TYPE = "employee";

/** What an employee reads of their own file (§105). */
export const SELF_VISIBLE: EmployeeDocumentVisibility[] = ["PRIVATE_EMPLOYEE", "EMPLOYEE_AND_HR", "EMPLOYEE_HR_FINANCE", "GROUP_SUMMARY"];
/** What HR reads, before the category narrows it: all but the employee's own private files (§106). */
export const HR_VISIBLE: EmployeeDocumentVisibility[] = ["EMPLOYEE_AND_HR", "HR_ONLY", "EMPLOYEE_HR_FINANCE", "RESTRICTED_MANAGEMENT", "GROUP_SUMMARY"];

/** The classes a reader reaches as HR: the professional file, plus the private and pay classes where they hold those grants. */
export function hrReadableClasses(context: UserContext): DocumentClass[] {
  if (!can(context, "hr.document.view")) return [];
  const classes: DocumentClass[] = ["PROFESSIONAL"];
  if (can(context, "hr.document.private.view")) classes.push("EMPLOYMENT", "IDENTITY");
  if (can(context, "hr.compensation.view")) classes.push("COMPENSATION");
  return classes;
}

/** The classes a reader may file, change and archive as HR (§49-§52). */
export function hrManageableClasses(context: UserContext): DocumentClass[] {
  const readable = hrReadableClasses(context);
  const classes: DocumentClass[] = [];
  if (readable.includes("PROFESSIONAL") && can(context, "hr.document.create")) classes.push("PROFESSIONAL");
  if (readable.includes("EMPLOYMENT") && can(context, "hr.document.private.manage")) classes.push("EMPLOYMENT", "IDENTITY");
  if (readable.includes("COMPENSATION") && can(context, "hr.compensation.update")) classes.push("COMPENSATION");
  return classes;
}

/**
 * Employments this reader reaches as HR: inside their HR scope, and never their
 * own. Somebody's own file is read through the self door, with the employee's
 * rules — HR does not see what HR keeps from them about themselves, and does
 * not check their own evidence (§74).
 */
export function hrReachWhere(context: UserContext): Prisma.EmployeeProfileWhereInput {
  return { AND: [buildEmployeeScopeWhere(context), { OR: [{ companyMemberId: null }, { companyMemberId: { not: context.membershipId } }] }] };
}

/** The HR door alone, as a clause over the link — what HR's worklists read (§153, §154). Null for none. */
export function hrLinkWhere(context: UserContext): Prisma.EmployeeDocumentLinkWhereInput | null {
  const classes = hrReadableClasses(context);
  if (classes.length === 0) return null;
  return { companyId: context.companyId, employeeProfile: hrReachWhere(context), category: { in: categoriesOfClass(...classes) }, visibility: { in: HR_VISIBLE } };
}

/** The employee documents this reader may open, as a clause over the link — or null for none. */
export function readableLinkWhere(context: UserContext): Prisma.EmployeeDocumentLinkWhereInput | null {
  const branches: Prisma.EmployeeDocumentLinkWhereInput[] = [];

  const hr = hrLinkWhere(context);
  if (hr) branches.push(hr);
  if (can(context, "hr.self.documents")) {
    branches.push({ employeeProfile: { companyMemberId: context.membershipId }, visibility: { in: SELF_VISIBLE }, archivedAt: null });
  }
  if (can(context, "hr.document.finance.view")) {
    branches.push({ category: { in: categoriesOfClass("COMPENSATION") }, visibility: "EMPLOYEE_HR_FINANCE" });
  }
  if (can(context, "hr.document.restricted.view")) {
    branches.push({ visibility: "RESTRICTED_MANAGEMENT" });
  }

  if (branches.length === 0) return null;
  return { companyId: context.companyId, OR: branches };
}

/**
 * Files uploaded on an employment but not yet filed (§54): HR-private readers
 * of employments in their reach, and the person who uploaded each one.
 */
async function unfiledWhere(context: UserContext): Promise<Prisma.DocumentWhereInput | null> {
  const branches: Prisma.DocumentWhereInput[] = [];
  // Whoever uploaded it, until it is filed: they have seen it already.
  if (can(context, "hr.document.create") || can(context, "hr.self.documents.upload")) branches.push({ uploadedByMemberId: context.membershipId });
  if (hrReadableClasses(context).includes("EMPLOYMENT")) {
    const candidates = await prisma.document.groupBy({
      by: ["entityId"],
      where: { companyId: context.companyId, entityType: EMPLOYEE_RECORD_TYPE, employeeDocumentLink: { is: null } },
    });
    const ids = candidates.map((row) => row.entityId).filter((id): id is string => Boolean(id));
    if (ids.length > 0) {
      const reachable = await prisma.employeeProfile.findMany({ where: { AND: [hrReachWhere(context), { companyId: context.companyId, id: { in: ids } }] }, select: { id: true } });
      if (reachable.length > 0) branches.push({ entityId: { in: reachable.map((row) => row.id) } });
    }
  }
  if (branches.length === 0) return null;
  return { companyId: context.companyId, entityType: EMPLOYEE_RECORD_TYPE, employeeDocumentLink: { is: null }, OR: branches };
}

/**
 * The employee documents this reader may open, as a clause over Document — what
 * the Documents module's lists, search and downloads apply for the employee
 * record type (§119, §120, §138, §176). Null for none.
 */
export async function readableEmployeeDocumentWhere(context: UserContext): Promise<Prisma.DocumentWhereInput | null> {
  const link = readableLinkWhere(context);
  const unfiled = await unfiledWhere(context);
  const branches: Prisma.DocumentWhereInput[] = [];
  if (link) branches.push({ companyId: context.companyId, entityType: EMPLOYEE_RECORD_TYPE, employeeDocumentLink: { is: link } });
  if (unfiled) branches.push(unfiled);
  if (branches.length === 0) return null;
  return { OR: branches };
}

/* -------------------------------------------------------------------------- */
/* Changing                                                                    */
/* -------------------------------------------------------------------------- */

/** Whether this is the reader's own employment here: the login it names is theirs. */
export async function isOwnEmployment(context: UserContext, employmentId: string): Promise<boolean> {
  return (await prisma.employeeProfile.count({ where: { companyId: context.companyId, id: employmentId, companyMemberId: context.membershipId } })) > 0;
}

/** Whether HR reaches this employment — in scope and not their own. */
export async function hrReachesEmployment(context: UserContext, employmentId: string): Promise<boolean> {
  if (!can(context, "hr.document.view")) return false;
  return (await prisma.employeeProfile.count({ where: { AND: [hrReachWhere(context), { companyId: context.companyId, id: employmentId }] } })) > 0;
}

/**
 * May this reader change the file itself — a new version, its name, archiving
 * the Document — through the Documents module (§63, §67, §200)?
 *
 * An employee file is HR's record: HR with the right to manage its category;
 * the employee only for a professional document they filed themselves, or
 * their own upload not yet filed. Nobody else, whatever they may read.
 */
export async function canChangeEmployeeDocument(context: UserContext, documentId: string): Promise<boolean> {
  const document = await prisma.document.findFirst({
    where: { companyId: context.companyId, id: documentId, entityType: EMPLOYEE_RECORD_TYPE },
    select: { entityId: true, uploadedByMemberId: true, employeeDocumentLink: { select: { category: true, createdByMemberId: true, archivedAt: true } } },
  });
  if (!document?.entityId) return false;
  const link = document.employeeDocumentLink;
  if (await hrReachesEmployment(context, document.entityId)) {
    if (!link) return hrReadableClasses(context).includes("EMPLOYMENT") || document.uploadedByMemberId === context.membershipId;
    return hrManageableClasses(context).includes(CATEGORY_RULES[link.category].class);
  }
  if (!can(context, "hr.self.documents.upload") || !(await isOwnEmployment(context, document.entityId))) return false;
  if (!link) return document.uploadedByMemberId === context.membershipId;
  return CATEGORY_RULES[link.category].selfUpload && link.createdByMemberId === context.membershipId && link.archivedAt === null;
}

/** The categories this reader may add for an employment, with the visibilities they may choose (§47-§53). */
export function addableCategories(context: UserContext, via: "HR" | "SELF"): Array<{ category: EmployeeDocumentCategory; visibilities: EmployeeDocumentVisibility[] }> {
  const categories = Object.keys(CATEGORY_RULES) as EmployeeDocumentCategory[];
  if (via === "SELF") {
    if (!can(context, "hr.self.documents.upload")) return [];
    // The employee may keep their own upload from HR; never pick what is HR's to set (§32, §33).
    return categories
      .filter((category) => CATEGORY_RULES[category].selfUpload)
      .map((category) => ({ category, visibilities: CATEGORY_RULES[category].visibilities.filter((visibility) => visibility !== "HR_ONLY" && visibility !== "RESTRICTED_MANAGEMENT") }));
  }
  const classes = hrManageableClasses(context);
  return categories
    .filter((category) => classes.includes(CATEGORY_RULES[category].class))
    // HR does not file a document it could not then see.
    .map((category) => ({ category, visibilities: CATEGORY_RULES[category].visibilities.filter((visibility) => visibility !== "PRIVATE_EMPLOYEE") }));
}
