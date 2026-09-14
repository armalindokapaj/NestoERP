"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, CheckCircle2, Copy, FileText, Pencil, Pin, PinOff, Send, Upload } from "lucide-react";

import { useUploadQueue } from "@/components/documents/upload-queue";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { AcknowledgmentRowDTO, AnnouncementDetailDTO, AnnouncementMetricsDTO } from "@/lib/modules/announcements/announcement.types";
import { cn } from "@/lib/utils/cn";
import { announcementApi, failureMessage } from "./announcement-api";
import { AnnouncementBody } from "./announcement-body";
import { toLocalInput } from "./announcement-editor";
import { AnnouncementStatusBadge, formatDay, formatDayTime, PinnedMark, PriorityMark } from "./announcement-ui";

/**
 * Reading an announcement (PRD #45 §61, §62, §201, §206, §212-§215, §221-§224).
 *
 * An editorial page: scope and priority in small type, a large title, quiet
 * metadata, the body at reading width, the event and the attachments, and —
 * when asked — one explicit "I have read this". Opening the page records the
 * read once it has loaded; a card in a list never does. The people who manage
 * it get its lifecycle, counts and the acknowledgment list beside it.
 */

export function AnnouncementDetail({ initial, zone }: { initial: AnnouncementDetailDTO; zone: string }) {
  const router = useRouter();
  const toast = useToast();
  const [item, setItem] = React.useState(initial);
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [metrics, setMetrics] = React.useState<AnnouncementMetricsDTO | null>(null);
  const [people, setPeople] = React.useState<AcknowledgmentRowDTO[] | null>(null);
  const [showPending, setShowPending] = React.useState(true);
  const [publishAt, setPublishAt] = React.useState("");
  const [confirmArchive, setConfirmArchive] = React.useState(false);
  const caps = item.capabilities;
  const base = `/api/announcements/${item.id}`;
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => setItem(initial), [initial]);

  const refresh = React.useCallback(async () => {
    const next = await announcementApi<AnnouncementDetailDTO>(base);
    setItem(next);
    return next;
  }, [base]);

  // A read is recorded after the detail has loaded, not when a card was merely visible (§212, §213).
  React.useEffect(() => {
    if (initial.status === "PUBLISHED" || initial.status === "EXPIRED") void announcementApi(`${base}/read`, { body: {} }).catch(() => undefined);
  }, [base, initial.status]);

  React.useEffect(() => {
    if (!item.capabilities.canViewMetrics) return;
    void Promise.all([announcementApi<AnnouncementMetricsDTO>(`${base}/metrics`), announcementApi<AcknowledgmentRowDTO[]>(`${base}/acknowledgments`)])
      .then(([nextMetrics, nextPeople]) => {
        setMetrics(nextMetrics);
        setPeople(nextPeople);
      })
      .catch(() => undefined);
  }, [base, item.capabilities.canViewMetrics, item.version]);

  const upload = useUploadQueue({ parent: { context: "record", entityType: "announcement", entityId: item.id }, onUploaded: () => void refresh() });
  const uploading = upload.items.some((entry) => ["queued", "authorising", "uploading", "verifying", "processing"].includes(entry.status));

  async function act(key: string, run: () => Promise<unknown>, success: string, after?: () => void) {
    setPending(key);
    setError(null);
    try {
      await run();
      toast({ title: success, tone: "success" });
      after?.();
      await refresh();
      router.refresh();
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setPending(null);
    }
  }

  const awaitingAck = item.requiresAcknowledgment && !item.acknowledgedAt;
  const managerPanel = caps.canEdit || caps.canPublish || caps.canSchedule || caps.canUnschedule || caps.canArchive || caps.canPin || caps.canDuplicate || caps.canViewMetrics;

  return (
    <div className={cn("grid gap-8", managerPanel && "xl:grid-cols-[minmax(0,1fr)_20rem]")}>
      <article className="mx-auto w-full max-w-3xl pb-24 md:pb-0" data-testid="announcement-detail">
        <Link href="/announcements" className="inline-flex items-center gap-1.5 text-table text-fg-muted hover:text-fg">
          <ArrowLeft aria-hidden="true" className="size-4" />
          Announcements
        </Link>
        <div className="mt-6 flex flex-wrap items-center gap-2 text-meta text-fg-muted">
          <span className="font-medium uppercase tracking-[0.1em] text-fg-subtle" data-testid="announcement-scope">
            {item.audience.label}
          </span>
          <PriorityMark priority={item.priority} />
          {item.pinned ? <PinnedMark /> : null}
          {item.status !== "PUBLISHED" ? <AnnouncementStatusBadge status={item.status} /> : null}
        </div>
        <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-tight text-fg md:text-[34px]" data-testid="announcement-title">
          {item.title}
        </h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-fg-muted">
          {item.author ? <span className="font-medium text-fg">{item.author.name}</span> : null}
          <span>{item.publishedAt ? formatDay(item.publishedAt, zone) : item.status === "SCHEDULED" ? `Publishes ${formatDayTime(item.publishAt, zone)}` : "Not published"}</span>
          {item.edited ? <span title="Corrected after publishing">Updated</span> : null}
          {item.expiresAt ? <span>{item.status === "EXPIRED" ? "Expired" : "Until"} {formatDay(item.expiresAt, zone)}</span> : null}
        </p>

        {item.eventStartsAt ? (
          <div className="mt-6 flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
            <CalendarDays aria-hidden="true" className="size-5 text-fg-subtle" />
            <div>
              <p className="text-meta text-fg-subtle">Event</p>
              <p className="text-table font-medium text-fg">
                {formatDayTime(item.eventStartsAt, zone)}
                {item.eventEndsAt ? ` – ${formatDayTime(item.eventEndsAt, zone)}` : ""}
              </p>
            </div>
          </div>
        ) : null}

        <hr className="my-7 border-line" />
        <AnnouncementBody body={item.body} />

        {item.documents && (item.documents.length || caps.canUploadDocuments) ? (
          <section className="mt-10" aria-labelledby="attachments-title">
            <div className="flex items-center justify-between">
              <h2 id="attachments-title" className="text-meta font-medium uppercase tracking-[0.1em] text-fg-subtle">
                Attachments
              </h2>
              {caps.canUploadDocuments ? (
                <>
                  <input ref={fileRef} type="file" multiple className="sr-only" aria-label="Attach files" data-testid="announcement-upload" onChange={(event) => { if (event.target.files?.length) upload.enqueue([...event.target.files], (file) => ({ name: file.name })); event.target.value = ""; }} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    <Upload /> {uploading ? "Uploading…" : "Attach"}
                  </Button>
                </>
              ) : null}
            </div>
            <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface">
              {item.documents.map((document) => (
                <li key={document.documentId}>
                  <Link href={document.href} className="flex items-center gap-3 px-4 py-3 text-table hover:bg-row-hover" data-testid="announcement-attachment">
                    <FileText aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                    <span className="min-w-0 flex-1 truncate text-fg">{document.name}</span>
                    {document.extension ? <span className="shrink-0 text-meta uppercase text-fg-subtle">{document.extension}</span> : null}
                  </Link>
                </li>
              ))}
              {!item.documents.length ? <li className="px-4 py-3 text-table text-fg-subtle">No attachments.</li> : null}
            </ul>
          </section>
        ) : null}

        {item.requiresAcknowledgment && item.status !== "DRAFT" && item.status !== "SCHEDULED" ? (
          <section className={cn("mt-10 rounded-xl border px-5 py-4", item.acknowledgedAt ? "border-success/30 bg-success-soft/40" : "border-line bg-surface")} aria-label="Acknowledgment" data-testid="announcement-acknowledgment">
            {item.acknowledgedAt ? (
              <p className="flex items-center gap-2 text-table font-medium text-success-strong">
                <CheckCircle2 aria-hidden="true" className="size-4" />
                Acknowledged • {formatDayTime(item.acknowledgedAt, zone)}
              </p>
            ) : caps.canAcknowledge ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-table text-fg-muted">Please confirm you have read this announcement.</p>
                <Button type="button" className="hidden md:inline-flex" disabled={pending === "ack"} onClick={() => void act("ack", () => announcementApi(`${base}/acknowledge`, { body: {} }), "Acknowledged")}>
                  I have read this
                </Button>
              </div>
            ) : (
              <p className="text-table text-fg-muted">{item.status === "EXPIRED" ? "This announcement has expired." : "Readers are asked to acknowledge this announcement."}</p>
            )}
          </section>
        ) : null}
        {error ? <p role="alert" className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-table text-danger-strong">{error}</p> : null}

        {/* On a phone the one thing it asks for stays within reach (§201). */}
        {awaitingAck && caps.canAcknowledge ? (
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:hidden" data-testid="announcement-sticky-ack">
            <Button type="button" className="w-full" disabled={pending === "ack"} onClick={() => void act("ack", () => announcementApi(`${base}/acknowledge`, { body: {} }), "Acknowledged")}>
              I have read this
            </Button>
          </div>
        ) : null}
      </article>

      {managerPanel ? (
        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start" aria-label="Manage announcement" data-testid="announcement-manage">
          <section className="nesto-card space-y-3 px-4 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-card font-semibold text-fg">Manage</h2>
              <AnnouncementStatusBadge status={item.status} />
            </div>
            <div className="flex flex-wrap gap-2">
              {caps.canPublish ? (
                <Button type="button" size="sm" disabled={Boolean(pending)} onClick={() => void act("publish", () => announcementApi(`${base}/publish`, { body: { expectedVersion: item.version } }), "Announcement published")}>
                  <Send /> Publish now
                </Button>
              ) : null}
              {caps.canEdit ? (
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/announcements/${item.id}/edit`}>
                    <Pencil /> Edit
                  </Link>
                </Button>
              ) : null}
              {caps.canPin ? (
                <Button type="button" size="sm" variant="secondary" disabled={Boolean(pending)} onClick={() => void act("pin", () => announcementApi(`${base}/${item.pinned ? "unpin" : "pin"}`, { body: { expectedVersion: item.version } }), item.pinned ? "Unpinned" : "Pinned")}>
                  {item.pinned ? <PinOff /> : <Pin />} {item.pinned ? "Unpin" : "Pin"}
                </Button>
              ) : null}
              {caps.canDuplicate ? (
                <Button type="button" size="sm" variant="ghost" disabled={Boolean(pending)} onClick={() => void act("duplicate", async () => { const copy = await announcementApi<{ id: string }>(`${base}/duplicate`, { body: {} }); router.push(`/announcements/${copy.id}/edit`); }, "Copied into a new draft")}>
                  <Copy /> Duplicate
                </Button>
              ) : null}
            </div>
            {caps.canSchedule ? (
              <div className="space-y-1.5 border-t border-line pt-3">
                <label htmlFor="announcement-publish-at" className="text-meta font-medium text-fg-muted">
                  Schedule for
                </label>
                <div className="flex gap-2">
                  <Input id="announcement-publish-at" type="datetime-local" value={publishAt} min={toLocalInput(new Date().toISOString())} onChange={(event) => setPublishAt(event.target.value)} className="h-9" />
                  <Button type="button" size="sm" variant="secondary" className="h-9" disabled={!publishAt || Boolean(pending)} onClick={() => void act("schedule", () => announcementApi(`${base}/schedule`, { body: { expectedVersion: item.version, publishAt: new Date(publishAt).toISOString() } }), "Announcement scheduled")}>
                    Schedule
                  </Button>
                </div>
              </div>
            ) : null}
            {caps.canUnschedule ? (
              <div className="flex items-center justify-between gap-2 border-t border-line pt-3 text-table text-fg-muted">
                <span>Publishes {formatDayTime(item.publishAt, zone)}</span>
                <Button type="button" size="sm" variant="ghost" disabled={Boolean(pending)} onClick={() => void act("unschedule", () => announcementApi(`${base}/unschedule`, { body: { expectedVersion: item.version } }), "Back to draft")}>
                  Cancel schedule
                </Button>
              </div>
            ) : null}
            {caps.canArchive ? (
              <div className="border-t border-line pt-3">
                <Button type="button" size="sm" variant="ghost" className="text-danger-strong" disabled={Boolean(pending)} onClick={() => setConfirmArchive(true)}>
                  Archive
                </Button>
              </div>
            ) : null}
          </section>

          {caps.canViewMetrics && metrics ? (
            <section className="nesto-card px-4 py-4" aria-labelledby="metrics-title" data-testid="announcement-metrics">
              <h2 id="metrics-title" className="text-card font-semibold text-fg">
                Reach
              </h2>
              <dl className="mt-3 grid grid-cols-2 gap-3">
                {[
                  ["Audience", metrics.audience],
                  ["Read", metrics.read],
                  ...(metrics.requiresAcknowledgment ? [["Acknowledged", metrics.acknowledged], ["Pending", metrics.pending]] : []),
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <dt className="text-meta text-fg-subtle">{label}</dt>
                    <dd className="text-section font-semibold tabular-nums text-fg" data-testid={`metric-${String(label).toLowerCase()}`}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              {metrics.requiresAcknowledgment && people ? (
                <div className="mt-4">
                  <div className="flex gap-1" role="group" aria-label="Acknowledgments">
                    {[true, false].map((pendingView) => (
                      <button key={String(pendingView)} type="button" aria-pressed={showPending === pendingView} onClick={() => setShowPending(pendingView)} className={cn("rounded-full border px-2.5 py-0.5 text-meta", showPending === pendingView ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted")}>
                        {pendingView ? `Pending ${people.filter((row) => !row.acknowledgedAt).length}` : `Acknowledged ${people.filter((row) => row.acknowledgedAt).length}`}
                      </button>
                    ))}
                  </div>
                  <ul className="mt-2 max-h-72 divide-y divide-line overflow-y-auto">
                    {people.filter((row) => Boolean(row.acknowledgedAt) !== showPending).map((row) => (
                      <li key={row.memberId} className="flex items-center justify-between gap-2 py-1.5 text-table">
                        <span className="truncate text-fg">{row.name}</span>
                        <span className="shrink-0 text-meta text-fg-muted">{row.acknowledgedAt ? formatDay(row.acknowledgedAt, zone) : row.readAt ? "Read" : "Not read"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="mt-3 text-meta text-fg-subtle">For confirming the message reached people — not for rating anyone.</p>
            </section>
          ) : null}
        </aside>
      ) : null}

      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title="Archive this announcement?"
        description="It leaves every feed and stays on record. This cannot be undone."
        confirmLabel="Archive"
        pending={pending === "archive"}
        onConfirm={() => void act("archive", () => announcementApi(`${base}/archive`, { body: { expectedVersion: item.version } }), "Announcement archived", () => setConfirmArchive(false))}
      />
    </div>
  );
}
