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
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import { dateString, loadMemberRef } from "../hse.dto";
import { buildTemplateScopeWhere } from "../hse.scope";
import type { TemplateInput, TemplateListQuery } from "../hse.schema";
import type { TemplateDetailDTO, TemplateSummaryDTO } from "../hse.types";

/**
 * Safety inspection templates (PRD #22 §42–§45, §349).
 *
 * A template is the checklist the company inspects against. The rule that
 * shapes this file: **a version that has been used is never rewritten**
 * (PRD #22 §349).
 *
 * Editing an unused template edits it. Editing one that inspections have
 * already run against creates version 2 and leaves version 1 exactly as it was,
 * because those inspections are evidence of what somebody checked on a site on a
 * particular day. Silently changing the wording of a question after the fact
 * would make that evidence describe a check nobody performed.
 *
 * HSE templates are separate from QA/QC templates on purpose (PRD #22 §42):
 * they answer different questions, are held by different people, and share
 * nothing but a shape.
 */

const MODULE = "hse" as const;
const ENTITY = "HseInspectionTemplate";

const ITEM_SELECT = {
  id: true,
  code: true,
  label: true,
  description: true,
  responseType: true,
  required: true,
  sortOrder: true,
  riskIfFailed: true,
  requiresNoteOnFail: true,
} satisfies Prisma.HseInspectionTemplateItemSelect;

const LIST_SELECT = {
  id: true,
  code: true,
  name: true,
  inspectionType: true,
  version: true,
  status: true,
  updatedAt: true,
  _count: { select: { items: true, inspections: true } },
} satisfies Prisma.HseInspectionTemplateSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  description: true,
  createdByMemberId: true,
  createdAt: true,
  archivedAt: true,
  items: { select: ITEM_SELECT, orderBy: { sortOrder: "asc" } },
} satisfies Prisma.HseInspectionTemplateSelect;

type ListRow = Prisma.HseInspectionTemplateGetPayload<{ select: typeof LIST_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listTemplates(context: UserContext, query: TemplateListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.template.view");

  const filters: Prisma.HseInspectionTemplateWhereInput[] = [buildTemplateScopeWhere(context)];

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

  const where: Prisma.HseInspectionTemplateWhereInput = { AND: filters };

  const orderBy: Prisma.HseInspectionTemplateOrderByWithRelationInput[] =
    query.sort === "code-asc"
      ? [{ code: "asc" }, { version: "desc" }]
      : query.sort === "name-asc"
        ? [{ name: "asc" }]
        : [{ updatedAt: "desc" }];

  const [rows, total] = await Promise.all([
    prisma.hseInspectionTemplate.findMany({
      where,
      orderBy,
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: LIST_SELECT,
    }),
    prisma.hseInspectionTemplate.count({ where }),
  ]);

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
  assertPermission(context, "hse.template.view");

  const row = assertFound(
    await prisma.hseInspectionTemplate.findFirst({
      where: { AND: [buildTemplateScopeWhere(context), { id: templateId }] },
      select: DETAIL_SELECT,
    }),
  );

  const createdBy = await loadMemberRef(row.createdByMemberId);

  return {
    ...toSummaryDTO(row),
    description: row.description,
    items: row.items,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    archivedAt: dateString(row.archivedAt),
    capabilities: {
      canEdit: row.status !== "ARCHIVED" && can(context, "hse.template.update"),
      canArchive: row.status !== "ARCHIVED" && can(context, "hse.template.archive"),
      canRestore: row.status === "ARCHIVED" && can(context, "hse.template.restore"),
      wouldVersion: row._count.inspections > 0,
    },
  };
}

/** The templates an inspection may actually be raised from (PRD #22 §44). */
export async function usableTemplates(context: UserContext) {
  if (!can(context, "hse.template.view")) return [];

  return prisma.hseInspectionTemplate.findMany({
    where: { AND: [buildTemplateScopeWhere(context), { status: "ACTIVE" }] },
    orderBy: [{ inspectionType: "asc" }, { code: "asc" }],
    select: { id: true, code: true, name: true, inspectionType: true, version: true },
  });
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createTemplate(
  context: UserContext,
  input: TemplateInput,
): Promise<TemplateDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.template.create");

  await assertCodeFree(context, input.code);

  const id = await prisma.$transaction(async (tx) => {
    const template = await tx.hseInspectionTemplate.create({
      data: {
        companyId: context.companyId,
        code: input.code,
        name: input.name,
        inspectionType: input.inspectionType,
        description: input.description ?? null,
        version: 1,
        status: "ACTIVE",
        createdByMemberId: context.membershipId,
        items: { create: input.items.map(toItemData) },
      },
      select: { id: true, code: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: template.id,
      action: "HSE_TEMPLATE_CREATED",
      message: `created safety checklist ${template.code}`,
    });

    return template.id;
  });

  return getTemplate(context, id);
}

/**
 * Edits the template, or versions it (PRD #22 §349).
 *
 * The branch is not a preference: a version that inspections have run against
 * is evidence, and rewriting it would change what somebody is recorded as
 * having checked. So an unused template is edited in place, and a used one gets
 * a successor while the original is retired to INACTIVE — still readable by the
 * inspections that point at it, but no longer offered for new ones.
 */
export async function updateTemplate(
  context: UserContext,
  templateId: string,
  input: TemplateInput,
): Promise<TemplateDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.template.update");

  const existing = assertFound(
    await prisma.hseInspectionTemplate.findFirst({
      where: { AND: [buildTemplateScopeWhere(context), { id: templateId }] },
      select: {
        id: true,
        code: true,
        version: true,
        status: true,
        updatedAt: true,
        _count: { select: { inspections: true } },
      },
    }),
  );

  if (existing.status === "ARCHIVED") {
    throw new AccessError("CONFLICT", "Restore this checklist before editing it.", {
      code: "TEMPLATE_ARCHIVED",
    });
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  if (input.code !== existing.code) await assertCodeFree(context, input.code);

  const used = existing._count.inspections > 0;

  const id = await prisma.$transaction(async (tx) => {
    if (!used) {
      await tx.hseInspectionTemplateItem.deleteMany({ where: { templateId } });
      await tx.hseInspectionTemplate.update({
        where: { id: templateId },
        data: {
          code: input.code,
          name: input.name,
          inspectionType: input.inspectionType,
          description: input.description ?? null,
          updatedByMemberId: context.membershipId,
          items: { create: input.items.map(toItemData) },
        },
      });

      await recordActivity(tx, context, {
        module: MODULE,
        entityType: ENTITY,
        entityId: templateId,
        action: "HSE_TEMPLATE_UPDATED",
        message: `updated safety checklist ${input.code}`,
      });

      return templateId;
    }

    // Highest version wins the next number, so a code that has been versioned
    // several times keeps counting up rather than colliding.
    const latest = await tx.hseInspectionTemplate.findFirst({
      where: { companyId: context.companyId, code: input.code },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    const successor = await tx.hseInspectionTemplate.create({
      data: {
        companyId: context.companyId,
        code: input.code,
        name: input.name,
        inspectionType: input.inspectionType,
        description: input.description ?? null,
        version: (latest?.version ?? existing.version) + 1,
        status: "ACTIVE",
        createdByMemberId: context.membershipId,
        items: { create: input.items.map(toItemData) },
      },
      select: { id: true, version: true },
    });

    await tx.hseInspectionTemplate.update({
      where: { id: templateId },
      data: { status: "INACTIVE", updatedByMemberId: context.membershipId },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: successor.id,
      action: "HSE_TEMPLATE_VERSIONED",
      message: `created version ${successor.version} of safety checklist ${input.code}`,
      metadata: { previousTemplateId: templateId } as Prisma.InputJsonValue,
    });

    return successor.id;
  });

  return getTemplate(context, id);
}

export async function archiveTemplate(context: UserContext, templateId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.template.archive");

  const existing = await requireTemplate(context, templateId);

  if (existing.status === "ARCHIVED") return;

  await prisma.$transaction(async (tx) => {
    await tx.hseInspectionTemplate.update({
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
      action: "HSE_TEMPLATE_ARCHIVED",
      message: `archived safety checklist ${existing.code}`,
    });
  });
}

export async function restoreTemplate(context: UserContext, templateId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.template.restore");

  const existing = await requireTemplate(context, templateId);

  if (existing.status !== "ARCHIVED") return;

  await prisma.$transaction(async (tx) => {
    await tx.hseInspectionTemplate.update({
      where: { id: templateId },
      data: { status: "ACTIVE", archivedAt: null, updatedByMemberId: context.membershipId },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: templateId,
      action: "HSE_TEMPLATE_RESTORED",
      message: `restored safety checklist ${existing.code}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function toItemData(item: TemplateInput["items"][number], index: number) {
  return {
    code: item.code ?? null,
    label: item.label,
    description: item.description ?? null,
    responseType: item.responseType,
    required: item.required,
    sortOrder: index,
    riskIfFailed: item.riskIfFailed ?? null,
    requiresNoteOnFail: item.requiresNoteOnFail,
  };
}

async function requireTemplate(context: UserContext, templateId: string) {
  return assertFound(
    await prisma.hseInspectionTemplate.findFirst({
      where: { AND: [buildTemplateScopeWhere(context), { id: templateId }] },
      select: { id: true, code: true, status: true, updatedAt: true },
    }),
  );
}

/**
 * A code is unique per company across every version (PRD #22 §43).
 *
 * Two live templates called "SCF-01" is how an inspector picks the wrong one.
 * Versions of the same code are fine — that is the point — so the check looks
 * for a *different* code already in use, not for the code at all.
 */
async function assertCodeFree(context: UserContext, code: string): Promise<void> {
  const clash = await prisma.hseInspectionTemplate.findFirst({
    where: {
      companyId: context.companyId,
      code: { equals: code, mode: "insensitive" },
      status: { not: "ARCHIVED" },
    },
    select: { id: true },
  });

  if (clash) {
    throw new AccessError("VALIDATION_ERROR", "A checklist with that code already exists.", {
      code: "DUPLICATE_CODE",
    });
  }
}

function assertNotStale(sent: Date | undefined, actual: Date): void {
  if (!sent) return;
  if (sent.getTime() !== actual.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "Somebody else changed this checklist while you were editing. Reload and try again.",
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
    version: row.version,
    status: row.status,
    itemCount: row._count.items,
    usageCount: row._count.inspections,
    updatedAt: row.updatedAt.toISOString(),
  };
}
