import { contextCandidate, QUICK_CREATE_ACTIONS, QUICK_CREATE_BY_KEY, type QuickCreateActionDefinition, type QuickCreateGroup } from "@/config/quick-create";
import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { resolveGroupContexts } from "@/lib/context/workspace-access";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { loadRecord } from "@/lib/core/records/record.registry";
import { prisma } from "@/lib/database/prisma";

/**
 * Quick Create (Quick Create PRD §2, §7, §33, §87-§98, §147, §148).
 *
 *   action visible = module enabled + create permission + workspace supported
 *                    + an owning company resolvable
 *
 * all decided on the server, from the person's own context in each company —
 * never from the sidebar (§8) and never by role name (§10). The browser gets
 * only what it may launch (§89). Launching asks again (§95): the menu may be
 * stale, and the answer is a canonical create route with ids the create page
 * itself validates once more (§62).
 */

export type QuickCreateCompany = { id: string; name: string };

export type QuickCreateActionDTO = {
  key: string;
  label: string;
  group: QuickCreateGroup;
  icon: string;
  keywords: string[];
  /** Group workspace only: the companies where the person may create this — never the others (§17, §147). */
  companies: QuickCreateCompany[] | null;
  ownership: "COMPANY" | "PROJECT";
  /** The flow lives under a project and none is known yet: the menu asks (§71, §111). */
  needsProject: boolean;
};

export type QuickCreateContextDTO = {
  recordType: string;
  recordId: string;
  label: string;
  company: QuickCreateCompany;
  project: { id: string; name: string } | null;
};

export type QuickCreateMenuDTO = {
  actions: QuickCreateActionDTO[];
  workspace: { scopeType: "GROUP" | "COMPANY"; company: QuickCreateCompany | null };
  /** The current page's record, when it is safe context (§21, §22). */
  context: QuickCreateContextDTO | null;
};

function mayCreate(context: UserContext, action: QuickCreateActionDefinition): boolean {
  return isModuleEnabled(context, action.moduleKey) && canAccessModule(context, action.moduleKey) && can(context, action.permission);
}

const company = (context: UserContext): QuickCreateCompany => ({ id: context.companyId, name: context.company.name });

/** The contexts a Quick Create may act in: the company workspace's own, or each company of the group (§11-§15). */
async function candidates(session: UserContext): Promise<UserContext[]> {
  return session.workspace.scopeType === "GROUP" ? resolveGroupContexts(session) : [session];
}

/**
 * The page's record as safe context: read through the record registry in the
 * person's own scope, in whichever of their companies it lives. Absent,
 * foreign and out-of-scope records all answer null — nothing is guessed (§22, §80, §81).
 */
async function resolvePageContext(contexts: UserContext[], pathname: string | null | undefined): Promise<{ context: UserContext; dto: QuickCreateContextDTO } | null> {
  const candidate = pathname ? contextCandidate(pathname) : null;
  if (!candidate) return null;
  for (const context of contexts) {
    const record = await loadRecord(context, candidate.recordType, candidate.recordId).catch(() => null);
    if (!record || record.companyId !== context.companyId) continue;
    const projectId = record.type === "project" ? record.id : record.projectId;
    const project = projectId ? await loadRecord(context, "project", projectId).catch(() => null) : null;
    return {
      context,
      dto: {
        recordType: record.type,
        recordId: record.id,
        label: record.label,
        company: company(context),
        project: project ? { id: project.id, name: project.label } : null,
      },
    };
  }
  return null;
}

/** What `+ Create` offers here, now (§5, §33, §88, §92). */
export async function listAvailableActions(session: UserContext, input: { pathname?: string | null } = {}): Promise<QuickCreateMenuDTO> {
  const inGroup = session.workspace.scopeType === "GROUP";
  const contexts = await candidates(session);
  const page = await resolvePageContext(contexts, input.pathname);

  const actions: QuickCreateActionDTO[] = [];
  for (const action of QUICK_CREATE_ACTIONS) {
    if (inGroup ? !action.supportsGroupWorkspace : !action.supportsCompanyWorkspace) continue;
    const allowed = contexts.filter((context) => mayCreate(context, action));
    // No company to own it is no action at all — not a disabled one (§156).
    if (allowed.length === 0) continue;
    const projectKnown = Boolean(page?.dto.project && allowed.some((context) => context.companyId === page.dto.company.id));
    actions.push({
      key: action.key,
      label: action.label,
      group: action.group,
      icon: action.icon,
      keywords: action.keywords,
      ownership: action.ownership,
      companies: inGroup ? allowed.map(company).sort((a, b) => a.name.localeCompare(b.name)) : null,
      needsProject: action.ownership === "PROJECT" && !projectKnown,
    });
  }

  return {
    actions,
    workspace: { scopeType: inGroup ? "GROUP" : "COMPANY", company: inGroup ? null : company(session) },
    context: page?.dto ?? null,
  };
}

function refuse(code: string, message: string, status: "FORBIDDEN" | "CONFLICT" | "NOT_FOUND" | "VALIDATION_ERROR" = "CONFLICT"): AccessError {
  incrementCounter(Metric.QUICK_CREATE_LAUNCH_DENIED, { code });
  return new AccessError(status, message, { code });
}

/** The context an action would run in, checked now — not when the menu was drawn (§95-§98). */
async function targetContext(session: UserContext, action: QuickCreateActionDefinition, companyId: string | null | undefined): Promise<UserContext> {
  const inGroup = session.workspace.scopeType === "GROUP";
  if (inGroup ? !action.supportsGroupWorkspace : !action.supportsCompanyWorkspace) throw refuse("QUICK_CREATE_UNAVAILABLE", "This create action is currently unavailable.");
  let target: UserContext | undefined;
  if (inGroup) {
    // The group is never the owner of a company record: a company has to be chosen (§13, §14, §151).
    if (!companyId) throw refuse("QUICK_CREATE_COMPANY_REQUIRED", "Choose a Company to continue.", "VALIDATION_ERROR");
    target = (await resolveGroupContexts(session)).find((context) => context.companyId === companyId);
  } else {
    // A company workspace creates in its company; naming another is refused, not followed (§140).
    target = !companyId || companyId === session.companyId ? session : undefined;
  }
  if (!target) throw refuse("QUICK_CREATE_COMPANY_FORBIDDEN", "You cannot create this record in that company.", "FORBIDDEN");
  if (!isModuleEnabled(target, action.moduleKey)) throw refuse("QUICK_CREATE_UNAVAILABLE", "This create action is currently unavailable.");
  if (!canAccessModule(target, action.moduleKey) || !can(target, action.permission)) throw refuse("QUICK_CREATE_PERMISSION_CHANGED", "You no longer have permission to create this record.", "FORBIDDEN");
  return target;
}

export type QuickCreateLaunchDTO = {
  href: string;
  company: QuickCreateCompany;
  /** Whether the session must enter `company` first: a create page is a company page (§69, §70). */
  switchWorkspace: boolean;
  /** "Creating in: IDEAL Construction · Tirana Lake" (§50). */
  creatingIn: string;
};

/**
 * Resolves a launch (§93, §94). Every id in the answer was read again in the
 * target company's own scope: the chosen project, and the page's record — used
 * only when it belongs to the company being created in, so a Company A form is
 * never prefilled from Company B (§72-§77).
 */
export async function resolveLaunch(session: UserContext, input: { actionKey: string; companyId?: string | null; projectId?: string | null; pathname?: string | null }): Promise<QuickCreateLaunchDTO> {
  const action = QUICK_CREATE_BY_KEY.get(input.actionKey);
  if (!action) throw refuse("QUICK_CREATE_UNAVAILABLE", "This action is no longer available.", "NOT_FOUND");
  const target = await targetContext(session, action, input.companyId);

  const page = await resolvePageContext([target], input.pathname);
  let project = page?.dto.project ?? null;
  if (input.projectId) {
    const chosen = await loadRecord(target, "project", input.projectId).catch(() => null);
    if (!chosen || chosen.companyId !== target.companyId || chosen.archived) throw refuse("QUICK_CREATE_PROJECT_INVALID", "Selected Project is no longer available.", "VALIDATION_ERROR");
    project = { id: chosen.id, name: chosen.label };
  }
  if (action.ownership === "PROJECT" && !project) throw refuse("QUICK_CREATE_PROJECT_REQUIRED", "Choose a Project to continue.", "VALIDATION_ERROR");

  const params = new URLSearchParams();
  let path = action.route;
  const put = (spec: string | undefined, values: string[]) => {
    if (!spec) return;
    if (spec.startsWith(":")) {
      path = path.replace(spec, encodeURIComponent(values[0]));
      return;
    }
    spec.split("|").forEach((name, index) => values[index] && params.set(name, values[index]));
  };
  if (project) put(action.context.project, [project.id]);
  if (page) {
    const record = page.dto;
    if (record.recordType === "client") put(action.context.client, [record.recordId]);
    // A contextual task or file is linked to the record it was raised from (§25, §102, §117-§120).
    if (record.recordType !== "project" && record.recordType !== "client") {
      put(action.context.relatedRecord, [record.recordType, record.recordId]);
      put(action.context.attachedRecord, [record.recordType, record.recordId]);
    }
  }
  const query = params.toString();
  return {
    href: query ? `${path}?${query}` : path,
    company: company(target),
    switchWorkspace: session.workspace.scopeType !== "COMPANY" || session.companyId !== target.companyId,
    creatingIn: [target.company.name, project?.name].filter(Boolean).join(" · "),
  };
}

/** Projects the person may open in the chosen company, for a flow that needs one (§71, §148). */
export async function projectChoices(session: UserContext, input: { actionKey: string; companyId?: string | null }): Promise<Array<{ id: string; name: string }>> {
  const action = QUICK_CREATE_BY_KEY.get(input.actionKey);
  if (!action) throw refuse("QUICK_CREATE_UNAVAILABLE", "This action is no longer available.", "NOT_FOUND");
  const target = await targetContext(session, action, input.companyId);
  if (!canAccessModule(target, "projects") || !can(target, "project.view")) return [];
  const rows = await prisma.project.findMany({
    where: { AND: [buildProjectScopeWhere(target), { companyId: target.companyId, archivedAt: null, status: { in: ["ACTIVE", "PENDING"] } }] },
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, name: true, code: true },
  });
  return rows.map((row) => ({ id: row.id, name: row.code ? `${row.code} · ${row.name}` : row.name }));
}
