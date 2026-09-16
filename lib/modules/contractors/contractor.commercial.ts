import type { UserContext } from "@/lib/context/types";
import { loadRecord, moduleAndPermissions, recordDefinition } from "@/lib/core/records/record.registry";
import { prisma } from "@/lib/database/prisma";
import { fail } from "@/lib/modules/engineering/engineering.shared";
import type { RecordRef } from "@/lib/modules/engineering/engineering.types";

/**
 * The Legal boundary (PRD #46 §28, §37, §50-§58, §245).
 *
 * Contracts stay in Legal. An assignment or work package only points at one,
 * and only somebody who can open that contract may point at it; readers see
 * the contract's number and title only when Legal would show them the contract
 * itself — contractor context never widens Legal access (§53).
 */

export async function assertLinkableContract(context: UserContext, contractId: string | null, projectId: string, current: string | null = null) {
  if (!contractId || contractId === current) return;
  const contract = await loadRecord(context, "contract", contractId);
  if (!contract || contract.companyId !== context.companyId) throw fail("CONTRACT_INVALID", "You cannot link that contract.", "VALIDATION_ERROR", { field: "contractId" });
  if (contract.projectId && contract.projectId !== projectId) throw fail("CONTRACT_PROJECT_MISMATCH", "That contract belongs to another project.", "VALIDATION_ERROR", { field: "contractId" });
  if (contract.archived) throw fail("CONTRACT_ARCHIVED", "That contract is archived.", "VALIDATION_ERROR", { field: "contractId" });
}

/** Contract references this reader may follow, by id (§54). */
export async function visibleContracts(context: UserContext, ids: Array<string | null | undefined>): Promise<Map<string, RecordRef>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const definition = recordDefinition("contract");
  if (!unique.length || !definition || !moduleAndPermissions(context, definition.moduleKey, definition.viewPermissions)) return new Map();
  const reachable = await definition.reachable(context, unique);
  if (!reachable.length) return new Map();
  const rows = await prisma.contract.findMany({ where: { companyId: context.companyId, id: { in: reachable } }, select: { id: true, contractNumber: true, title: true } });
  return new Map(rows.map((row) => [row.id, { id: row.id, label: `${row.contractNumber} · ${row.title}`, href: `/contracts/${row.id}` }]));
}

/** Contracts a writer may attach on this project: reachable in Legal, on this project or on none. */
export async function linkableContractOptions(context: UserContext, projectId: string) {
  const definition = recordDefinition("contract");
  if (!definition || !moduleAndPermissions(context, definition.moduleKey, definition.viewPermissions)) return [];
  const rows = await prisma.contract.findMany({
    where: { companyId: context.companyId, archivedAt: null, OR: [{ projectId }, { projectId: null }], status: { notIn: ["TERMINATED", "EXPIRED", "CANCELLED", "ARCHIVED"] } },
    orderBy: { contractNumber: "asc" },
    take: 200,
    select: { id: true, contractNumber: true, title: true },
  });
  const reachable = new Set(await definition.reachable(context, rows.map((row) => row.id)));
  return rows.filter((row) => reachable.has(row.id)).map((row) => ({ id: row.id, label: `${row.contractNumber} · ${row.title}` }));
}

export type ContractorLegalSummary = {
  contracts: Array<RecordRef & { type: string; status: string; project: string | null; effectiveDate: string | null; expiryDate: string | null; value: string | null; currency: string | null; via: string[] }>;
  obligations: Array<RecordRef & { contract: string; dueDate: string | null; status: string }>;
  amendments: Array<RecordRef & { contract: string; status: string }>;
};

/**
 * The legal side of a contractor, read through Legal's own doors (§52-§58):
 * the contracts its assignments and work packages point at, their open
 * obligations and amendments. The value shows only to commercial readers.
 */
export async function contractorLegalSummary(context: UserContext, contractorId: string): Promise<ContractorLegalSummary> {
  const definition = recordDefinition("contract");
  if (!definition || !moduleAndPermissions(context, definition.moduleKey, definition.viewPermissions)) return { contracts: [], obligations: [], amendments: [] };
  const [assignments, packages] = await Promise.all([
    prisma.projectContractorAssignment.findMany({ where: { companyId: context.companyId, contractorId, contractId: { not: null } }, select: { contractId: true, project: { select: { name: true } } } }),
    prisma.workPackage.findMany({ where: { companyId: context.companyId, contractorId, contractId: { not: null } }, select: { contractId: true, code: true } }),
  ]);
  const via = new Map<string, string[]>();
  for (const row of assignments) via.set(row.contractId!, [...(via.get(row.contractId!) ?? []), `Assignment · ${row.project.name}`]);
  for (const row of packages) via.set(row.contractId!, [...(via.get(row.contractId!) ?? []), `Work package ${row.code}`]);
  const reachable = await definition.reachable(context, [...via.keys()]);
  if (!reachable.length) return { contracts: [], obligations: [], amendments: [] };
  const { buildAmendmentScopeWhere, buildObligationScopeWhere } = await import("@/lib/modules/contracts/contract.scope");
  // Legal's own curtain, and only Legal's: `finance.view` is not a licence to read contract values (PRD #18 §495, PRD #47 §62).
  const { canSeeCommercial } = await import("@/lib/modules/contracts/contract.dto");
  const commercial = canSeeCommercial(context);
  const [contracts, obligations, amendments] = await Promise.all([
    prisma.contract.findMany({ where: { companyId: context.companyId, id: { in: reachable } }, orderBy: { contractNumber: "asc" }, select: { id: true, contractNumber: true, title: true, contractType: true, status: true, effectiveDate: true, expiryDate: true, contractValue: true, currency: true, project: { select: { name: true } } } }),
    prisma.contractObligation.findMany({ where: { AND: [buildObligationScopeWhere(context), { contractId: { in: reachable }, status: "OPEN" }] }, orderBy: { dueDate: { sort: "asc", nulls: "last" } }, take: 50, select: { id: true, title: true, dueDate: true, status: true, contractId: true, contract: { select: { contractNumber: true } } } }),
    prisma.contractAmendment.findMany({ where: { AND: [buildAmendmentScopeWhere(context), { contractId: { in: reachable } }] }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, amendmentNumber: true, title: true, status: true, contractId: true, contract: { select: { contractNumber: true } } } }),
  ]);
  const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
  return {
    contracts: contracts.map((row) => ({ id: row.id, label: `${row.contractNumber} · ${row.title}`, href: `/contracts/${row.id}`, type: row.contractType, status: row.status, project: row.project?.name ?? null, effectiveDate: day(row.effectiveDate), expiryDate: day(row.expiryDate), value: commercial && row.contractValue ? row.contractValue.toFixed(2) : null, currency: commercial ? row.currency : null, via: via.get(row.id) ?? [] })),
    obligations: obligations.map((row) => ({ id: row.id, label: row.title, href: `/contracts/${row.contractId}/obligations`, contract: row.contract.contractNumber, dueDate: day(row.dueDate), status: row.status })),
    amendments: amendments.map((row) => ({ id: row.id, label: `${row.amendmentNumber} · ${row.title}`, href: `/contracts/${row.contractId}/amendments/${row.id}`, contract: row.contract.contractNumber, status: row.status })),
  };
}
