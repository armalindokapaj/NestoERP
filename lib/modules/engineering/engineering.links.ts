import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { loadRecord, moduleAndPermissions, recordDefinition } from "@/lib/core/records/record.registry";
import type { RecordSummary } from "@/lib/core/records/record.types";
import { prisma } from "@/lib/database/prisma";
import { readableComplianceWhere } from "@/lib/modules/contractors/contractor.permissions";
import { classifyDocumentParent } from "@/lib/modules/documents/document.parent-access";
import { createTaskSchema } from "@/lib/modules/tasks/task.schema";
import { createTaskFromContext } from "@/lib/modules/tasks/task.service";
import { findReadableWorkPackage } from "@/lib/modules/work-packages/work-package.service";
import { LINK_TYPE, MODULE, readableEngineeringDocumentWhere, readableRfiWhere, readableSubmittalWhere } from "./engineering.permissions";
import { loadRevisionParent } from "./engineering.revisions";
import type { CreateTaskFromRecordInput } from "./engineering.schema";
import { dateLabel, dateOf, fail, projectArchived } from "./engineering.shared";
import { LINKABLE_LABELS, type LinkableType, type LinkedRecordDTO, type Option } from "./engineering.types";
import { linkReference, unlinkReference } from "@/lib/core/integrations/integration.service";

/**
 * What engineering records and work packages point at (PRD #46 §79, §111-§113,
 * §133-§155, §293-§298, §305).
 *
 * A link is a reference through an integration link: it changes nothing on the
 * other record — an approved method statement does not close an HSE permit, a
 * work package does not raise a purchase order. Each link is made only to a
 * record the writer can open, on the same project, and every reader afterwards
 * sees only the links they could follow themselves. Tasks are always created
 * by the task service, with the record as their parent (§134).
 */

export type LinkSourceType = "work_package" | "engineering_document" | "technical_submittal";
export type TaskSourceType = LinkSourceType | "rfi" | "contractor_compliance";

type Source = { type: TaskSourceType; id: string; projectId: string | null; label: string; writable: boolean; module: "contractors" | "engineering" };

async function loadSource(context: UserContext, type: TaskSourceType, id: string): Promise<Source> {
  switch (type) {
    case "work_package": {
      const row = await findReadableWorkPackage(context, id);
      const live = !row.archivedAt && !projectArchived(row.project);
      return { type, id: row.id, projectId: row.projectId, label: `${row.code} · ${row.name}`, writable: live && can(context, "work_package.edit"), module: "contractors" };
    }
    case "engineering_document":
    case "technical_submittal": {
      const parent = await loadRevisionParent(context, type === "engineering_document" ? "document" : "submittal", id);
      const live = !projectArchived(parent.project) && parent.status !== "VOID";
      return { type, id: parent.id, projectId: parent.projectId, label: `${parent.number} · ${parent.title}`, writable: live && can(context, type === "engineering_document" ? "engineering_document.edit" : "submittal.edit"), module: "engineering" };
    }
    case "rfi": {
      assertModule(context, MODULE);
      const row = await prisma.rfi.findFirst({ where: { AND: [readableRfiWhere(context), { id }] }, select: { id: true, projectId: true, rfiNumber: true, subject: true, status: true, project: { select: { archivedAt: true, status: true } } } });
      if (!row) throw fail("RFI_NOT_FOUND", "That RFI could not be found.", "NOT_FOUND");
      const live = !projectArchived(row.project) && row.status !== "VOID";
      return { type, id: row.id, projectId: row.projectId, label: `${row.rfiNumber} · ${row.subject}`, writable: live && (can(context, "rfi.edit") || can(context, "rfi.respond")), module: "engineering" };
    }
    case "contractor_compliance": {
      const row = await prisma.contractorComplianceItem.findFirst({ where: { AND: [readableComplianceWhere(context), { id }] }, select: { id: true, title: true, archivedAt: true, contractor: { select: { legalName: true } } } });
      if (!row) throw fail("COMPLIANCE_NOT_FOUND", "That compliance item could not be found.", "NOT_FOUND");
      return { type, id: row.id, projectId: null, label: `${row.title} · ${row.contractor.legalName}`, writable: !row.archivedAt && can(context, "contractor_compliance.manage"), module: "contractors" };
    }
  }
}

/**
 * Where a linked record really sits: `{ projectId }` — null for a record that
 * belongs to no project at all — or null when that cannot be shown to this
 * writer (PRD #46 §305, PRD #47 §50, §51).
 *
 * The registry summary's own `projectId` is not always the whole answer:
 *
 *  - a file uploaded onto a contract, NCR, inspection, daily log or RFI carries
 *    no project of its own — its parent does. Reading the column off the
 *    document waved through a file on another project's contract, so a
 *    document is placed by its parent, read through the registry in the
 *    writer's own scope. Only a file with no parent at all is company-level;
 *    one filed on a client, or on a record that sits on no project, is not
 *    this project's either;
 *  - an obligation or amendment sits on its contract's project;
 *  - a task raised from a record, without a project of its own, sits on that
 *    record's.
 *
 * A parent the writer cannot open proves nothing, so it places nothing.
 */
export async function linkedRecordProject(context: UserContext, record: RecordSummary, depth = 0): Promise<{ projectId: string | null } | null> {
  if (depth > 2) return null;
  const companyId = context.companyId;
  switch (record.type) {
    case "obligation": {
      const row = await prisma.contractObligation.findFirst({ where: { id: record.id, companyId }, select: { contract: { select: { projectId: true } } } });
      return row ? { projectId: row.contract.projectId } : null;
    }
    case "amendment": {
      const row = await prisma.contractAmendment.findFirst({ where: { id: record.id, companyId }, select: { contract: { select: { projectId: true } } } });
      return row ? { projectId: row.contract.projectId } : null;
    }
    case "document": {
      const row = await prisma.document.findFirst({ where: { id: record.id, companyId }, select: { projectId: true, clientId: true, module: true, entityType: true, entityId: true } });
      if (!row) return null;
      const parent = classifyDocumentParent(row);
      if (parent.kind === "company") return { projectId: null };
      if (parent.kind === "project") return { projectId: parent.projectId };
      if (parent.kind !== "record") return null;
      const owner = await loadRecord(context, parent.type, parent.id);
      const placed = owner ? await linkedRecordProject(context, owner, depth + 1) : null;
      if (!placed?.projectId) return null;
      // A file whose own project disagrees with its parent's is not trusted either way.
      return row.projectId && row.projectId !== placed.projectId ? null : placed;
    }
    case "task": {
      if (record.projectId) return { projectId: record.projectId };
      const row = await prisma.task.findFirst({ where: { id: record.id, companyId }, select: { entityType: true, entityId: true } });
      if (!row?.entityType || !row.entityId) return { projectId: null };
      const owner = await loadRecord(context, row.entityType, row.entityId);
      return owner ? linkedRecordProject(context, owner, depth + 1) : null;
    }
    default:
      return { projectId: record.projectId };
  }
}

export async function listLinks(context: UserContext, sourceType: LinkSourceType, sourceId: string): Promise<LinkedRecordDTO[]> {
  // The source first: links on a record the reader cannot open are not theirs to list (§247).
  await loadSource(context, sourceType, sourceId);
  const links = await prisma.integrationLink.findMany({
    where: { companyId: context.companyId, integrationType: LINK_TYPE, sourceEntityType: sourceType, sourceEntityId: sourceId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, targetEntityType: true, targetEntityId: true },
  });
  const resolved = await Promise.all(
    links.map(async (link) => {
      // The reader's own door, every time: a link never shows what they could not open (§205).
      const record = await loadRecord(context, link.targetEntityType, link.targetEntityId);
      if (!record) return null;
      const type = link.targetEntityType as LinkableType;
      return { linkId: link.id, type, typeLabel: LINKABLE_LABELS[type] ?? record.type, id: record.id, label: record.label, href: record.href };
    }),
  );
  return resolved.filter((row): row is LinkedRecordDTO => row !== null);
}

export async function linkRecord(context: UserContext, sourceType: LinkSourceType, sourceId: string, input: { type: LinkableType; recordId: string }): Promise<{ linkId: string }> {
  const source = await loadSource(context, sourceType, sourceId);
  if (!source.writable) throw new AccessError("FORBIDDEN", "You cannot change this record's links.", { code: "ENGINEERING_LINK_FORBIDDEN" });
  if (input.type === sourceType && input.recordId === sourceId) throw fail("ENGINEERING_LINK_SELF", "A record cannot link to itself.");
  const definition = recordDefinition(input.type);
  const target = definition ? await loadRecord(context, input.type, input.recordId) : null;
  if (!definition || !target || target.companyId !== context.companyId) throw fail("ENGINEERING_LINK_INVALID", "You cannot link that record.", "NOT_FOUND");
  const placed = await linkedRecordProject(context, target);
  if (!placed) throw fail("ENGINEERING_LINK_PROJECT_MISMATCH", "Choose a record from this project.", "VALIDATION_ERROR", { field: "recordId" }, "CROSS_PROJECT_REFERENCE");
  if (placed.projectId && placed.projectId !== source.projectId) throw fail("ENGINEERING_LINK_PROJECT_MISMATCH", "That record belongs to another project.", "VALIDATION_ERROR", { field: "recordId" }, "CROSS_PROJECT_REFERENCE");

  return prisma.$transaction(async (tx) => {
    const link = await linkReference(tx, context, {
      integrationType: LINK_TYPE,
      source: { module: source.module, entityType: sourceType, id: source.id },
      target: { module: definition.moduleKey, entityType: input.type, id: target.id },
    });
    await recordUserAction(context, { actionKey: AuditAction.ENGINEERING_LINK_CHANGED, entity: { type: sourceType, id: source.id, label: source.label }, projectId: source.projectId, after: { linkedRecordType: input.type, linkedRecordId: target.id } }, { tx });
    return { linkId: link.id };
  });
}

export async function unlinkRecord(context: UserContext, sourceType: LinkSourceType, sourceId: string, linkId: string): Promise<void> {
  const source = await loadSource(context, sourceType, sourceId);
  if (!source.writable) throw new AccessError("FORBIDDEN", "You cannot change this record's links.", { code: "ENGINEERING_LINK_FORBIDDEN" });
  const link = await prisma.integrationLink.findFirst({ where: { id: linkId, companyId: context.companyId, integrationType: LINK_TYPE, sourceEntityType: sourceType, sourceEntityId: source.id, status: "ACTIVE" }, select: { id: true, targetEntityType: true, targetEntityId: true } });
  if (!link) throw fail("ENGINEERING_LINK_NOT_FOUND", "That link could not be found.", "NOT_FOUND");
  await prisma.$transaction(async (tx) => {
    await unlinkReference(tx, context, { integrationType: LINK_TYPE, linkId: link.id, source: { entityType: sourceType, id: source.id } });
    await recordUserAction(context, { actionKey: AuditAction.ENGINEERING_LINK_CHANGED, entity: { type: sourceType, id: source.id, label: source.label }, projectId: source.projectId, after: { linkedRecordType: link.targetEntityType, linkedRecordId: link.targetEntityId, removed: true } }, { tx });
  });
}

/* -------------------------------------------------------------------------- */
/* Pickers                                                                     */
/* -------------------------------------------------------------------------- */

type Candidate = { id: string; label: string };

/** Up to a hundred candidates of one type on a project, before the reader's own door filters them. */
async function candidates(context: UserContext, type: LinkableType, projectId: string): Promise<Candidate[]> {
  const companyId = context.companyId;
  const take = 100;
  switch (type) {
    case "engineering_document":
      return (await prisma.engineeringDocument.findMany({ where: { AND: [readableEngineeringDocumentWhere(context), { projectId, status: { not: "VOID" } }] }, orderBy: { documentNumber: "asc" }, take: 300, select: { id: true, documentNumber: true, title: true } })).map((row) => ({ id: row.id, label: `${row.documentNumber} · ${row.title}` }));
    case "technical_submittal":
      return (await prisma.technicalSubmittal.findMany({ where: { AND: [readableSubmittalWhere(context), { projectId, status: { not: "VOID" } }] }, orderBy: { submittalNumber: "asc" }, take: 300, select: { id: true, submittalNumber: true, title: true } })).map((row) => ({ id: row.id, label: `${row.submittalNumber} · ${row.title}` }));
    case "task":
      return (await prisma.task.findMany({ where: { companyId, projectId, archivedAt: null }, orderBy: { updatedAt: "desc" }, take, select: { id: true, title: true } })).map((row) => ({ id: row.id, label: row.title }));
    case "meeting":
      return (await prisma.meeting.findMany({ where: { companyId, projectId, archivedAt: null }, orderBy: { startsAt: "desc" }, take, select: { id: true, title: true, startsAt: true } })).map((row) => ({ id: row.id, label: `${row.title} · ${dateLabel(dateOf(row.startsAt))}` }));
    case "daily_log":
      return (await prisma.dailyLog.findMany({ where: { companyId, projectId, status: { not: "VOID" } }, orderBy: { workDate: "desc" }, take, select: { id: true, workDate: true } })).map((row) => ({ id: row.id, label: `Daily log · ${dateLabel(dateOf(row.workDate))}` }));
    case "quality_inspection":
      return (await prisma.qualityInspection.findMany({ where: { companyId, projectId }, orderBy: { createdAt: "desc" }, take, select: { id: true, inspectionNumber: true } })).map((row) => ({ id: row.id, label: `Inspection ${row.inspectionNumber}` }));
    case "quality_defect":
      return (await prisma.qualityDefect.findMany({ where: { companyId, projectId }, orderBy: { createdAt: "desc" }, take, select: { id: true, defectNumber: true, title: true } })).map((row) => ({ id: row.id, label: `${row.defectNumber} · ${row.title}` }));
    case "non_conformance_report":
      return (await prisma.nonConformanceReport.findMany({ where: { companyId, projectId }, orderBy: { createdAt: "desc" }, take, select: { id: true, ncrNumber: true, title: true } })).map((row) => ({ id: row.id, label: `${row.ncrNumber} · ${row.title}` }));
    case "incident":
      return (await prisma.hseIncident.findMany({ where: { companyId, projectId }, orderBy: { createdAt: "desc" }, take, select: { id: true, incidentNumber: true, title: true } })).map((row) => ({ id: row.id, label: `${row.incidentNumber} · ${row.title}` }));
    case "hazard":
      return (await prisma.hseHazard.findMany({ where: { companyId, projectId }, orderBy: { createdAt: "desc" }, take, select: { id: true, hazardNumber: true, title: true } })).map((row) => ({ id: row.id, label: `${row.hazardNumber} · ${row.title}` }));
    case "risk_assessment":
      return (await prisma.hseRiskAssessment.findMany({ where: { companyId, projectId, archivedAt: null }, orderBy: { createdAt: "desc" }, take, select: { id: true, assessmentNumber: true, title: true } })).map((row) => ({ id: row.id, label: `${row.assessmentNumber} · ${row.title}` }));
    case "work_permit":
      return (await prisma.hseWorkPermit.findMany({ where: { companyId, projectId }, orderBy: { createdAt: "desc" }, take, select: { id: true, permitNumber: true, title: true } })).map((row) => ({ id: row.id, label: `${row.permitNumber} · ${row.title}` }));
    case "toolbox_talk":
      return (await prisma.toolboxTalk.findMany({ where: { companyId, projectId }, orderBy: { createdAt: "desc" }, take, select: { id: true, talkNumber: true, title: true } })).map((row) => ({ id: row.id, label: `${row.talkNumber} · ${row.title}` }));
    case "purchase_order":
      return (await prisma.purchaseOrder.findMany({ where: { companyId, projectId, archivedAt: null }, orderBy: { createdAt: "desc" }, take, select: { id: true, poNumber: true } })).map((row) => ({ id: row.id, label: `Purchase order ${row.poNumber}` }));
    case "obligation":
      return (await prisma.contractObligation.findMany({ where: { companyId, contract: { projectId } }, orderBy: { dueDate: "asc" }, take, select: { id: true, title: true } })).map((row) => ({ id: row.id, label: row.title }));
    case "amendment":
      return (await prisma.contractAmendment.findMany({ where: { companyId, contract: { projectId }, archivedAt: null }, orderBy: { createdAt: "desc" }, take, select: { id: true, amendmentNumber: true, title: true } })).map((row) => ({ id: row.id, label: `${row.amendmentNumber} · ${row.title}` }));
  }
}

/** Records of this type the writer could link here — each one they can open, on this project, not yet linked. */
export async function linkOptions(context: UserContext, sourceType: LinkSourceType, sourceId: string, type: LinkableType): Promise<Option[]> {
  const source = await loadSource(context, sourceType, sourceId);
  if (!source.writable || !source.projectId) return [];
  const definition = recordDefinition(type);
  if (!definition || !moduleAndPermissions(context, definition.moduleKey, definition.viewPermissions)) return [];
  const [rows, existing] = await Promise.all([
    candidates(context, type, source.projectId),
    prisma.integrationLink.findMany({ where: { companyId: context.companyId, integrationType: LINK_TYPE, sourceEntityType: sourceType, sourceEntityId: source.id, targetEntityType: type, status: "ACTIVE" }, select: { targetEntityId: true } }),
  ]);
  const linked = new Set(existing.map((row) => row.targetEntityId));
  const open = rows.filter((row) => !linked.has(row.id) && !(type === sourceType && row.id === source.id));
  const reachable = new Set(await definition.reachable(context, open.map((row) => row.id)));
  return open.filter((row) => reachable.has(row.id));
}

/** Which link types this reader could use at all: the module is on and they can read that kind of record. */
export function linkableTypesFor(context: UserContext, types: readonly LinkableType[]): LinkableType[] {
  return types.filter((type) => {
    const definition = recordDefinition(type);
    return Boolean(definition && moduleAndPermissions(context, definition.moduleKey, definition.viewPermissions));
  });
}

/* -------------------------------------------------------------------------- */
/* Tasks                                                                       */
/* -------------------------------------------------------------------------- */

/** `+ Create Task` from an RFI, submittal, document, compliance item or work package — always the task service (§93, §133-§136, §293). */
export async function createTaskFromRecord(context: UserContext, sourceType: TaskSourceType, sourceId: string, input: CreateTaskFromRecordInput): Promise<{ taskId: string; href: string }> {
  const source = await loadSource(context, sourceType, sourceId);
  if (!source.writable) throw new AccessError("FORBIDDEN", "You cannot raise tasks from this record.", { code: "ENGINEERING_TASK_FORBIDDEN" });
  assertPermission(context, "task.create");
  const task = await createTaskFromContext(context, {
    ...createTaskSchema.parse({ title: input.title, description: input.description ?? undefined, projectId: source.projectId ?? undefined, assigneeMemberId: input.assigneeMemberId ?? undefined, status: "TODO", priority: input.priority, dueDate: input.dueDate ?? undefined }),
    parentType: sourceType,
    parentId: source.id,
  });
  return { taskId: task.id, href: `/tasks/${task.id}` };
}

/** Tasks raised from a record, as this reader can see them (§79, §326). */
export async function tasksFromRecord(context: UserContext, sourceType: TaskSourceType, sourceId: string) {
  if (!can(context, "task.view")) return [];
  const { buildTaskScopeWhere } = await import("@/lib/access/scope");
  const rows = await prisma.task.findMany({ where: { AND: [buildTaskScopeWhere(context), { entityType: sourceType, entityId: sourceId, archivedAt: null }] }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, title: true, status: true } });
  return rows.map((row) => ({ id: row.id, label: row.title, href: `/tasks/${row.id}`, status: row.status }));
}
