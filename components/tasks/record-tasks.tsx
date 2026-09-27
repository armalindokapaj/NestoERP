import Link from "@/components/navigation/nav-link";
import { ListTodo } from "lucide-react";

import { PersonLink } from "@/components/people/person-link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can, canAccessModule } from "@/lib/access/can";
import type { Permission } from "@/config/permissions";
import type { UserContext } from "@/lib/context/types";
import { loadRecord, recordDefinition } from "@/lib/core/records/record.registry";
import { taskListQuerySchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";
import { getTranslations } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils/format";

/** The module grant a record's page needs to offer "Create task" (mirrors the task service). */
const TASK_GRANT: Partial<Record<string, Permission>> = {
  sales: "sales.task.create",
  contracts: "legal.task.create",
  procurement: "procurement.task.create",
  inventory: "inventory.task.create",
  qaqc: "qaqc.task.create",
  hse: "hse.task.create",
};

/**
 * Tasks raised from a business record (PRD #38 §45-§47).
 *
 * Lists the canonical tasks whose trusted parent is this record, in the
 * reader's own task scope, and offers "Create task" only when the task
 * service would accept one: tasks enabled, `task.create`, the module's task
 * grant, and a record that is not archived.
 */
export async function RecordTasks({
  context,
  parentType,
  parentId,
  title,
}: {
  context: UserContext;
  parentType: string;
  parentId: string;
  title?: string;
}) {
  const definition = recordDefinition(parentType);
  if (!definition || !canAccessModule(context, "tasks") || !can(context, "task.view")) return null;

  const [record, result] = await Promise.all([
    loadRecord(context, parentType, parentId),
    tasks.listTasks(
      context,
      taskListQuerySchema.parse({ moduleKey: definition.moduleKey, entityType: definition.type, entityId: parentId, limit: 25 }),
    ),
  ]);
  if (!record) return null;
  const t = await getTranslations("tasks");

  const grant = TASK_GRANT[definition.moduleKey];
  const mayCreate = !record.archived && can(context, "task.create") && (!grant || can(context, grant));
  const createHref = `/tasks/new?parentType=${encodeURIComponent(definition.type)}&parentId=${encodeURIComponent(parentId)}`;

  return (
    <section className="space-y-3" aria-labelledby={`tasks-${parentId}`} data-testid="record-tasks">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`tasks-${parentId}`} className="text-card font-semibold text-fg">
          {title ?? t("common.tasks")}
        </h2>
        {mayCreate && result.data.length > 0 ? (
          <Button asChild size="sm" variant="secondary">
            <Link href={createHref}>{t("common.createTask")}</Link>
          </Button>
        ) : null}
      </div>
      {result.data.length === 0 ? (
        <EmptyState
          icon={<ListTodo />}
          title={t("record.emptyTitle")}
          description={t("record.emptyDescription", { noun: definition.noun.toLowerCase() })}
          action={mayCreate ? { label: t("common.createTask"), href: createHref } : undefined}
        />
      ) : (
        <ul className="nesto-card divide-y divide-line">
          {result.data.map((task) => (
            <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <Link href={`/tasks/${task.id}`} className="min-w-0 truncate text-table font-medium text-fg hover:text-accent">
                {task.title}
              </Link>
              <span className="shrink-0 text-meta text-fg-subtle">
                {t(`status.${task.status}`)} · {task.dueDate ? formatDate(task.dueDate) : t("common.noDueDate")}
                {task.assignee ? (
                  <>
                    {" · "}
                    <PersonLink memberId={task.assignee.memberId} name={task.assignee.fullName} />
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
