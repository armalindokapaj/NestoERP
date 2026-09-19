import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks, Plus } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { ActionStatusToggle } from "@/components/meetings/action-status-toggle";
import { PersonAvatar } from "@/components/meetings/meeting-ui";
import { ModulePage } from "@/components/modules/module-page";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { listActionItems } from "@/lib/modules/meetings/meeting.actions";
import { actionListQuerySchema } from "@/lib/modules/meetings/meeting.schema";
import { ACTION_STATUS_LABELS } from "@/lib/modules/meetings/meeting.types";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Meeting actions" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

/**
 * Actions from meetings (PRD #40 §201 "My open meeting actions", §213): the
 * reader's own by default, or every action on meetings they can open. Opening
 * one leads to its meeting; a handed-off one also to its task.
 */
export default async function MeetingActionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireModule("meetings");
  const experience = resolveModuleExperience(context, "meetings");
  const params = await searchParams;
  const query = actionListQuerySchema.parse({ mine: one(params.mine), status: one(params.status), page: one(params.page) });
  const result = await listActionItems(context, query);

  const link = (patch: Record<string, string>) => {
    const next = new URLSearchParams({ ...(query.mine ? {} : { mine: "false" }), ...(query.status !== "open" ? { status: query.status } : {}), ...patch });
    for (const [key, value] of [...next.entries()]) if (value === "") next.delete(key);
    const search = next.toString();
    return search ? `/meetings/actions?${search}` : "/meetings/actions";
  };
  const chip = (active: boolean) =>
    cn("rounded-full border px-3 py-1 text-table transition-colors", active ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg");

  return (
    <ModulePage
      experience={experience}
      activeSection="actions"
      actions={
        can(context, "meeting.create") ? (
          <Button asChild size="sm">
            <Link href="/meetings/new">
              <Plus aria-hidden="true" />
              New meeting
            </Link>
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Whose actions" className="flex gap-1.5">
            <Link href={link({ mine: "" })} className={chip(query.mine)} aria-current={query.mine ? "page" : undefined}>
              Mine
            </Link>
            <Link href={link({ mine: "false" })} className={chip(!query.mine)} aria-current={!query.mine ? "page" : undefined}>
              Everyone&apos;s
            </Link>
          </nav>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
          <nav aria-label="Action status" className="flex gap-1.5">
            {(["open", "done", "all"] as const).map((status) => (
              <Link key={status} href={link({ status: status === "open" ? "" : status })} className={chip(query.status === status)} aria-current={query.status === status ? "page" : undefined}>
                {status === "open" ? "Open" : status === "done" ? "Done" : "All"}
              </Link>
            ))}
          </nav>
        </div>

        {result.data.length === 0 ? (
          <EmptyState
            icon={<ListChecks />}
            title={query.status === "open" ? "No open actions." : "No actions here."}
            description={query.mine ? "Actions assigned to you in meetings appear here." : "Actions from meetings you can open appear here."}
          />
        ) : (
          <ul className="nesto-card divide-y divide-line" data-testid="action-list">
            {result.data.map((action) => (
              <li key={action.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5" data-testid="action-row">
                <span className="pt-0.5">
                  <ActionStatusToggle meetingId={action.meeting.id} actionId={action.id} title={action.title} done={action.status === "DONE"} disabled={!action.capabilities.canChangeStatus} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-body font-medium text-fg", action.status === "DONE" && "text-fg-muted line-through")}>{action.title}</span>
                  <span className="mt-0.5 block truncate text-meta text-fg-muted">
                    <Link href={action.meeting.href} className="hover:text-accent-strong">
                      {action.meeting.title}
                    </Link>
                    {action.project ? ` · ${action.project.name}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                  {action.task ? (
                    action.task.href ? (
                      <Link href={action.task.href} className="text-meta font-medium text-accent-strong hover:underline">
                        Task
                      </Link>
                    ) : (
                      <span className="text-meta text-fg-subtle">Task</span>
                    )
                  ) : null}
                  {action.dueDate ? (
                    <span className={cn("text-meta tabular-nums", action.overdue ? "font-medium text-danger-strong" : "text-fg-muted")}>
                      {action.overdue ? "Overdue · " : "Due "}
                      {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${action.dueDate}T12:00:00Z`))}
                    </span>
                  ) : null}
                  {action.status === "IN_PROGRESS" ? <Badge tone="info">{ACTION_STATUS_LABELS.IN_PROGRESS}</Badge> : null}
                  {action.status === "CANCELLED" ? <Badge>{ACTION_STATUS_LABELS.CANCELLED}</Badge> : null}
                  {action.owner && !query.mine ? (
                    <span className="flex items-center gap-1.5 text-meta text-fg-muted" title={action.owner.fullName}>
                      <PersonAvatar person={action.owner} />
                      <span className="hidden md:inline">
                        <PersonLink memberId={action.owner.memberId} name={action.owner.fullName} />
                      </span>
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Pagination meta={result.pagination} buildHref={(page) => link(page > 1 ? { page: String(page) } : {})} />
      </div>
    </ModulePage>
  );
}
