import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { meetingClock, meetingDay, PlainText } from "@/components/meetings/meeting-ui";
import { PrintButton } from "@/components/meetings/print-button";
import {
  ACTION_STATUS_LABELS,
  AGENDA_STATUS_LABELS,
  ATTENDANCE_LABELS,
  LOCATION_TYPE_LABELS,
  MEETING_TYPE_LABELS,
  PARTICIPANT_ROLE_LABELS,
} from "@/lib/modules/meetings/meeting.types";
import { meetingsLabel } from "@/lib/i18n/modules/meetings/labels";
import { getTranslations } from "@/lib/i18n/server";
import { loadMeeting } from "../meeting-context";

type Params = { params: Promise<{ meetingId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meetings");
  return { title: t("meta.minutes") };
}

/**
 * Print-friendly minutes (PRD #40 §71, §110, §111, §203, §204): company,
 * meeting, date, project, people and attendance, agenda, minutes, decisions and
 * actions, as a formal document. The browser's own print dialog saves it as a
 * PDF. Everything is text: nothing written in the minutes is interpreted.
 */
export default async function MeetingPrintPage({ params }: Params) {
  const { meetingId } = await params;
  const { context, meeting } = await loadMeeting(meetingId);
  const zone = meeting.timezone;
  const t = await getTranslations("meetings");
  const final = meeting.minutesStatus === "FINAL";
  const dateTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: zone }).format(new Date(iso));

  return (
    <div>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #meeting-print, #meeting-print * { visibility: visible !important; }
          #meeting-print { position: absolute; inset: 0 auto auto 0; width: 100%; padding: 0 !important; border: 0 !important; box-shadow: none !important; }
          .no-print { display: none !important; }
          @page { margin: 18mm 16mm; }
        }
      `}</style>
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/meetings/${meeting.id}?tab=minutes`} className="text-table font-medium text-accent-strong">
          {t("common.backToMeeting")}
        </Link>
        <PrintButton />
      </div>

      <article id="meeting-print" className="mx-auto max-w-[820px] rounded-2xl border border-line bg-surface px-8 py-10 text-fg sm:px-12" data-testid="meeting-print">
        <header className="border-b border-line pb-6">
          <p className="text-micro font-semibold uppercase tracking-[0.14em] text-fg-subtle">{context.company.name}</p>
          <h1 className="mt-2 text-[26px] font-semibold leading-tight">{meeting.title}</h1>
          <p className="mt-1 text-table text-fg-muted">
            {t("print.minutesOf", { state: final ? t("print.final") : t("print.draftNotFinal") })}
          </p>
          <dl className="mt-5 grid gap-x-8 gap-y-2 text-table sm:grid-cols-2">
            <Row label={t("print.date")} value={meetingDay(meeting.startsAt, zone, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} />
            <Row label={t("print.time")} value={`${meetingClock(meeting.startsAt, zone)}–${meetingClock(meeting.endsAt, zone)} (${zone.replace("_", " ")})`} />
            <Row label={t("print.type")} value={meetingsLabel(t, "type", meeting.meetingType, MEETING_TYPE_LABELS[meeting.meetingType])} />
            {meeting.project ? <Row label={t("print.project")} value={`${meeting.project.code} · ${meeting.project.name}`} /> : null}
            <Row label={t("print.location")} value={[meetingsLabel(t, "location", meeting.locationType, LOCATION_TYPE_LABELS[meeting.locationType]), meeting.locationText].filter(Boolean).join(" · ")} />
            <Row label={t("print.organizer")} value={meeting.organizer.fullName} />
            {final && meeting.minutesFinalizedAt ? <Row label={t("print.finalized")} value={meeting.minutesFinalizedBy ? t("print.finalizedBy", { when: dateTime(meeting.minutesFinalizedAt), name: meeting.minutesFinalizedBy }) : dateTime(meeting.minutesFinalizedAt)} /> : null}
            {meeting.status === "CANCELLED" ? <Row label={t("print.status")} value={t("print.cancelled")} /> : null}
          </dl>
        </header>

        <Section title={t("print.participants")}>
          <table className="w-full text-table">
            <thead>
              <tr className="border-b border-line text-left text-meta text-fg-subtle">
                <th className="py-1.5 font-medium">{t("print.name")}</th>
                <th className="py-1.5 font-medium">{t("print.role")}</th>
                <th className="py-1.5 text-right font-medium">{t("print.attendance")}</th>
              </tr>
            </thead>
            <tbody>
              {meeting.participants.map((person) => (
                <tr key={person.memberId} className="border-b border-line/60">
                  <td className="py-1.5">{person.fullName}</td>
                  <td className="py-1.5 text-fg-muted">{meetingsLabel(t, "role", person.role, PARTICIPANT_ROLE_LABELS[person.role])}{person.required ? "" : t("print.optionalSuffix")}</td>
                  <td className="py-1.5 text-right text-fg-muted">{meetingsLabel(t, "attendance", person.attendance, ATTENDANCE_LABELS[person.attendance])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {meeting.agenda.length > 0 ? (
          <Section title={t("print.agenda")}>
            <ol className="space-y-1 text-table">
              {meeting.agenda.map((item, index) => (
                <li key={item.id} className="flex gap-3">
                  <span className="w-5 shrink-0 text-right tabular-nums text-fg-subtle">{index + 1}.</span>
                  <span className="flex-1">
                    {item.title}
                    {item.presenter ? <span className="text-fg-subtle"> — {item.presenter.fullName}</span> : null}
                  </span>
                  {item.status !== "PENDING" ? <span className="text-meta text-fg-subtle">{meetingsLabel(t, "agendaStatus", item.status, AGENDA_STATUS_LABELS[item.status])}</span> : null}
                </li>
              ))}
            </ol>
          </Section>
        ) : null}

        <Section title={t("print.minutes")}>
          {meeting.minutes.length === 0 ? (
            <p className="text-table text-fg-subtle">{t("print.noMinutes")}</p>
          ) : (
            <div className="space-y-5">
              {meeting.minutes.map((section) => (
                <div key={section.id}>
                  <h3 className="text-body font-semibold">{section.title}</h3>
                  {section.body.trim() ? <PlainText text={section.body} className="mt-1 text-body leading-relaxed" /> : <p className="mt-1 text-table text-fg-subtle">—</p>}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title={t("print.decisions")}>
          {meeting.decisions.length === 0 ? (
            <p className="text-table text-fg-subtle">{t("print.noDecisions")}</p>
          ) : (
            <ol className="space-y-3">
              {meeting.decisions.map((decision) => (
                <li key={decision.id} className="flex gap-3">
                  <span className="w-12 shrink-0 font-mono text-table font-semibold text-fg-muted">{decision.label}</span>
                  <span className="flex-1">
                    <span className="block text-body">{decision.title}</span>
                    {decision.description ? <PlainText text={decision.description} className="mt-0.5 text-table text-fg-muted" /> : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section title={t("print.actionItems")}>
          {meeting.actions.length === 0 ? (
            <p className="text-table text-fg-subtle">{t("print.noActions")}</p>
          ) : (
            <table className="w-full text-table">
              <thead>
                <tr className="border-b border-line text-left text-meta text-fg-subtle">
                  <th className="py-1.5 font-medium">{t("print.action")}</th>
                  <th className="py-1.5 font-medium">{t("print.owner")}</th>
                  <th className="py-1.5 font-medium">{t("print.due")}</th>
                  <th className="py-1.5 text-right font-medium">{t("print.status")}</th>
                </tr>
              </thead>
              <tbody>
                {meeting.actions.map((action) => (
                  <tr key={action.id} className="border-b border-line/60 align-top">
                    <td className="py-1.5 pr-3">{action.title}</td>
                    <td className="py-1.5 pr-3 text-fg-muted">{action.owner?.fullName ?? "—"}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-fg-muted">{action.dueDate ?? "—"}</td>
                    <td className="py-1.5 text-right text-fg-muted">{meetingsLabel(t, "actionStatus", action.status, ACTION_STATUS_LABELS[action.status])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <footer className="mt-10 border-t border-line pt-4 text-meta text-fg-subtle">
          {t("print.printed", { when: dateTime(new Date().toISOString()) })} {final ? "" : t("print.draftNote")}
        </footer>
      </article>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-fg-subtle">{label}</dt>
      <dd className="min-w-0">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 break-inside-avoid-page">
      <h2 className="mb-3 text-micro font-semibold uppercase tracking-[0.14em] text-fg-subtle">{title}</h2>
      {children}
    </section>
  );
}
