import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "@/components/navigation/nav-link";
import { ListChecks, Plus } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { ActionStatusToggle } from "@/components/meetings/action-status-toggle";
import { PersonAvatar } from "@/components/meetings/meeting-ui";
import { ModulePage } from "@/components/modules/module-page";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import { CompanyTag } from "@/components/workspace/company-tag";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { actionListQuerySchema } from "@/lib/modules/meetings/meeting.schema";
import { listActionItemsForWorkspace, meetingCompanyOptions, meetingExperience } from "@/lib/modules/meetings/meeting.workspace";
import { ACTION_STATUS_LABELS } from "@/lib/modules/meetings/meeting.types";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Meeting actions" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

/**
 * Actions from meetings (PRD #40 §201 "My open meeting actions", §213): the
 * reader's own by default, or every action on meetings they can open. Opening
 * one leads to its meeting; a handed-off one also to its task.
 *
 * In the Group workspace it lists the actions of every company the person may
 * open Meetings in, each naming its company and opening through it; moving an
 * action along is a company edit, so it is not offered there (Workspace Context
 * §34, §45).
 */
export default async function MeetingActionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireModule("meetings");
  const experience = meetingExperience(context);
  const params = await searchParams;
  const group = inGroupWorkspace(context);
  const query = actionListQuerySchema.parse({ mine: one(params.mine), status: one(params.status), company: one(params.company), page: one(params.page) });
  const [result, companies] = await Promise.all([listActionItemsForWorkspace(context, query), meetingCompanyOptions(context)]);
  // A company id in the address only ever narrows to a company the list already offers.
  const company = group && companies.some((option) => option.id === query.company) ? query.company : undefined;

  const link = (patch: Record<string, string>) => {
    const next = new URLSearchParams({ ...(query.mine ? {} : { mine: "false" }), ...(query.status !== "open" ? { status: query.status } : {}), ...(company ? { company } : {}), ...patch });
    for (const [key, value] of [...next.entries()]) if (value === "") next.delete(key);
    const search = next.toString();
    return search ? `/meetings/actions?${search}` : "/meetings/actions";
  };
  // One it does not offer narrows the list to nothing (AUD-08 DT-22); the address moves once to the
  // canonical one without it, so the chips and the rows say the same thing.
  if (query.company && group && !company) redirect(link({ page: "" }));
  // A page past the end (an action done, a narrower view) moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(link(result.pagination.page > 1 ? { page: String(result.pagination.page) } : {}));
  const chip = (active: boolean) =>
    cn("inline-flex items-center rounded-full border px-3 py-1 text-table transition-colors touch:min-h-11", active ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg");

  return (
    <ModulePage
      experience={experience}
      activeSection="actions"
      actions={
        !group && can(context, "meeting.create") ? (
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
          {/* Group only: narrows the list to one company, which is a filter and not the workspace (Workspace Context §86, §87). */}
          {group && companies.length > 1 ? (
            <>
              <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
              <nav aria-label="Company" className="flex flex-wrap gap-1.5">
                <Link href={link({ company: "" })} className={chip(!company)} aria-current={!company ? "page" : undefined}>
                  All companies
                </Link>
                {companies.map((option) => (
                  <Link key={option.id} href={link({ company: option.id })} className={chip(company === option.id)} aria-current={company === option.id ? "page" : undefined}>
                    {option.name}
                  </Link>
                ))}
              </nav>
            </>
          ) : null}
        </div>

        {result.data.length === 0 ? (
          <EmptyState
            icon={<ListChecks />}
            title={query.status === "open" ? "No open actions." : "No actions here."}
            description={group ? "No accessible data for this module." : query.mine ? "Actions assigned to you in meetings appear here." : "Actions from meetings you can open appear here."}
          />
        ) : (
          <ul className="nesto-card divide-y divide-line" data-testid="action-list">
            {result.data.map((action) => (
              <li key={action.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5" data-testid="action-row">
                <span className="pt-0.5">
                  <ActionStatusToggle meetingId={action.meeting.id} actionId={action.id} title={action.title} done={action.status === "DONE"} disabled={group || !action.capabilities.canChangeStatus} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-body font-medium text-fg", action.status === "DONE" && "text-fg-muted line-through")}>{action.title}</span>
                  <span className="mt-0.5 block truncate text-meta text-fg-muted">
                    {action.company ? (
                      <CompanyRecordLink companyId={action.company.id} companyName={action.company.name} href={action.meeting.href} className="hover:text-accent-strong">
                        {action.meeting.title}
                      </CompanyRecordLink>
                    ) : (
                      <Link href={action.meeting.href} className="hover:text-accent-strong">
                        {action.meeting.title}
                      </Link>
                    )}
                    {action.project ? ` · ${action.project.name}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                  {action.company ? <CompanyTag name={action.company.name} /> : null}
                  {action.task ? (
                    action.task.href ? (
                      action.company ? (
                        <CompanyRecordLink companyId={action.company.id} companyName={action.company.name} href={action.task.href} className="text-meta font-medium text-accent-strong hover:underline">
                          Task
                        </CompanyRecordLink>
                      ) : (
                        <Link href={action.task.href} className="text-meta font-medium text-accent-strong hover:underline">
                          Task
                        </Link>
                      )
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
