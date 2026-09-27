"use client";

import * as React from "react";
import { Check, CheckCheck, Loader2, Megaphone, X } from "lucide-react";

import Link from "@/components/navigation/nav-link";
import { useFeedbackRouter } from "@/components/navigation/navigation-feedback";
import { useLocale, useTranslations } from "@/components/i18n/i18n-provider";
import { useToast } from "@/components/ui/toast";
import { CompanyTag } from "@/components/workspace/company-tag";
import { useOpenRecord } from "@/components/workspace/use-open-record";
import type { ActivityController, ActivitySnapshot } from "@/lib/activity/activity-controller";
import { publishActivityChange, relativeTime } from "@/lib/activity/client";
import type { ActivityCenterItem, ActivityType } from "@/lib/modules/activity/activity-center.service";
import { cn } from "@/lib/utils/cn";

/**
 * The Activity Center panel's body, loaded when the bell opens (Activity
 * Center PRD §9, §10, §30, §56, §102-§113, §121-§122; NAV-03 §6, §9).
 *
 * Opening reads nothing; an item becomes read when it is opened or marked,
 * and "Mark all" never acknowledges. Every read goes through the controller:
 * a change here marks older reads unable to publish, patches the row at once,
 * and publishes one change, which the controller reconciles (ACTIVITY-05).
 */

async function send(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(String(response.status));
  if (response.status === 204) return null;
  const json = (await response.json()) as { data?: unknown };
  return json.data ?? json;
}

export function dayBucket(iso: string, now = new Date()): "today" | "yesterday" | "earlier" {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const at = new Date(iso).getTime();
  if (at >= start.getTime()) return "today";
  if (at >= start.getTime() - 86_400_000) return "yesterday";
  return "earlier";
}

export function ActivityPanelBody({
  controller,
  snapshot,
  panelId,
  canManageAnnouncements,
  onClose,
}: {
  controller: ActivityController;
  snapshot: ActivitySnapshot;
  panelId: string;
  canManageAnnouncements: boolean;
  onClose: (returnFocus: boolean) => void;
}) {
  const t = useTranslations("activity");
  const locale = useLocale();
  const nav = useFeedbackRouter();
  const toast = useToast();
  const [acknowledging, setAcknowledging] = React.useState<string | null>(null);
  /** The newest mutation per item: an older one's rollback never undoes it (A13). */
  const sequences = React.useRef(new Map<string, number>());
  const { page, loading, failed, stale, type: tab } = snapshot.list;
  const { open: openRecord } = useOpenRecord(page?.workspace);
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, []);

  function patch(key: string, change: Partial<ActivityCenterItem>) {
    controller.patchList((current) => ({ ...current, items: current.items.map((item) => (item.key === key ? { ...item, ...change } : item)) }));
  }

  function begin(key: string): number {
    controller.beginMutation();
    const sequence = (sequences.current.get(key) ?? 0) + 1;
    sequences.current.set(key, sequence);
    return sequence;
  }

  async function setRead(item: ActivityCenterItem, read: boolean) {
    const sequence = begin(item.key);
    patch(item.key, { readState: read ? "READ" : "UNREAD" });
    try {
      if (item.sourceType === "NOTIFICATION") await send(`/api/notifications/${item.id}/${read ? "read" : "unread"}`, { method: "POST", body: JSON.stringify({ read }) });
      else await send(`/api/announcements/${item.id}/seen`, { method: "POST", body: "{}" });
    } catch {
      if (sequences.current.get(item.key) === sequence) patch(item.key, { readState: item.readState });
      toast({ title: t("readFailed"), tone: "danger" });
    }
    publishActivityChange(item.sourceType === "NOTIFICATION" ? "read" : "seen");
  }

  async function markAll() {
    controller.beginMutation();
    controller.patchList((current) => ({ ...current, items: current.items.map((item) => ({ ...item, readState: "READ" })) }));
    try {
      await send("/api/activity-center/mark-all-read", { method: "POST", body: "{}" });
    } catch {
      toast({ title: t("readFailed"), tone: "danger" });
    }
    publishActivityChange("read");
  }

  // A required acknowledgment waits for the server before it shows as done (§122).
  async function acknowledge(item: ActivityCenterItem) {
    if (acknowledging === item.key) return;
    setAcknowledging(item.key);
    begin(item.key);
    try {
      const result = (await send(`/api/announcements/${item.id}/acknowledge`, { method: "POST", body: "{}" })) as { acknowledgedAt: string };
      patch(item.key, { acknowledgedAt: result.acknowledgedAt, readState: "READ", pinned: false });
      publishActivityChange("acknowledged");
    } catch {
      toast({ title: t("acknowledgeFailed"), tone: "danger" });
    } finally {
      setAcknowledging(null);
    }
  }

  async function follow(item: ActivityCenterItem) {
    if (!item.href) {
      if (item.readState === "UNREAD") void setRead(item, true);
      return;
    }
    if (item.readState === "UNREAD") patch(item.key, { readState: "READ" });
    if (item.sourceType === "NOTIFICATION") {
      // The open route re-authorises, enters the company if it must, and marks it read (§42, §51).
      onClose(false);
      nav.push(item.href, { source: "record" });
      publishActivityChange("read");
      return;
    }
    if (await openRecord({ href: item.href, company: item.openIn })) {
      onClose(false);
      publishActivityChange("seen");
    }
  }

  const total = snapshot.count.value?.total ?? 0;
  const items = page?.items ?? [];
  const now = new Date();
  const pinned = items.filter((item) => item.pinned);
  const stream = items.filter((item) => !item.pinned);
  const buckets = (["today", "yesterday", "earlier"] as const).map((bucket) => ({ bucket, rows: stream.filter((item) => dayBucket(item.createdAt, now) === bucket) })).filter((group) => group.rows.length);

  const row = (item: ActivityCenterItem) => (
    <li key={item.key} className="group flex items-start gap-1 rounded-md hover:bg-hover" data-testid="activity-item" data-source={item.sourceType} data-read={item.readState}>
      <button type="button" onClick={() => void follow(item)} className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent touch:min-h-11">
        <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.readState === "UNREAD" ? (item.priority === "CRITICAL" ? "bg-danger" : "bg-accent") : "bg-transparent")} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            {item.sourceType === "ANNOUNCEMENT" ? <Megaphone aria-label={t("announcement")} className="size-3.5 shrink-0 text-fg-subtle" /> : <span className="sr-only">{t("notification")}</span>}
            <span className={cn("block min-w-0 text-table", item.readState === "UNREAD" ? "font-semibold text-fg" : "text-fg-muted")}>{item.title}</span>
          </span>
          {item.bodyPreview ? <span className="line-clamp-2 block text-meta text-fg-muted">{item.bodyPreview}</span> : null}
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-fg-subtle">
            {item.company ? <CompanyTag name={item.company.name} /> : null}
            {item.project ? <span className="truncate">{item.project.name}</span> : null}
            <time dateTime={item.createdAt}>{relativeTime(item.createdAt, locale)}</time>
            {item.priority === "CRITICAL" ? <span className="font-semibold text-danger-strong">{t("critical")}</span> : null}
            {item.priority === "IMPORTANT" ? <span className="font-medium text-warning-strong">{t("important")}</span> : null}
            {item.acknowledgedAt ? <span className="font-medium text-success-strong">{t("acknowledged")}</span> : null}
            <span className="sr-only">{item.readState === "UNREAD" ? t("unread") : t("read")}</span>
          </span>
        </span>
      </button>
      {item.requiresAcknowledgement && !item.acknowledgedAt ? (
        <button type="button" onClick={() => void acknowledge(item)} disabled={acknowledging === item.key} className="mt-1.5 inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-line px-2 touch:mt-0 touch:h-11 text-meta font-medium text-fg hover:bg-surface" data-testid="activity-acknowledge">
          {acknowledging === item.key ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : null}
          {t("acknowledge")}
        </button>
      ) : item.readState === "UNREAD" ? (
        <button type="button" onClick={() => void setRead(item, true)} aria-label={`${t("markRead")}: ${item.title}`} className="mt-1 grid size-8 shrink-0 place-items-center rounded-md touch:mt-0 touch:size-11 text-fg-subtle hover:bg-surface hover:text-fg">
          <Check aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </li>
  );

  return (
    <div ref={panelRef} className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h2 className="text-card font-semibold text-fg">{t("title")}</h2>
        <div className="flex items-center gap-1">
          {total > 0 ? (
            <button type="button" onClick={() => void markAll()} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-table font-medium text-accent-strong hover:bg-hover touch:h-11" data-testid="activity-mark-all">
              <CheckCheck aria-hidden="true" className="size-4" />
              {t("markAll")}
            </button>
          ) : null}
          <button type="button" onClick={() => onClose(true)} aria-label={t("close")} className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover sm:hidden touch:size-11">
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>

      <div role="tablist" aria-label={t("title")} className="flex gap-1 border-b border-line px-2">
        {([
          ["ALL", t("all")],
          ["NOTIFICATION", t("notifications")],
          ["ANNOUNCEMENT", t("announcements")],
        ] as const).map(([key, text], index) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-controls={`${panelId}-list`}
            data-autofocus={index === 0 ? true : undefined}
            onClick={() => controller.selectTab(key)}
            onKeyDown={(event) => {
              const order: ActivityType[] = ["ALL", "NOTIFICATION", "ANNOUNCEMENT"];
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              const next = order[(order.indexOf(tab) + (event.key === "ArrowRight" ? 1 : 2)) % 3];
              controller.selectTab(next);
              (event.currentTarget.parentElement?.children[order.indexOf(next)] as HTMLElement | undefined)?.focus();
            }}
            className={cn("-mb-px border-b-2 px-2.5 py-2 text-table font-medium touch:min-h-11", tab === key ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg")}
            data-testid={`activity-tab-${key.toLowerCase()}`}
          >
            {text}
          </button>
        ))}
      </div>

      <div id={`${panelId}-list`} role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-1.5" aria-busy={loading || undefined}>
        {page === null && !failed ? (
          <ul aria-label={t("loading")} className="space-y-2 p-2">
            {[0, 1, 2, 3].map((index) => (
              <li key={index} className="h-12 rounded-md bg-surface-muted motion-safe:animate-pulse" />
            ))}
          </ul>
        ) : failed && items.length === 0 ? (
          <div className="px-2.5 py-3">
            <p role="alert" className="text-table text-fg-muted">
              {t("error")}
            </p>
            <button type="button" onClick={() => controller.retry()} disabled={loading} className="mt-1 text-table font-medium text-accent-strong hover:underline disabled:opacity-50" data-testid="activity-retry">
              {t("tryAgain")}
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="px-2.5 py-6 text-center text-table text-fg-muted" data-testid="activity-empty">
            {t("empty")}
          </p>
        ) : (
          <>
            {stale ? (
              <p className="px-2 py-1 text-micro text-fg-subtle" data-testid="activity-stale">
                {t("stale")}{" "}
                <button type="button" onClick={() => controller.retry()} disabled={loading} className="font-medium text-accent-strong hover:underline">
                  {t("tryAgain")}
                </button>
              </p>
            ) : null}
            {pinned.length ? (
              <section aria-label={t("needsAttention")} className="mb-1 rounded-md border border-danger/25 bg-danger-soft/40">
                <p className="px-2 pt-1.5 text-micro font-semibold uppercase tracking-[0.1em] text-danger-strong">{t("needsAttention")}</p>
                <ul>{pinned.map(row)}</ul>
              </section>
            ) : null}
            {buckets.map((group) => (
              <section key={group.bucket} aria-label={t(group.bucket)}>
                <p className="px-2 pb-0.5 pt-2 text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">{t(group.bucket)}</p>
                <ul>{group.rows.map(row)}</ul>
              </section>
            ))}
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2.5">
        {canManageAnnouncements ? (
          <Link href="/announcements?tab=manage" onClick={() => onClose(false)} className="text-meta font-medium text-fg-muted hover:text-fg">
            {t("manage")}
          </Link>
        ) : (
          <span />
        )}
        <Link href={`/activity${tab === "ALL" ? "" : `?type=${tab === "NOTIFICATION" ? "notifications" : "announcements"}`}`} onClick={() => onClose(false)} className="text-table font-medium text-accent-strong hover:underline" data-testid="activity-view-all">
          {t("viewAll")}
        </Link>
      </div>
    </div>
  );
}
