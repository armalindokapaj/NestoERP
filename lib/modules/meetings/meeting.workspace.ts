import { sectionRoute } from "@/config/modules";
import { inGroupWorkspace, isGroupRoute } from "@/config/workspace";
import { can, canAccessModule } from "@/lib/access/can";
import { resolveModuleExperience, type ResolvedModuleExperience } from "@/lib/access/module-access";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import { prisma } from "@/lib/database/prisma";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import {
  ACTION_LIST_INCLUDE,
  ACTION_LIST_ORDER,
  actionListDTOs,
  actionListWhere,
  listActionItems,
} from "./meeting.actions";
import { LIST_SELECT, listItemDTOs } from "./meeting.repository";
import type { ActionListQuery, MeetingListQuery } from "./meeting.schema";
import { listMeetings, meetingListOrder, meetingListWhere } from "./meeting.service";
import type { MeetingListItemDTO, MyActionItemDTO } from "./meeting.types";

/**
 * Meetings in the active workspace (Workspace Context §34, §45, §57-§59, §86).
 *
 * Company workspace: the existing services, untouched. Group workspace: every
 * meeting the person may open, in every company they may open Meetings in, each
 * company answering with its own rules (visibility, project and department
 * doors, "mine" by that company's membership) and every row naming its company.
 * The union is built in the database — search, order and paging run over all
 * companies at once — and the rows are shaped afterwards by the context of the
 * company each belongs to.
 *
 * A meeting keeps its own company's time zone: a row's time is never converted
 * on the way through, so what the list shows is what the meeting's page shows.
 */

type CompanyRef = { id: string; name: string };

/** One context per company where the person holds Meetings and may view them (§58, §60). */
async function groupMeetingContexts(session: UserContext): Promise<UserContext[]> {
  return resolveWorkspaceContexts(session, { module: "meetings", permission: "meeting.view" });
}

/**
 * The `company` filter, checked against the companies the person may read
 * (§86, §87): one they may not read — or none — is not an error and not a hint
 * that it exists; the filter is simply not applied.
 */
function narrowToCompany(contexts: UserContext[], company: string | undefined): UserContext[] {
  if (!company) return contexts;
  const narrowed = contexts.filter((context) => context.companyId === company);
  return narrowed.length > 0 ? narrowed : contexts;
}

const refOf = (context: UserContext): CompanyRef => ({ id: context.companyId, name: context.company.name });

/** Rows come back in the union's order; each is shaped by the context of its own company. */
async function shapeByCompany<Row extends { id: string; companyId: string }, Dto extends { id: string }>(
  contexts: UserContext[],
  rows: Row[],
  shape: (context: UserContext, rows: Row[]) => Promise<Dto[]>,
): Promise<Array<Dto & { company: CompanyRef }>> {
  const shaped = new Map<string, Dto & { company: CompanyRef }>();
  await Promise.all(
    contexts.map(async (context) => {
      const own = rows.filter((row) => row.companyId === context.companyId);
      if (own.length === 0) return;
      for (const dto of await shape(context, own)) shaped.set(dto.id, { ...dto, company: refOf(context) });
    }),
  );
  return rows.flatMap((row) => {
    const dto = shaped.get(row.id);
    return dto ? [dto] : [];
  });
}

export async function listMeetingsForWorkspace(
  session: UserContext,
  query: MeetingListQuery,
): Promise<{ data: MeetingListItemDTO[]; pagination: ReturnType<typeof paginationMeta> }> {
  if (!inGroupWorkspace(session)) return listMeetings(session, query);

  const contexts = narrowToCompany(await groupMeetingContexts(session), query.company);
  if (contexts.length === 0) return { data: [], pagination: paginationMeta(0, query.page, query.limit) };

  const now = new Date();
  const where = { OR: contexts.map((context) => meetingListWhere(context, query, now)) };
  const [rows, total] = await Promise.all([
    prisma.meeting.findMany({
      where,
      orderBy: meetingListOrder(query),
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: { ...LIST_SELECT, companyId: true },
    }),
    prisma.meeting.count({ where }),
  ]);

  return {
    data: await shapeByCompany(contexts, rows, listItemDTOs),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

/** Actions from meetings, across the companies the person may open Meetings in (§34). */
export async function listActionItemsForWorkspace(
  session: UserContext,
  query: ActionListQuery,
): Promise<{ data: MyActionItemDTO[]; pagination: ReturnType<typeof paginationMeta> }> {
  if (!inGroupWorkspace(session)) return listActionItems(session, query);

  const contexts = narrowToCompany(await groupMeetingContexts(session), query.company);
  if (contexts.length === 0) return { data: [], pagination: paginationMeta(0, query.page, query.limit) };

  const where = { OR: contexts.map((context) => actionListWhere(context, query)) };
  const [rows, total] = await Promise.all([
    prisma.meetingActionItem.findMany({
      where,
      orderBy: [...ACTION_LIST_ORDER, { id: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: ACTION_LIST_INCLUDE,
    }),
    prisma.meetingActionItem.count({ where }),
  ]);

  return {
    data: await shapeByCompany(contexts, rows, actionListDTOs),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

/** The companies a Group list can be narrowed to: those where the person may open Meetings (§58, §86). */
export async function meetingCompanyOptions(session: UserContext): Promise<CompanyRef[]> {
  if (!inGroupWorkspace(session)) return [];
  return (await groupMeetingContexts(session)).map(refOf).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What the meeting toolbars offer beside the fixed filters: in the Group
 * workspace the companies to narrow to and projects named with theirs; in a
 * company workspace its own projects, exactly as before.
 */
export async function meetingFilterOptionsForWorkspace(session: UserContext) {
  const contexts = inGroupWorkspace(session) ? await groupMeetingContexts(session) : [session];
  const grouped = inGroupWorkspace(session);

  const projects = (
    await Promise.all(
      contexts.map(async (context) => {
        if (!(canAccessModule(context, "projects") && can(context, "project.view"))) return [];
        const rows = await prisma.project.findMany({
          where: { AND: [buildProjectScopeWhere(context), { archivedAt: null }] },
          orderBy: { name: "asc" },
          take: 100,
          select: { id: true, name: true },
        });
        return rows.map((row) => ({ id: row.id, name: grouped ? `${row.name} · ${context.company.name}` : row.name }));
      }),
    )
  ).flat();

  return {
    projects: grouped ? projects.sort((a, b) => a.name.localeCompare(b.name)) : projects,
    companies: await meetingCompanyOptions(session),
  };
}

/**
 * The module's tab bar for the active workspace: in the Group workspace only
 * the sections that read across companies (§25, §85).
 */
export function meetingExperience(session: UserContext): ResolvedModuleExperience {
  const experience = resolveModuleExperience(session, "meetings");
  if (!inGroupWorkspace(session)) return experience;
  return {
    ...experience,
    description: "Meetings across every company you can open. Each meeting names its company and keeps its own time zone.",
    sections: experience.sections.filter((section) => isGroupRoute("meetings", sectionRoute("meetings", section.key))),
  };
}
