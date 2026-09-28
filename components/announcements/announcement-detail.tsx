"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { ArrowLeft, CalendarDays, CheckCircle2, Copy, FileText, Pencil, Pin, PinOff, Send, Upload } from "lucide-react";

import { UPLOAD_IN_FLIGHT, useUploadQueue } from "@/components/documents/upload-queue";
import { PersonLink } from "@/components/people/person-link";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import type { AcknowledgmentRowDTO, AnnouncementDetailDTO, AnnouncementMetricsDTO } from "@/lib/modules/announcements/announcement.types";
import { cn } from "@/lib/utils/cn";
import { announcementApi, failureMessage } from "./announcement-api";
import { AnnouncementBody } from "./announcement-body";
import { toLocalInput } from "./announcement-editor";
import { useAnnouncementsTranslations } from "./announcements-text";
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
  const t = useAnnouncementsTranslations();
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
  const uploading = upload.items.some((entry) => UPLOAD_IN_FLIGHT.includes(entry.status));

  // AUD-03 §3: a chosen publish time is input whose only way forward is the
  // Schedule step (never run from the prompt), and an attachment on its way is
  // lost by leaving. Finished uploads are stored; discarding never deletes them.
  const editor = useUnsavedEditor({ module: "announcements", saveKind: "none", workflow: t("detail.schedule"), label: t("detail.scheduleFor") });
  const { setDirty, setSaving, setPendingUploads } = editor;
  React.useEffect(() => setDirty(caps.canSchedule && publishAt !== ""), [caps.canSchedule, publishAt, setDirty]);
  React.useEffect(() => setSaving(pending === "schedule"), [pending, setSaving]);
  React.useEffect(() => setPendingUploads(uploading), [uploading, setPendingUploads]);

  async function act(key: string, run: () => Promise<unknown>, success: string, after?: () => void) {
    setPending(key);
    setError(null);
    try {
      await run();
    } catch (failure) {
      setError(failureMessage(failure));
      setPending(null);
      return;
    }
    // Done. A failed read-back is reported as such, and only the read is
    // retried — never the step (AUD-07 §7, PS-16).
    toast({ title: success, tone: "success" });
    after?.();
    try {
      await refresh();
    } catch {
      toast({ title: t("detail.refreshFailed"), tone: "warning" });
    } finally {
      router.refresh();
      setPending(null);
    }
  }

  const awaitingAck = item.requiresAcknowledgment && !item.acknowledgedAt;
  const managerPanel = caps.canEdit || caps.canPublish || caps.canSchedule || caps.canUnschedule || caps.canArchive || caps.canPin || caps.canDuplicate || caps.canViewMetrics;

  return (
    <div className={cn("grid gap-8", managerPanel && "xl:grid-cols-[minmax(0,1fr)_20rem]")}>
      <article className="mx-auto w-full max-w-3xl pb-24 md:pb-0" data-testid="announcement-detail">
        {/* Activity Center / Announcements / this one (Activity Center §167). */}
        <Link href="/activity?type=announcements" className="inline-flex items-center gap-1.5 text-table text-fg-muted hover:text-fg">
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t("detail.back")}
        </Link>
        <div className="mt-6 flex flex-wrap items-center gap-2 text-meta text-fg-muted">
          <span className="font-medium uppercase tracking-[0.1em] text-fg-subtle" data-testid="announcement-scope">
            {item.audience.label}
          </span>
          <PriorityMark priority={item.priority} />
          {item.pinned ? <PinnedMark /> : null}
          {item.status !== "PUBLISHED" ? <AnnouncementStatusBadge status={item.status} /> : null}
        </div>
        <h1 className="mt-3 text-page font-semibold leading-tight tracking-tight text-fg md:text-[34px]" data-testid="announcement-title">
          {item.title}
        </h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-fg-muted">
          {item.author ? <PersonLink memberId={item.author.memberId} name={item.author.name} /> : null}
          <span>{item.publishedAt ? formatDay(item.publishedAt, zone) : item.status === "SCHEDULED" ? t("detail.publishes", { date: formatDayTime(item.publishAt, zone) }) : t("detail.notPublished")}</span>
          {item.edited ? <span title={t("detail.correctedAfter")}>{t("detail.updated")}</span> : null}
          {item.expiresAt ? <span>{item.status === "EXPIRED" ? t("detail.expired") : t("detail.until")} {formatDay(item.expiresAt, zone)}</span> : null}
        </p>

        {item.eventStartsAt ? (
          <div className="mt-6 flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
            <CalendarDays aria-hidden="true" className="size-5 text-fg-subtle" />
            <div>
              <p className="text-meta text-fg-subtle">{t("detail.event")}</p>
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
                {t("detail.attachments")}
              </h2>
              {caps.canUploadDocuments ? (
                <>
                  <input ref={fileRef} type="file" multiple className="sr-only" aria-label={t("detail.attachFiles")} data-testid="announcement-upload" onChange={(event) => { if (event.target.files?.length) upload.enqueue([...event.target.files], (file) => ({ name: file.name })); event.target.value = ""; }} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    <Upload /> {uploading ? t("detail.uploading") : t("detail.attach")}
                  </Button>
                </>
              ) : null}
            </div>
            <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface">
              {item.documents.map((document) => (
                <li key={document.documentId}>
                  {/* A file, served by the announcement to everybody who can read it (Activity Center §47, §150): a plain link, opened in a new tab. */}
                  <a href={`${document.href}?inline=1`} target="_blank" rel="noopener" className="flex items-center gap-3 px-4 py-3 text-table hover:bg-row-hover" data-testid="announcement-attachment">
                    <FileText aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                    <span className="min-w-0 flex-1 truncate text-fg">{document.name}</span>
                    {document.extension ? <span className="shrink-0 text-meta uppercase text-fg-subtle">{document.extension}</span> : null}
                  </a>
                </li>
              ))}
              {!item.documents.length ? <li className="px-4 py-3 text-table text-fg-subtle">{t("detail.noAttachments")}</li> : null}
            </ul>
          </section>
        ) : null}

        {item.requiresAcknowledgment && item.status !== "DRAFT" && item.status !== "SCHEDULED" ? (
          <section className={cn("mt-10 rounded-xl border px-5 py-4", item.acknowledgedAt ? "border-success/30 bg-success-soft/40" : "border-line bg-surface")} aria-label={t("detail.acknowledgment")} data-testid="announcement-acknowledgment">
            {item.acknowledgedAt ? (
              <p className="flex items-center gap-2 text-table font-medium text-success-strong">
                <CheckCircle2 aria-hidden="true" className="size-4" />
                {t("detail.acknowledgedAt", { date: formatDayTime(item.acknowledgedAt, zone) })}
              </p>
            ) : caps.canAcknowledge ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-table text-fg-muted">{t("detail.confirmRead")}</p>
                <Button type="button" className="hidden md:inline-flex" disabled={pending === "ack"} onClick={() => void act("ack", () => announcementApi(`${base}/acknowledge`, { body: {} }), t("detail.acknowledged"))}>
                  {t("detail.iHaveRead")}
                </Button>
              </div>
            ) : (
              <p className="text-table text-fg-muted">{item.status === "EXPIRED" ? t("detail.hasExpired") : t("detail.readersAsked")}</p>
            )}
          </section>
        ) : null}
        {error ? <p role="alert" className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-table text-danger-strong">{error}</p> : null}

        {/* On a phone the one thing it asks for stays within reach (§201). */}
        {awaitingAck && caps.canAcknowledge ? (
          // Clear of the home indicator; marked so focus and toasts keep clear of it (AUD-04 §6, D-08-22, MW-19).
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:hidden" data-testid="announcement-sticky-ack" data-sticky-action-bar>
            <Button type="button" className="w-full" disabled={pending === "ack"} onClick={() => void act("ack", () => announcementApi(`${base}/acknowledge`, { body: {} }), t("detail.acknowledged"))}>
              {t("detail.iHaveRead")}
            </Button>
          </div>
        ) : null}
      </article>

      {managerPanel ? (
        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start" aria-label={t("detail.manageLabel")} data-testid="announcement-manage">
          <section className="nesto-card space-y-3 px-4 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-card font-semibold text-fg">{t("detail.manage")}</h2>
              <AnnouncementStatusBadge status={item.status} />
            </div>
            <div className="flex flex-wrap gap-2">
              {caps.canPublish ? (
                <Button type="button" size="sm" disabled={Boolean(pending)} onClick={() => void act("publish", () => announcementApi(`${base}/publish`, { body: { expectedVersion: item.version } }), t("detail.published"))}>
                  <Send /> {t("detail.publishNow")}
                </Button>
              ) : null}
              {caps.canEdit ? (
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/announcements/${item.id}/edit`}>
                    <Pencil /> {t("detail.edit")}
                  </Link>
                </Button>
              ) : null}
              {caps.canPin ? (
                <Button type="button" size="sm" variant="secondary" disabled={Boolean(pending)} onClick={() => void act("pin", () => announcementApi(`${base}/${item.pinned ? "unpin" : "pin"}`, { body: { expectedVersion: item.version } }), item.pinned ? t("detail.unpinned") : t("detail.pinned"))}>
                  {item.pinned ? <PinOff /> : <Pin />} {item.pinned ? t("detail.unpin") : t("detail.pin")}
                </Button>
              ) : null}
              {caps.canDuplicate ? (
                <Button type="button" size="sm" variant="ghost" disabled={Boolean(pending)} onClick={() => void act("duplicate", async () => { const copy = await announcementApi<{ id: string }>(`${base}/duplicate`, { body: {} }); router.push(`/announcements/${copy.id}/edit`); }, t("detail.copied"))}>
                  <Copy /> {t("detail.duplicate")}
                </Button>
              ) : null}
            </div>
            {caps.canSchedule ? (
              <div className="space-y-1.5 border-t border-line pt-3">
                <label htmlFor="announcement-publish-at" className="text-meta font-medium text-fg-muted">
                  {t("detail.scheduleFor")}
                </label>
                <div className="flex gap-2">
                  <Input id="announcement-publish-at" type="datetime-local" value={publishAt} min={toLocalInput(new Date().toISOString())} onChange={(event) => setPublishAt(event.target.value)} className="h-9" />
                  <Button type="button" size="sm" variant="secondary" className="h-9" disabled={!publishAt || Boolean(pending)} onClick={() => void act("schedule", () => announcementApi(`${base}/schedule`, { body: { expectedVersion: item.version, publishAt: new Date(publishAt).toISOString() } }), t("detail.scheduled"), () => setPublishAt(""))}>
                    {t("detail.schedule")}
                  </Button>
                </div>
              </div>
            ) : null}
            {caps.canUnschedule ? (
              <div className="flex items-center justify-between gap-2 border-t border-line pt-3 text-table text-fg-muted">
                <span>{t("detail.publishes", { date: formatDayTime(item.publishAt, zone) })}</span>
                <Button type="button" size="sm" variant="ghost" disabled={Boolean(pending)} onClick={() => void act("unschedule", () => announcementApi(`${base}/unschedule`, { body: { expectedVersion: item.version } }), t("detail.backToDraft"))}>
                  {t("detail.cancelSchedule")}
                </Button>
              </div>
            ) : null}
            {caps.canArchive ? (
              <div className="border-t border-line pt-3">
                <Button type="button" size="sm" variant="ghost" className="text-danger-strong" disabled={Boolean(pending)} onClick={() => setConfirmArchive(true)}>
                  {t("detail.archive")}
                </Button>
              </div>
            ) : null}
          </section>

          {caps.canViewMetrics && metrics ? (
            <section className="nesto-card px-4 py-4" aria-labelledby="metrics-title" data-testid="announcement-metrics">
              <h2 id="metrics-title" className="text-card font-semibold text-fg">
                {t("detail.reach")}
              </h2>
              <dl className="mt-3 grid grid-cols-2 gap-3">
                {[
                  ["audience", t("detail.audience"), metrics.audience],
                  ["read", t("detail.read"), metrics.read],
                  ...(metrics.requiresAcknowledgment ? [["acknowledged", t("detail.acknowledged"), metrics.acknowledged], ["pending", t("detail.pending"), metrics.pending]] : []),
                ].map(([id, label, value]) => (
                  <div key={id as string}>
                    <dt className="text-meta text-fg-subtle">{label}</dt>
                    <dd className="text-section font-semibold tabular-nums text-fg" data-testid={`metric-${String(id)}`}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              {metrics.requiresAcknowledgment && people ? (
                <div className="mt-4">
                  <div className="flex gap-1" role="group" aria-label={t("detail.acknowledgments")}>
                    {[true, false].map((pendingView) => (
                      <button key={String(pendingView)} type="button" aria-pressed={showPending === pendingView} onClick={() => setShowPending(pendingView)} className={cn("rounded-full border px-2.5 py-0.5 text-meta", showPending === pendingView ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted")}>
                        {pendingView ? t("detail.pendingCount", { count: people.filter((row) => !row.acknowledgedAt).length }) : t("detail.acknowledgedCount", { count: people.filter((row) => row.acknowledgedAt).length })}
                      </button>
                    ))}
                  </div>
                  <ul className="mt-2 max-h-72 divide-y divide-line overflow-y-auto">
                    {people.filter((row) => Boolean(row.acknowledgedAt) !== showPending).map((row) => (
                      <li key={row.memberId} className="flex items-center justify-between gap-2 py-1.5 text-table">
                        <PersonLink memberId={row.memberId} name={row.name} className="truncate" />
                        <span className="shrink-0 text-meta text-fg-muted">{row.acknowledgedAt ? formatDay(row.acknowledgedAt, zone) : row.readAt ? t("detail.read") : t("detail.notRead")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="mt-3 text-meta text-fg-subtle">{t("detail.reachNote")}</p>
            </section>
          ) : null}
        </aside>
      ) : null}

      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={t("detail.archiveTitle")}
        description={t("detail.archiveBody")}
        confirmLabel={t("detail.archive")}
        pending={pending === "archive"}
        onConfirm={() => void act("archive", () => announcementApi(`${base}/archive`, { body: { expectedVersion: item.version } }), t("detail.archived"), () => setConfirmArchive(false))}
      />
    </div>
  );
}
