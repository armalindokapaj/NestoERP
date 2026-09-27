import { sectionRoute } from "@/config/modules";
import { inGroupWorkspace, isGroupRoute } from "@/config/workspace";
import { resolveModuleExperience, type ResolvedModuleExperience } from "@/lib/access/module-access";
import type { UserContext } from "@/lib/context/types";
import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import * as repository from "./task.repository";
import type { TaskListQuery } from "./task.schema";
import * as tasks from "./task.service";
import type { TaskOverviewStats, TaskSummaryDTO } from "./task.types";

/**
 * My Work in the active workspace (Workspace Context §32, §45, §57-§59, §86).
 *
 * Company workspace: the existing service, untouched. Group workspace: the same
 * questions asked of each company the person may open Tasks in, with that
 * company's own rules, and answered as one list whose every row names its
 * company. Nothing here takes a company id from a browser as authority — the
 * `company` query is only ever matched against what the resolver already
 * allowed.
 */

type CompanyRef = { id: string; name: string };

/**
 * The companies whose tasks the Group workspace reads: one context each, where
 * the person holds the module and may view tasks (§58, §60).
 */
async function groupTaskContexts(session: UserContext): Promise<UserContext[]> {
  return resolveWorkspaceContexts(session, { module: "tasks", permission: "task.view" });
}

/**
 * The `company` filter, checked against the companies the person may read
 * (§86, §87). A company they may not read — or none at all — is not an error
 * and not a hint that it exists: it narrows to no authorized rows. It is never
 * dropped to answer every company instead, which would silently broaden what
 * the person asked for (AUD-08 §3, DT-22).
 */
function narrowToCompany(contexts: UserContext[], company: string | undefined): UserContext[] {
  if (!company) return contexts;
  return contexts.filter((context) => context.companyId === company);
}

const refOf = (context: UserContext): CompanyRef => ({ id: context.companyId, name: context.company.name });

export async function listTasksForWorkspace(session: UserContext, query: TaskListQuery) {
  if (!inGroupWorkspace(session)) return tasks.listTasks(session, query);

  const contexts = narrowToCompany(await groupTaskContexts(session), query.company);
  const companies = new Map(contexts.map((context) => [context.companyId, refOf(context)]));
  const { rows, total } = await repository.listTasksForContexts(contexts, query);

  return {
    data: rows.map((row): TaskSummaryDTO => ({ ...tasks.toSummaryDTO(row), company: companies.get(row.companyId) })),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

/**
 * The overview counters. Counts are additive because a task belongs to exactly
 * one company; each company's own figures (its scope, its "mine") are summed.
 */
export async function taskOverviewForWorkspace(session: UserContext): Promise<TaskOverviewStats> {
  if (!inGroupWorkspace(session)) return tasks.getTaskOverview(session);

  const perCompany = await Promise.all((await groupTaskContexts(session)).map((context) => repository.taskOverviewStats(context)));
  return perCompany.reduce<TaskOverviewStats>(
    (total, stats) => ({
      open: total.open + stats.open,
      dueToday: total.dueToday + stats.dueToday,
      overdue: total.overdue + stats.overdue,
      blocked: total.blocked + stats.blocked,
      completedThisWeek: total.completedThisWeek + stats.completedThisWeek,
      mine: total.mine + stats.mine,
    }),
    { open: 0, dueToday: 0, overdue: 0, blocked: 0, completedThisWeek: 0, mine: 0 },
  );
}

export async function priorityTasksForWorkspace(session: UserContext, limit = 5): Promise<TaskSummaryDTO[]> {
  if (!inGroupWorkspace(session)) return tasks.listPriorityTasks(session, limit);

  const contexts = await groupTaskContexts(session);
  const companies = new Map(contexts.map((context) => [context.companyId, refOf(context)]));
  const rows = await repository.priorityTasksForContexts(contexts, limit);
  return rows.map((row) => ({ ...tasks.toSummaryDTO(row), company: companies.get(row.companyId) }));
}

/**
 * What the list toolbar offers. Company workspace: the company's own projects
 * and colleagues. Group workspace: the companies to narrow to, and projects
 * named with theirs. There is no assignee filter across companies — a person is
 * a different member in each, so a member id would narrow to one company's
 * self while looking like a person; search still finds tasks by assignee name.
 */
export async function taskFilterOptionsForWorkspace(session: UserContext) {
  if (!inGroupWorkspace(session)) return { ...(await repository.taskFilterOptions(session)), companies: [] as CompanyRef[] };

  const contexts = await groupTaskContexts(session);
  const perCompany = await Promise.all(
    contexts.map(async (context) => ({ context, options: await repository.taskFilterOptions(context) })),
  );
  return {
    projects: perCompany
      .flatMap(({ context, options }) => options.projects.map((project) => ({ id: project.id, name: `${project.name} · ${context.company.name}` })))
      .sort((a, b) => a.name.localeCompare(b.name)),
    assignees: [] as Array<{ id: string; name: string }>,
    companies: contexts.map(refOf).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * The module's tab bar for the active workspace: in the Group workspace only
 * the sections that read across companies (§25, §85) — the rest belong to one
 * company and would answer "choose a company".
 */
export function taskExperience(session: UserContext): ResolvedModuleExperience {
  const experience = resolveModuleExperience(session, "tasks");
  if (!inGroupWorkspace(session)) return experience;
  return {
    ...experience,
    description: "Work across every company you can open. Each task names its company.",
    sections: experience.sections.filter((section) => isGroupRoute("tasks", sectionRoute("tasks", section.key))),
  };
}
