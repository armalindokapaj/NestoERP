import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import {
  AccessError,
  assertFound,
  assertModule,
  assertPermission,
} from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, skipFor, withTieBreaker } from "@/lib/modules/shared/list-query";
import { SNAPSHOT } from "../qaqc.list";
import { loadMemberRef, toMemberRef } from "../qaqc.dto";
import { buildTemplateScopeWhere } from "../qaqc.scope";
import type { TemplateInput, TemplateListQuery } from "../qaqc.schema";
import { isTemplateUsable } from "../qaqc.status";
import type {
  TemplateDetailDTO,
  TemplateItemDTO,
  TemplateSummaryDTO,
} from "../qaqc.types";

/**
 * Inspection templates (PRD #21 §49–§58).
 *
 * A template is the checklist a company inspects against. Two rules shape
 * everything here:
 *
 *   1. **A used template is never edited in place** (PRD #21 §53). Once an
 *      inspection has been run against version 1, editing it would rewrite what
 *      somebody actually checked. Saving changes to a used template creates
 *      version 2 and leaves version 1 exactly where it is.
 *   2. **The checklist is copied onto the inspection, not referenced**
 *      (PRD #21 §69). That is what makes a five-year-old inspection still
 *      readable against the standard it was actually held to.
 */

const MODULE = "qaqc" as const;
const ENTITY = "InspectionTemplate";

const LIST_SELECT = {
  id: true,
  code: true,
  name: true,
  inspectionType: true,
  status: true,
  version: true,
  updatedAt: true,
  _count: { select: { items: true, inspections: true } },
} satisfies Prisma.InspectionTemplateSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  description: true,
  createdByMemberId: true,
  createdAt: true,
  archivedAt: true,
  items: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      code: true,
      label: true,
      description: true,
      responseType: true,
      required: true,
      sortOrder: true,
      passCriteriaText: true,
      requiresEvidenceOnFail: true,
    },
  },
} satisfies Prisma.InspectionTemplateSelect;

type ListRow = Prisma.InspectionTemplateGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.InspectionTemplateGetPayload<{ select: typeof DETAIL_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The template register's predicate (AUD-08 §3, DT-03): scope, then filters
 * and search. OR within a filter, AND across filters.
 */
export function buildTemplateListWhere(
  context: UserContext,
  query: TemplateListQuery,
): Prisma.InspectionTemplateWhereInput {
  const filters: Prisma.InspectionTemplateWhereInput[] = [buildTemplateScopeWhere(context)];
  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.inspectionType?.length) {
    filters.push({ inspectionType: { in: query.inspectionType } });
  }

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { code: { contains: term, mode: "insensitive" } },
        { name: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  return { AND: filters };
}

/** The allowlisted template sorts, each ending in the id (AUD-08 §4, DT-04). No key is nullable. */
export function templateListOrder(sort: TemplateListQuery["sort"]): Prisma.InspectionTemplateOrderByWithRelationInput[] {
  return withTieBreaker<Prisma.InspectionTemplateOrderByWithRelationInput>(
    sort === "name-asc"
      ? [{ name: "asc" }]
      : sort === "updated-desc"
        ? [{ updatedAt: "desc" }]
        : [{ code: "asc" }, { version: "desc" }],
  );
}

export async function listTemplates(context: UserContext, query: TemplateListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.template.view");

  const where = buildTemplateListWhere(context, query);

  // Rows and total from one snapshot (AUD-08 §4, DT-06).
  const [rows, total] = await prisma.$transaction(
    [
      prisma.inspectionTemplate.findMany({
        where,
        orderBy: templateListOrder(query.sort),
        skip: skipFor(query.page, query.limit),
        take: query.limit,
        select: LIST_SELECT,
      }),
      prisma.inspectionTemplate.count({ where }),
    ],
    SNAPSHOT,
  );

  return {
    data: rows.map(toSummaryDTO),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getTemplate(
  context: UserContext,
  templateId: string,
): Promise<TemplateDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.template.view");

  const row = assertFound(
    await prisma.inspectionTemplate.findFirst({
      where: { AND: [buildTemplateScopeWhere(context), { id: templateId }] },
      select: DETAIL_SELECT,
    }),
  );

  return {
    ...toSummaryDTO(row),
    description: row.description,
    items: row.items.map(toItemDTO),
    createdBy: await loadMemberRef(context.companyId, row.createdByMemberId),
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    capabilities: capabilitiesFor(context, row),
  };
}

/** Templates an inspection may be started from: active ones only (§52). */
export async function selectableTemplates(
  context: UserContext,
  inspectionType?: "MATERIAL" | "WORK" | "GENERAL",
): Promise<{ value: string; label: string; inspectionType: string }[]> {
  if (!can(context, "qaqc.template.view")) return [];

  const rows = await prisma.inspectionTemplate.findMany({
    where: {
      AND: [
        buildTemplateScopeWhere(context),
        { status: "ACTIVE", archivedAt: null },
        ...(inspectionType ? [{ inspectionType }] : []),
      ],
    },
    select: { id: true, code: true, name: true, version: true, inspectionType: true },
    orderBy: [{ code: "asc" }, { version: "desc" }],
  });

  return rows.map((row) => ({
    value: row.id,
    label: `${row.code} v${row.version} — ${row.name}`,
    inspectionType: row.inspectionType,
  }));
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createTemplate(
  context: UserContext,
  input: TemplateInput,
): Promise<TemplateDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.template.create");

  const id = await prisma.$transaction(async (tx) => {
    await assertCodeIsFree(tx, context, input.code, 1, null);

    const template = await tx.inspectionTemplate.create({
      data: {
        companyId: context.companyId,
        code: input.code,
        name: input.name,
        inspectionType: input.inspectionType,
        description: input.description ?? null,
        status: input.status,
        version: 1,
        createdByMemberId: context.membershipId,
        items: {
          create: input.items.map((item, index) => ({
            code: item.code ?? null,
            label: item.label,
            description: item.description ?? null,
            responseType: item.responseType,
            required: item.required,
            sortOrder: index,
            passCriteriaText: item.passCriteriaText ?? null,
            requiresEvidenceOnFail: item.requiresEvidenceOnFail,
          })),
        },
      },
      select: { id: true, code: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: template.id,
      action: "QAQC_TEMPLATE_CREATED",
      message: `created template ${template.code}`,
    });

    return template.id;
  });

  return getTemplate(context, id);
}

/**
 * Saves changes to a template.
 *
 * If nothing has been inspected against it yet, the edit lands in place. Once
 * it has been used, a new version is written instead and the old one is left
 * alone — because an inspection that says "checked against SITE-01 v1" has to
 * still mean what it meant on the day (PRD #21 §53).
 */
export async function updateTemplate(
  context: UserContext,
  templateId: string,
  input: TemplateInput,
): Promise<TemplateDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.template.update");

  const existing = assertFound(
    await prisma.inspectionTemplate.findFirst({
      where: { AND: [buildTemplateScopeWhere(context), { id: templateId }] },
      select: {
        id: true,
        code: true,
        version: true,
        archivedAt: true,
        updatedAt: true,
        _count: { select: { inspections: true } },
      },
    }),
  );

  if (existing.archivedAt) {
    throw new AccessError("CONFLICT", "Restore this template before editing it.", {
      code: "TEMPLATE_ARCHIVED",
    });
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  const used = existing._count.inspections > 0;

  const id = await prisma.$transaction(async (tx) => {
    if (!used) {
      await assertCodeIsFree(tx, context, input.code, existing.version, templateId);

      await tx.inspectionTemplateItem.deleteMany({ where: { inspectionTemplateId: templateId } });
      await tx.inspectionTemplate.update({
        where: { id: templateId },
        data: {
          code: input.code,
          name: input.name,
          inspectionType: input.inspectionType,
          description: input.description ?? null,
          status: input.status,
          updatedByMemberId: context.membershipId,
          items: {
            create: input.items.map((item, index) => ({
              code: item.code ?? null,
              label: item.label,
              description: item.description ?? null,
              responseType: item.responseType,
              required: item.required,
              sortOrder: index,
              passCriteriaText: item.passCriteriaText ?? null,
              requiresEvidenceOnFail: item.requiresEvidenceOnFail,
            })),
          },
        },
      });

      await recordActivity(tx, context, {
        module: MODULE,
        entityType: ENTITY,
        entityId: templateId,
        action: "QAQC_TEMPLATE_UPDATED",
        message: `updated template ${input.code}`,
      });

      return templateId;
    }

    // Already used: a new version, and the old one retires to INACTIVE so
    // nobody starts a fresh inspection against a superseded checklist.
    const nextVersion = await nextVersionFor(tx, context, input.code);
    await assertCodeIsFree(tx, context, input.code, nextVersion, null);

    const created = await tx.inspectionTemplate.create({
      data: {
        companyId: context.companyId,
        code: input.code,
        name: input.name,
        inspectionType: input.inspectionType,
        description: input.description ?? null,
        status: input.status,
        version: nextVersion,
        createdByMemberId: context.membershipId,
        items: {
          create: input.items.map((item, index) => ({
            code: item.code ?? null,
            label: item.label,
            description: item.description ?? null,
            responseType: item.responseType,
            required: item.required,
            sortOrder: index,
            passCriteriaText: item.passCriteriaText ?? null,
            requiresEvidenceOnFail: item.requiresEvidenceOnFail,
          })),
        },
      },
      select: { id: true },
    });

    await tx.inspectionTemplate.update({
      where: { id: templateId },
      data: { status: "INACTIVE", updatedByMemberId: context.membershipId },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: created.id,
      action: "QAQC_TEMPLATE_VERSIONED",
      message: `created ${input.code} v${nextVersion}, superseding v${existing.version}`,
      metadata: { supersedes: templateId } as Prisma.InputJsonValue,
    });

    return created.id;
  });

  return getTemplate(context, id);
}

export async function archiveTemplate(context: UserContext, templateId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.template.archive");

  const existing = assertFound(
    await prisma.inspectionTemplate.findFirst({
      where: { AND: [buildTemplateScopeWhere(context), { id: templateId }] },
      select: { id: true, code: true, archivedAt: true },
    }),
  );

  if (existing.archivedAt) return;

  /*
   * An inspection still in flight against this template is a reason to wait:
   * archiving would pull the checklist out from under somebody mid-inspection
   * (PRD #21 §58).
   */
  const live = await prisma.qualityInspection.count({
    where: {
      templateId,
      status: { in: ["DRAFT", "IN_PROGRESS", "PENDING_APPROVAL"] },
    },
  });

  if (live > 0) {
    throw new AccessError(
      "CONFLICT",
      `${live} inspection${live === 1 ? " is" : "s are"} still running against this template. Finish them first.`,
      { code: "TEMPLATE_IN_USE" },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.inspectionTemplate.update({
      where: { id: templateId },
      data: {
        status: "ARCHIVED",
        archivedAt: new Date(),
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: templateId,
      action: "QAQC_TEMPLATE_ARCHIVED",
      message: `archived template ${existing.code}`,
    });
  });
}

export async function restoreTemplate(context: UserContext, templateId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.template.restore");

  const existing = assertFound(
    await prisma.inspectionTemplate.findFirst({
      where: { AND: [buildTemplateScopeWhere(context), { id: templateId }] },
      select: { id: true, code: true, archivedAt: true },
    }),
  );

  if (!existing.archivedAt) return;

  await prisma.$transaction(async (tx) => {
    // Restored as INACTIVE, so somebody has to look at it before it is used
    // again rather than it silently rejoining the picker.
    await tx.inspectionTemplate.update({
      where: { id: templateId },
      data: { status: "INACTIVE", archivedAt: null, updatedByMemberId: context.membershipId },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: templateId,
      action: "QAQC_TEMPLATE_RESTORED",
      message: `restored template ${existing.code}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function nextVersionFor(
  tx: Prisma.TransactionClient,
  context: UserContext,
  code: string,
): Promise<number> {
  const last = await tx.inspectionTemplate.findFirst({
    where: { companyId: context.companyId, code },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  return (last?.version ?? 0) + 1;
}

async function assertCodeIsFree(
  tx: Prisma.TransactionClient,
  context: UserContext,
  code: string,
  version: number,
  exceptId: string | null,
): Promise<void> {
  const clash = await tx.inspectionTemplate.findFirst({
    where: {
      companyId: context.companyId,
      code,
      version,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });

  if (clash) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `Template ${code} v${version} already exists.`,
      { code: "TEMPLATE_CODE_TAKEN" },
    );
  }
}

function assertNotStale(sent: Date | undefined, actual: Date): void {
  if (!sent) return;
  if (sent.getTime() !== actual.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "Somebody else changed this template while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

function toSummaryDTO(row: ListRow): TemplateSummaryDTO {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    inspectionType: row.inspectionType,
    status: row.status,
    version: row.version,
    itemCount: row._count.items,
    usageCount: row._count.inspections,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toItemDTO(row: DetailRow["items"][number]): TemplateItemDTO {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    description: row.description,
    responseType: row.responseType,
    required: row.required,
    sortOrder: row.sortOrder,
    passCriteriaText: row.passCriteriaText,
    requiresEvidenceOnFail: row.requiresEvidenceOnFail,
  };
}

function capabilitiesFor(context: UserContext, row: DetailRow) {
  const live = row.archivedAt === null;

  return {
    canEdit: live && can(context, "qaqc.template.update"),
    canArchive: live && can(context, "qaqc.template.archive"),
    canRestore: !live && can(context, "qaqc.template.restore"),
    canUse: live && isTemplateUsable(row.status) && can(context, "qaqc.inspection.create"),
  };
}

export { toMemberRef };
