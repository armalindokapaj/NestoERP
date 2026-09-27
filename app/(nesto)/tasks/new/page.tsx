import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TaskForm } from "@/components/tasks/task-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { WhatIsThis } from "@/components/help/what-is-this";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { createTaskAction } from "@/lib/actions/tasks";
import { taskFormOptions } from "@/lib/modules/tasks/task.options";
import { loadRecord, recordDefinition } from "@/lib/core/records/record.registry";
import { buildLeadScopeWhere, buildOpportunityScopeWhere } from "@/lib/modules/sales/sales.scope";
import { prisma } from "@/lib/database/prisma";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tasks");
  return { title: t("meta.newTask") };
}

/**
 * Create a task (PRD #11 §41, §89).
 *
 * `?projectId=` preselects the project when the form is opened from a project's
 * Tasks tab. The service revalidates that project against the caller's scope,
 * so a hand-edited parameter cannot place work on a project they cannot see
 * (PRD #11 §90).
 */
export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("tasks");
  if (!can(context, "task.create")) notFound();

  const params = await searchParams;
  const t = await getTranslations("tasks");
  const requestedProjectId = typeof params.projectId === "string" ? params.projectId : "";
  const parentType = typeof params.parentType === "string" ? params.parentType : "";
  const parentId = typeof params.parentId === "string" ? params.parentId : "";

  /*
   * A task raised from a record (PRD #38 §45-§47). The record is read here only
   * to label the form; the action sends `type:id` back and the service reads
   * it again, in scope, before anything is written. A record this person
   * cannot open is a 404, not an unlocked form.
   */
  let parent: Parameters<typeof TaskForm>[0]["parent"];
  let cancelHref = "/tasks/all";
  if (parentType && parentId) {
    const definition = recordDefinition(parentType);
    const record = definition ? await loadRecord(context, parentType, parentId) : null;
    if (!definition || !record || record.archived) notFound();
    parent = { locked: { value: `${definition.type}:${record.id}`, label: `${definition.noun} · ${record.label}` } };
    cancelHref = record.href;
  } else if (params.module === "sales") {
    // Sales tasks always belong to a lead or an opportunity, so the form asks
    // which — a sales task with no sales record would vanish from Sales.
    if (!can(context, "sales.task.create")) notFound();
    const [leads, opportunities] = await Promise.all([
      can(context, "sales.lead.view")
        ? prisma.lead.findMany({ where: { AND: [buildLeadScopeWhere(context), { archivedAt: null }] }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" }, take: 100 })
        : [],
      can(context, "sales.opportunity.view")
        ? prisma.opportunity.findMany({ where: { AND: [buildOpportunityScopeWhere(context), { archivedAt: null }] }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" }, take: 100 })
        : [],
    ]);
    parent = {
      label: t("create.leadOrOpportunity"),
      options: [
        ...opportunities.map((row) => ({ value: `opportunity:${row.id}`, label: `${t("create.opportunity")} · ${row.name}` })),
        ...leads.map((row) => ({ value: `lead:${row.id}`, label: `${t("create.lead")} · ${row.name}` })),
      ],
    };
    cancelHref = "/sales/tasks";
  }

  const options = await taskFormOptions(context, requestedProjectId || null);
  // Only offer a project the picker itself can list, so the preselection can
  // never disagree with what the service will accept.
  const projectId = options.projects.some((option) => option.value === requestedProjectId)
    ? requestedProjectId
    : "";

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("common.tasks"), href: "/tasks" },
          { label: t("common.newTask") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("create.heading")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("create.intro")}
        </p>
        {/* Project choice and assignment are where a first task goes wrong (AUD-05 §7, UX-13, UX-15). */}
        <WhatIsThis id="tasks.create.project" title={t("create.helpTitle")} className="mt-2">
          <p>{t("create.helpProject")}</p>
          <p>
            {options.mayAssignOthers
              ? t("create.helpAssignOthers")
              : t("create.helpAssignSelf")}
          </p>
        </WhatIsThis>
      </div>

      <TaskForm
        mode="create"
        cancelHref={cancelHref}
        parent={parent}
        projects={options.projects}
        assignees={options.assignees}
        mayAssignOthers={options.mayAssignOthers}
        // The assignees were read for the requested project, which the picker
        // may not offer; the form reads them again for its own (AUD-09 §5).
        assigneesFor={requestedProjectId}
        action={createTaskAction}
        initial={{
          title: "",
          description: "",
          projectId,
          assigneeMemberId: options.mayAssignOthers ? "" : context.membershipId,
          status: "TODO",
          priority: "MEDIUM",
          startDate: "",
          dueDate: "",
        }}
      />
    </div>
  );
}
