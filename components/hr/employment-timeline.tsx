import Link from "@/components/navigation/nav-link";
import { ArrowRight, FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { PersonLink } from "@/components/people/person-link";
import type { TimelineEventDTO } from "@/lib/modules/hr/employment/employment.types";
import { formatDate } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";

/**
 * An employment timeline, newest first (E-03 §123-§131, §173).
 *
 * Each card is one dated event: what it was, what the person then held, what
 * changed from what, and — only when the reader may open it — the document it
 * rests on. The event is said in words, never by colour alone, and every date
 * is a real `<time>`.
 */
export async function EmploymentTimeline({ events, showCompany = false, emptyText }: { events: TimelineEventDTO[]; showCompany?: boolean; emptyText?: string }) {
  const t = await getTranslations("hr");
  if (events.length === 0) return <p className="text-table text-fg-muted">{emptyText ?? t("timeline.empty")}</p>;
  return (
    <ol className="relative space-y-4 border-l border-line pl-5" aria-label={t("timeline.label")}>
      {events.map((event) => (
        <li key={event.id} className="relative" data-testid="timeline-event">
          <span aria-hidden="true" className="absolute -left-[1.625rem] top-1.5 size-2.5 rounded-full border-2 border-surface bg-accent" />
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <time dateTime={event.date} className="text-meta font-medium text-fg-muted">
              {formatDate(event.date)}
            </time>
            <h3 className="text-table font-semibold text-fg">{event.title}</h3>
            {showCompany ? <span className="text-meta text-fg-subtle">· {event.company.name}</span> : null}
            {event.corrected ? <Badge tone="warning">{t("history.corrected")}</Badge> : null}
          </div>
          {event.summary.length > 0 ? <p className="mt-1 text-table text-fg-muted">{event.summary.join(" · ")}</p> : null}
          {event.changes.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5 text-meta text-fg-muted">
              {event.changes.map((change) => (
                <li key={change.label} className="flex flex-wrap items-center gap-1">
                  <span className="font-medium text-fg">{change.label}:</span>
                  <span>{change.from ?? t("timeline.none")}</span>
                  <ArrowRight aria-label={t("reports.to")} className="size-3" />
                  <span>{change.to ?? t("timeline.none")}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {event.document || event.createdBy ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-3 text-meta text-fg-subtle">
              {event.document ? (
                <Link href={event.document.href} className="inline-flex items-center gap-1 text-accent-strong hover:underline">
                  <FileText aria-hidden="true" className="size-3.5" />
                  {event.document.name}
                </Link>
              ) : null}
              {event.createdBy ? (
                <span>
                  {t("common.recordedBy")} <PersonLink userId={event.createdByUserId} name={event.createdBy} />
                </span>
              ) : null}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
