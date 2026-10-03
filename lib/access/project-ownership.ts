import { AccessError } from "@/lib/access/guards";

/**
 * Who owns a project (Standalone Project & Deferred Company Assignment PRD §2,
 * §9, §31). A project exists on its own before a company is assigned, so
 * `companyId` is NULL for an unassigned one. The state is derived from that
 * column and never stored, so the two cannot disagree.
 *
 * NULL means "no company yet", never "everyone": every tenant query filters on
 * a concrete companyId, which an unassigned project can never match (§21).
 */
export type ProjectOwnershipState = "UNASSIGNED" | "ASSIGNED";

export function ownershipOf(project: { companyId: string | null }): ProjectOwnershipState {
  return project.companyId === null ? "UNASSIGNED" : "ASSIGNED";
}

/** The explanation shown wherever a company-dependent feature is unavailable (§13). */
export const UNASSIGNED_PROJECT_MESSAGE = "Assign this project to a company to enable company-dependent features.";

/** For code that only makes sense inside a company: an unassigned project fails closed (§13, §21). */
export function assignedCompany<C>(project: { company: C | null }): C {
  if (project.company === null) throw new AccessError("CONFLICT", UNASSIGNED_PROJECT_MESSAGE, { code: "PROJECT_UNASSIGNED" });
  return project.company;
}

export function assignedCompanyId(project: { companyId: string | null }): string {
  if (project.companyId === null) throw new AccessError("CONFLICT", UNASSIGNED_PROJECT_MESSAGE, { code: "PROJECT_UNASSIGNED" });
  return project.companyId;
}

/**
 * For reads that are company-scoped by nature (a person's own projects, a
 * company's portfolio): an unassigned project is simply not there (§21, §42).
 */
export function assignedOnly<T extends { companyId: string | null }>(project: T | null): (T & { companyId: string }) | null {
  return project !== null && project.companyId !== null ? (project as T & { companyId: string }) : null;
}

/** The list form of `assignedOnly`, for a query already scoped to named companies. */
export function assignedOnlyList<T extends { companyId: string | null }>(projects: T[]): (T & { companyId: string })[] {
  return projects.filter((project): project is T & { companyId: string } => project.companyId !== null);
}

/** The same, for rows that carry the company relation instead of its id. */
export function withCompany<T extends { company: unknown }>(rows: T[]): (T & { company: NonNullable<T["company"]> })[] {
  return rows.filter((row): row is T & { company: NonNullable<T["company"]> } => row.company !== null);
}
