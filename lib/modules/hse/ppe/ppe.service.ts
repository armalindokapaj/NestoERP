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
import { SNAPSHOT } from "../hse.list";
import { loadMembers, toProjectRef } from "../hse.dto";
import { nextHseNumber } from "../hse.numbering";
import { buildHseMemberWhere, buildHseProjectWhere, buildPpeScopeWhere } from "../hse.scope";
import { hseWorkerOptions, requireHseWorkers } from "../hse.workforce";
import type { PpeCheckInput, PpeListQuery } from "../hse.schema";
import { PPE_ITEMS, ppeResultFor, type PpeItemKey } from "../hse.status";
import type { PpeCheckDTO } from "../hse.types";

/**
 * PPE checks (PRD #22 §158–§162).
 *
 * Whether the protective equipment was there and being worn correctly, either
 * for one person or as a spot check on an area. Two rules shape this file.
 *
 * **It never touches Inventory** (PRD #22 §162, §369). Issuing a helmet from
 * the store is a stock issue with a quantity and a ledger behind it; checking
 * somebody is wearing one is a safety observation. Wiring the two together
 * would make a safety walk-round decrement stock.
 *
 * **The result is derived from what was actually looked at** (PRD #22 §160). A
 * check that recorded nothing is not a pass — the schema refuses it rather than
 * filing an empty form as compliance.
 */

const MODULE = "hse" as const;
const ENTITY = "PpeCheck";

const SELECT = {
  id: true,
  checkNumber: true,
  checkDate: true,
  locationText: true,
  checkedByMemberId: true,
  subjectMemberId: true,
  externalSubjectName: true,
  subjectEmployee: { select: { id: true, personProfileId: true, personProfile: { select: { firstName: true, lastName: true } } } },
  helmetOk: true,
  eyeProtectionOk: true,
  glovesOk: true,
  footwearOk: true,
  harnessOk: true,
  hearingProtectionOk: true,
  respiratoryProtectionOk: true,
  otherPpeNote: true,
  result: true,
  notes: true,
  createdAt: true,
  project: { select: { id: true, code: true, name: true } },
} satisfies Prisma.PpeCheckSelect;

type Row = Prisma.PpeCheckGetPayload<{ select: typeof SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The PPE register's predicate (AUD-08 §3, DT-03): scope, then filters and
 * search. A foreign project id is ANDed with scope and narrows to nothing
 * (DT-22).
 */
export function buildPpeListWhere(context: UserContext, query: PpeListQuery): Prisma.PpeCheckWhereInput {
  const filters: Prisma.PpeCheckWhereInput[] = [buildPpeScopeWhere(context)];

  if (query.result?.length) filters.push({ result: { in: query.result } });
  if (query.projectId) filters.push({ projectId: query.projectId });

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { checkNumber: { contains: term, mode: "insensitive" } },
        { locationText: { contains: term, mode: "insensitive" } },
        { externalSubjectName: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  return { AND: filters };
}

/** The allowlisted PPE sorts, each ending in the id (AUD-08 §4, DT-04). `checkDate` is never null. */
export function ppeListOrder(sort: PpeListQuery["sort"]): Prisma.PpeCheckOrderByWithRelationInput[] {
  return withTieBreaker<Prisma.PpeCheckOrderByWithRelationInput>(
    sort === "number-asc" ? [{ checkNumber: "asc" }] : [{ checkDate: "desc" }],
  );
}

export async function listPpeChecks(context: UserContext, query: PpeListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.ppe.view");

  const where = buildPpeListWhere(context, query);

  // Rows and total from one snapshot (AUD-08 §4, DT-06).
  const [rows, total] = await prisma.$transaction(
    [
      prisma.ppeCheck.findMany({
        where,
        orderBy: ppeListOrder(query.sort),
        skip: skipFor(query.page, query.limit),
        take: query.limit,
        select: SELECT,
      }),
      prisma.ppeCheck.count({ where }),
    ],
    SNAPSHOT,
  );

  const members = await loadMembers(
    context.companyId,
    rows.flatMap((row) => [row.checkedByMemberId, row.subjectMemberId]),
  );

  return {
    data: rows.map((row) => toDTO(row, members)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getPpeCheck(
  context: UserContext,
  checkId: string,
): Promise<PpeCheckDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.ppe.view");

  const row = assertFound(
    await prisma.ppeCheck.findFirst({
      where: { AND: [buildPpeScopeWhere(context), { id: checkId }] },
      select: SELECT,
    }),
  );

  const members = await loadMembers(context.companyId, [row.checkedByMemberId, row.subjectMemberId]);
  return toDTO(row, members);
}

export async function listForProject(
  context: UserContext,
  projectId: string,
  limit = 50,
): Promise<PpeCheckDTO[]> {
  if (!can(context, "hse.ppe.view")) return [];

  const rows = await prisma.ppeCheck.findMany({
    where: { AND: [buildPpeScopeWhere(context), { projectId }] },
    orderBy: ppeListOrder("recent"),
    take: limit,
    select: SELECT,
  });

  const members = await loadMembers(
    context.companyId,
    rows.flatMap((row) => [row.checkedByMemberId, row.subjectMemberId]),
  );
  return rows.map((row) => toDTO(row, members));
}

export async function ppeFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.ppe.view");

  const scope = buildPpeScopeWhere(context);

  const projects = await prisma.project.findMany({
    where: { AND: [buildHseProjectWhere(context), { ppeChecks: { some: scope } }] },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  return { projects };
}

export async function ppeFormOptions(context: UserContext) {
  assertModule(context, MODULE);

  const [projects, members] = await Promise.all([
    prisma.project.findMany({
      where: buildHseProjectWhere(context),
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.companyMember.findMany({
      where: buildHseMemberWhere(context),
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }),
  ]);

  // Whose PPE is checked is often somebody without a login (E-04 §72).
  const workers = await hseWorkerOptions(context);

  return { projects, members, workers };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createPpeCheck(
  context: UserContext,
  input: PpeCheckInput,
): Promise<PpeCheckDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.ppe.create");

  if (input.projectId) await requireProject(context, input.projectId);
  if (input.subjectMemberId) await requireMember(context, input.subjectMemberId);
  await requireHseWorkers(context.companyId, [input.subjectEmployeeProfileId], [], "subjectEmployeeProfileId");

  const flags = toFlags(input);
  const { result } = ppeResultFor(flags);

  if (result === null) {
    throw new AccessError("VALIDATION_ERROR", "Record at least one item of equipment.", {
      code: "NOTHING_CHECKED",
    });
  }

  const id = await prisma.$transaction(async (tx) => {
    const checkNumber = await nextHseNumber(tx, "ppeCheck", context.companyId);

    const check = await tx.ppeCheck.create({
      data: {
        companyId: context.companyId,
        checkNumber,
        projectId: input.projectId ?? null,
        checkDate: input.checkDate,
        locationText: input.locationText ?? null,
        checkedByMemberId: context.membershipId,
        subjectMemberId: input.subjectMemberId ?? null,
        subjectEmployeeProfileId: input.subjectEmployeeProfileId ?? null,
        externalSubjectName: input.externalSubjectName ?? null,
        ...flags,
        otherPpeNote: input.otherPpeNote ?? null,
        result,
        notes: input.notes ?? null,
        createdByMemberId: context.membershipId,
      },
      select: { id: true, checkNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: check.id,
      action: "HSE_PPE_CHECK_CREATED",
      message: `recorded PPE check ${check.checkNumber}`,
    });

    return check.id;
  });

  return getPpeCheck(context, id);
}

export async function updatePpeCheck(
  context: UserContext,
  checkId: string,
  input: PpeCheckInput,
): Promise<PpeCheckDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.ppe.update");

  const existing = assertFound(
    await prisma.ppeCheck.findFirst({
      where: { AND: [buildPpeScopeWhere(context), { id: checkId }] },
      select: { id: true, checkNumber: true, checkedByMemberId: true, subjectMemberId: true, subjectEmployeeProfileId: true },
    }),
  );

  /*
   * The person a check is about sees it (PRD #22 §161) but does not correct it
   * (PRD #47 §85). The row stays credited to whoever did the check, so a
   * subject re-posting their own FAIL as a PASS would put the checker's name to
   * a finding the checker never made. The checker corrects their own
   * observation; HSE management can correct anybody's.
   */
  if (
    existing.subjectMemberId === context.membershipId &&
    existing.checkedByMemberId !== context.membershipId &&
    !can(context, "hse.manage")
  ) {
    throw new AccessError(
      "FORBIDDEN",
      "This check is about you, so somebody else has to correct it.",
      { code: "SELF_CORRECTION" },
    );
  }

  if (input.projectId) await requireProject(context, input.projectId);
  if (input.subjectMemberId) await requireMember(context, input.subjectMemberId);
  // A subject who has since left stays the subject of the check made on them.
  await requireHseWorkers(context.companyId, [input.subjectEmployeeProfileId], existing.subjectEmployeeProfileId ? [existing.subjectEmployeeProfileId] : [], "subjectEmployeeProfileId");

  const flags = toFlags(input);
  const { result } = ppeResultFor(flags);

  if (result === null) {
    throw new AccessError("VALIDATION_ERROR", "Record at least one item of equipment.", {
      code: "NOTHING_CHECKED",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.ppeCheck.update({
      where: { id: checkId },
      data: {
        projectId: input.projectId ?? null,
        checkDate: input.checkDate,
        locationText: input.locationText ?? null,
        subjectMemberId: input.subjectMemberId ?? null,
        subjectEmployeeProfileId: input.subjectEmployeeProfileId ?? null,
        externalSubjectName: input.externalSubjectName ?? null,
        ...flags,
        otherPpeNote: input.otherPpeNote ?? null,
        result,
        notes: input.notes ?? null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: checkId,
      action: "HSE_PPE_CHECK_CREATED",
      message: `updated PPE check ${existing.checkNumber}`,
    });
  });

  return getPpeCheck(context, checkId);
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/** "yes"/"no"/unset from the form becomes true/false/null on the row (§159). */
function toFlags(input: PpeCheckInput): Record<PpeItemKey, boolean | null> {
  const read = (value: "yes" | "no" | "" | undefined) =>
    value === "yes" ? true : value === "no" ? false : null;

  return {
    helmetOk: read(input.helmetOk),
    eyeProtectionOk: read(input.eyeProtectionOk),
    hearingProtectionOk: read(input.hearingProtectionOk),
    respiratoryProtectionOk: read(input.respiratoryProtectionOk),
    glovesOk: read(input.glovesOk),
    harnessOk: read(input.harnessOk),
    footwearOk: read(input.footwearOk),
  };
}

async function requireProject(context: UserContext, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { AND: [buildHseProjectWhere(context), { id: projectId }] },
    select: { id: true },
  });

  if (!project) {
    throw new AccessError("VALIDATION_ERROR", "That project does not exist.", {
      code: "INVALID_PROJECT",
    });
  }

  return project;
}

async function requireMember(context: UserContext, memberId: string) {
  const member = await prisma.companyMember.findFirst({
    where: { AND: [buildHseMemberWhere(context), { id: memberId }] },
    select: { id: true },
  });

  if (!member) {
    throw new AccessError("VALIDATION_ERROR", "That person is not an active member.", {
      code: "INVALID_MEMBER",
    });
  }

  return member;
}

function toDTO(
  row: Row,
  members: Map<string, { memberId: string; fullName: string; active: boolean }>,
): PpeCheckDTO {
  // Only the equipment the check actually spoke to: a row of "not recorded"
  // items would read as a list of failures it never looked at (PRD #22 §159).
  const items = PPE_ITEMS.filter((item) => row[item.key] != null).map((item) => ({
    key: item.key,
    label: item.label,
    ok: row[item.key] === true,
  }));

  return {
    id: row.id,
    checkNumber: row.checkNumber,
    project: toProjectRef(row.project),
    checkDate: row.checkDate.toISOString(),
    locationText: row.locationText,
    checkedBy: members.get(row.checkedByMemberId) ?? null,
    subject: row.subjectMemberId ? (members.get(row.subjectMemberId) ?? null) : null,
    subjectWorker: row.subjectEmployee
      ? { employeeId: row.subjectEmployee.id, personId: row.subjectEmployee.personProfileId, name: `${row.subjectEmployee.personProfile.firstName} ${row.subjectEmployee.personProfile.lastName}` }
      : null,
    externalSubjectName: row.externalSubjectName,
    result: row.result,
    items,
    failedItems: items.filter((item) => !item.ok).map((item) => item.label),
    otherPpeNote: row.otherPpeNote,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}
