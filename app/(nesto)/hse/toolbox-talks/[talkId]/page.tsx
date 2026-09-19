import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ToolboxActions } from "@/components/hse/record-actions";
import { HseActivityFeed } from "@/components/hse/record-activity";
import { HseRecordDocuments } from "@/components/hse/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as toolbox from "@/lib/modules/hse/toolbox/toolbox.service";
import { attendanceLabels } from "@/lib/modules/hse/hse.status";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";

type Params = { params: Promise<{ talkId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { talkId } = await params;
  try {
    const context = await requireModule("hse");
    const talk = await toolbox.getToolboxTalk(context, talkId);
    return { title: talk.talkNumber };
  } catch {
    return { title: "Toolbox talk" };
  }
}

/** One toolbox talk (PRD #22 §129, §132, §320). */
export default async function ToolboxTalkPage({ params }: Params) {
  const { talkId } = await params;
  const context = await requireModule("hse");

  let talk;
  try {
    talk = await toolbox.getToolboxTalk(context, talkId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const may = talk.capabilities;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "HSE", href: "/hse" },
          { label: "Toolbox talks", href: "/hse/toolbox-talks" },
          { label: talk.talkNumber },
        ]}
        title={talk.title}
        subtitle={`${talk.talkNumber} · ${talk.topic}`}
        status={talk.status}
        badges={
          <Badge tone="neutral">
            {talk.attendedCount} of {talk.participantCount} attended
          </Badge>
        }
        meta={[
          { label: "Project", value: talk.project?.code ?? "Company-wide" },
          { label: "Date", value: formatDate(talk.talkDate) },
          {
            label: "Conducted by",
            value: talk.conductedBy ? (
              <PersonLink memberId={talk.conductedBy.memberId} name={talk.conductedBy.fullName} />
            ) : (
              "—"
            ),
          },
        ]}
        actions={<ToolboxActions talk={talk} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">The talk</h2>
            <DetailGrid
              className="mt-4"
              items={[
                {
                  label: "Project",
                  value: talk.project ? (
                    <Link href={`/projects/${talk.project.id}`} className="hover:text-accent">
                      {talk.project.code} — {talk.project.name}
                    </Link>
                  ) : (
                    "Company-wide"
                  ),
                },
                { label: "Where", value: orDash(talk.locationText) },
                { label: "Topic", value: talk.topic },
              ]}
            />
            {talk.notes ? (
              <p className="mt-5 whitespace-pre-wrap border-t border-line pt-5 text-table text-fg-muted">
                {talk.notes}
              </p>
            ) : null}
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Who was there</h2>
            {talk.participants.length === 0 ? (
              <p className="mt-2 text-table text-fg-subtle">Nobody recorded yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {talk.participants.map((participant) => (
                  <li
                    key={participant.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                  >
                    <span className="text-table text-fg">
                      {participant.member ? (
                        <PersonLink memberId={participant.member.memberId} name={participant.member.fullName} />
                      ) : participant.worker ? (
                        <PersonLink personId={participant.worker.personId} name={participant.worker.name} />
                      ) : (
                        participant.externalName
                      )}
                      {participant.member ? null : participant.worker ? (
                        <span className="ml-2 text-meta text-fg-subtle">No NESTO account</span>
                      ) : (
                        <span className="ml-2 text-meta text-fg-subtle">External</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2 text-meta">
                      {participant.signatureRecorded ? (
                        <span className="text-fg-subtle">Signed</span>
                      ) : null}
                      <Badge
                        tone={
                          participant.attendanceStatus === "ATTENDED"
                            ? "success"
                            : participant.attendanceStatus === "ABSENT"
                              ? "danger"
                              : "neutral"
                        }
                      >
                        {attendanceLabels[participant.attendanceStatus]}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {may.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Documents</h2>
              <HseRecordDocuments
                context={context}
                entityType="toolbox_talk"
                entityId={talk.id}
                emptyDescription="The signed attendance sheet and any slides appear here."
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Record</h2>
            <dl className="mt-4 space-y-3">
              <Meta
                label="Recorded by"
                value={
                  talk.createdBy ? (
                    <PersonLink memberId={talk.createdBy.memberId} name={talk.createdBy.fullName} />
                  ) : (
                    "—"
                  )
                }
              />
              <Meta label="Recorded" value={formatDateTime(talk.createdAt)} />
              {talk.completedAt ? (
                <Meta label="Completed" value={formatDateTime(talk.completedAt)} />
              ) : null}
              {talk.cancelledAt ? (
                <Meta label="Cancelled" value={formatDateTime(talk.cancelledAt)} />
              ) : null}
            </dl>
          </section>

          {may.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Activity</h2>
              <HseActivityFeed context={context} entityType="ToolboxTalk" entityId={talk.id} />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="nesto-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 text-table text-fg">{value}</dd>
    </div>
  );
}
