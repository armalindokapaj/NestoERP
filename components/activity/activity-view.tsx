"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { useFeedbackRouter } from "@/components/navigation/navigation-feedback";
import { Check, Loader2, Megaphone } from "lucide-react";

import { useLocale, useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { CompanyTag } from "@/components/workspace/company-tag";
import { useOpenRecord } from "@/components/workspace/use-open-record";
import type { ModuleKey } from "@/config/modules";
import { publishActivityChange, relativeTime, subscribeActivity } from "@/lib/activity/client";
import type { ActivityCenterItem, ActivityPage, ActivityType } from "@/lib/modules/activity/activity-center.service";
import { cn } from "@/lib/utils/cn";

export type ActivityQueryState = { companyId?: string; moduleKey?: string; priority?: string; readState?: string; q?: string; from?: string; to?: string };

const fieldClass = "h-9 rounded-md border border-line bg-surface px-2.5 text-table text-fg outline-none focus:border-accent";

async function send(url: string, body = "{}"): Promise<unknown> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
  if (!response.ok) throw new Error(String(response.status));
  if (response.status === 204) return null;
  return ((await response.json()) as { data?: unknown }).data;
}

/**
 * The full Activity Center (Activity Center §35-§41, §57-§59, §74, §114-§117).
 *
 * The same stream as the bell with its history and filters: type, company,
 * module, priority, read state, date and a search. Filters are URL state and a
 * company filter never switches the workspace (§168). Paged by cursor.
 */
export function ActivityView({ type, query, initial, modules }: { type: ActivityType; query: ActivityQueryState; initial: ActivityPage; modules: string[] }) {
  const t = useTranslations("activity");
  const tModules = useTranslations("modules");
  const locale = useLocale();
  const router = useRouter();
  const nav = useFeedbackRouter();
  const toast = useToast();
  const [items, setItems] = React.useState(initial.items);
  const [cursor, setCursor] = React.useState(initial.nextCursor);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [acknowledging, setAcknowledging] = React.useState<string | null>(null);
  const [now, setNow] = React.useState<number | null>(null);
  const { open } = useOpenRecord(initial.workspace);

  React.useEffect(() => setNow(Date.now()), []);
  React.useEffect(() => {
    setItems(initial.items);
    setCursor(initial.nextCursor);
  }, [initial]);
  // A change here or in another tab refreshes the page, batched, and never while hidden (NAV-03 ACTIVITY-06, A15).
  React.useEffect(() => {
    let timer: number | null = null;
    let last = -Infinity;
    let dirty = false;
    const refresh = () => {
      timer = null;
      if (document.visibilityState !== "visible") {
        dirty = true;
        return;
      }
      dirty = false;
      last = Date.now();
      router.refresh();
    };
    const schedule = () => {
      if (document.visibilityState !== "visible") {
        dirty = true;
        return;
      }
      if (timer !== null) return;
      timer = window.setTimeout(refresh, Math.max(250, last + 1_000 - Date.now()));
    };
    const onVisible = () => document.visibilityState === "visible" && dirty && schedule();
    const unsubscribe = subscribeActivity(schedule);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [router]);

  const moduleLabel = (key: string) => {
    const label = tModules(`${key as ModuleKey}.label`);
    return label.endsWith(".label") ? key : label;
  };

  const href = (next: Partial<ActivityQueryState> & { type?: ActivityType }) => {
    const params = new URLSearchParams();
    const nextType = next.type ?? type;
    if (nextType !== "ALL") params.set("type", nextType === "NOTIFICATION" ? "notifications" : "announcements");
    for (const [key, value] of Object.entries({ ...query, ...next })) if (key !== "type" && value) params.set(key, value);
    const text = params.toString();
    return text ? `/activity?${text}` : "/activity";
  };

  function patch(key: string, change: Partial<ActivityCenterItem>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));
  }

  function changed() {
    publishActivityChange();
  }

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams(href({}).split("?")[1] ?? "");
      params.set("cursor", cursor);
      const response = await fetch(`/api/activity-center?${params}`);
      if (!response.ok) throw new Error(String(response.status));
      const page = ((await response.json()) as { data: ActivityPage }).data;
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      toast({ title: t("error"), tone: "danger" });
    } finally {
      setLoadingMore(false);
    }
  }

  async function markRead(item: ActivityCenterItem, read: boolean) {
    patch(item.key, { readState: read ? "READ" : "UNREAD" });
    try {
      if (item.sourceType === "NOTIFICATION") await send(`/api/notifications/${item.id}/${read ? "read" : "unread"}`, JSON.stringify({ read }));
      else await send(`/api/announcements/${item.id}/seen`);
      changed();
    } catch {
      patch(item.key, { readState: item.readState });
      toast({ title: t("readFailed"), tone: "danger" });
    }
  }

  async function markAll() {
    setItems((current) => current.map((item) => ({ ...item, readState: "READ" })));
    try {
      await send("/api/activity-center/mark-all-read");
      changed();
    } catch {
      toast({ title: t("readFailed"), tone: "danger" });
      router.refresh();
    }
  }

  async function acknowledge(item: ActivityCenterItem) {
    setAcknowledging(item.key);
    try {
      const result = (await send(`/api/announcements/${item.id}/acknowledge`)) as { acknowledgedAt: string };
      patch(item.key, { acknowledgedAt: result.acknowledgedAt, readState: "READ", pinned: false });
      changed();
    } catch {
      toast({ title: t("acknowledgeFailed"), tone: "danger" });
    } finally {
      setAcknowledging(null);
    }
  }

  async function follow(item: ActivityCenterItem) {
    if (!item.href) return void markRead(item, true);
    if (item.sourceType === "NOTIFICATION") {
      nav.push(item.href, { source: "record" });
      changed();
      return;
    }
    if (await open({ href: item.href, company: item.openIn })) changed();
  }

  const filtered = Object.values(query).some(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line">
        <nav role="tablist" aria-label={t("title")} className="flex gap-1">
          {([
            ["ALL", t("all")],
            ["NOTIFICATION", t("notifications")],
            ["ANNOUNCEMENT", t("announcements")],
          ] as const).map(([key, label]) => (
            <Link key={key} role="tab" aria-selected={type === key} href={href({ type: key })} className={cn("-mb-px border-b-2 px-3 py-2.5 text-table font-medium", type === key ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg")} data-testid={`activity-page-tab-${key.toLowerCase()}`}>
              {label}
            </Link>
          ))}
        </nav>
        <Button type="button" variant="ghost" size="sm" onClick={() => void markAll()} data-testid="activity-page-mark-all">
          {t("markAll")}
        </Button>
      </div>

      <form action="/activity" method="get" className="flex flex-wrap items-end gap-2" aria-label="Filter activity" data-testid="activity-filters">
        {type !== "ALL" ? <input type="hidden" name="type" value={type === "NOTIFICATION" ? "notifications" : "announcements"} /> : null}
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 sm:max-w-xs">
          <span className="text-meta text-fg-muted">Search</span>
          <input name="q" defaultValue={query.q ?? ""} maxLength={200} className={cn(fieldClass, "w-full")} />
        </label>
        {initial.companies.length > 1 ? (
          <label className="flex flex-col gap-1">
            <span className="text-meta text-fg-muted">Company</span>
            <select name="companyId" defaultValue={query.companyId ?? ""} className={fieldClass} data-testid="activity-company-filter">
              <option value="">All accessible companies</option>
              {initial.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1">
          <span className="text-meta text-fg-muted">Module</span>
          <select name="moduleKey" defaultValue={query.moduleKey ?? ""} className={fieldClass}>
            <option value="">All modules</option>
            {modules.map((key) => (
              <option key={key} value={key}>
                {moduleLabel(key)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-meta text-fg-muted">Priority</span>
          <select name="priority" defaultValue={query.priority ?? ""} className={fieldClass}>
            <option value="">All</option>
            <option value="CRITICAL">{t("critical")}</option>
            <option value="IMPORTANT">{t("important")}</option>
            <option value="NORMAL">Normal</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-meta text-fg-muted">Status</span>
          <select name="readState" defaultValue={query.readState ?? ""} className={fieldClass}>
            <option value="">All</option>
            <option value="UNREAD">{t("unread")}</option>
            <option value="READ">{t("read")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-meta text-fg-muted">From</span>
          <input type="date" name="from" defaultValue={query.from ?? ""} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-meta text-fg-muted">To</span>
          <input type="date" name="to" defaultValue={query.to ?? ""} className={fieldClass} />
        </label>
        <Button type="submit" variant="secondary" size="sm">
          Apply
        </Button>
        {filtered ? (
          <Link href={href({ companyId: undefined, moduleKey: undefined, priority: undefined, readState: undefined, q: undefined, from: undefined, to: undefined })} className="pb-2 text-meta font-medium text-accent-strong hover:underline">
            Reset
          </Link>
        ) : null}
      </form>

      {items.length === 0 ? (
        <EmptyState icon={<Check />} title={filtered ? t("filterEmpty") : t("empty")} description="" />
      ) : (
        <section className="nesto-card overflow-hidden" aria-label={t("title")}>
          <ul className="divide-y divide-line" data-testid="activity-stream">
            {items.map((item) => (
              // Below sm the actions take their own line under the text instead of squeezing the title out (AUD-04 §3, D-08-23, MW-01).
              <li key={item.key} className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap", item.pinned && "bg-danger-soft/40")} data-testid="activity-row" data-source={item.sourceType} data-read={item.readState}>
                <span aria-hidden="true" className={cn("mt-2 size-2 shrink-0 rounded-full", item.readState === "UNREAD" ? (item.priority === "CRITICAL" ? "bg-danger" : "bg-accent") : "bg-transparent")} />
                <button type="button" onClick={() => void follow(item)} className="min-w-0 flex-1 text-left">
                  <span className="flex items-center gap-1.5">
                    {item.sourceType === "ANNOUNCEMENT" ? <Megaphone aria-label={t("announcement")} className="size-3.5 shrink-0 text-fg-subtle" /> : <span className="sr-only">{t("notification")}</span>}
                    <span className={cn("text-table", item.readState === "UNREAD" ? "font-semibold text-fg" : "text-fg-muted")}>{item.title}</span>
                  </span>
                  {item.bodyPreview ? <span className="mt-0.5 line-clamp-2 block text-meta text-fg-muted">{item.bodyPreview}</span> : null}
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-fg-subtle">
                    {item.company ? <CompanyTag name={item.company.name} /> : null}
                    {item.project ? <span>{item.project.name}</span> : null}
                    {item.moduleKey ? <span>{moduleLabel(item.moduleKey)}</span> : null}
                    {item.actor ? <span>{item.actor.displayName}</span> : null}
                    <time dateTime={item.createdAt}>{now ? relativeTime(item.createdAt, locale, now) : ""}</time>
                    {item.priority === "CRITICAL" ? <span className="font-semibold text-danger-strong">{t("critical")}</span> : null}
                    {item.priority === "IMPORTANT" ? <span className="font-medium text-warning-strong">{t("important")}</span> : null}
                    {item.acknowledgedAt ? <span className="font-medium text-success-strong">{t("acknowledged")}</span> : null}
                    <span className="sr-only">{item.readState === "UNREAD" ? t("unread") : t("read")}</span>
                  </span>
                </button>
                <span className="flex w-full flex-wrap items-center justify-end gap-1 sm:w-auto sm:shrink-0 sm:flex-nowrap">
                  {item.requiresAcknowledgement && !item.acknowledgedAt ? (
                    <Button type="button" variant="secondary" size="sm" onClick={() => void acknowledge(item)} disabled={acknowledging === item.key}>
                      {acknowledging === item.key ? <Loader2 className="animate-spin" /> : null}
                      {t("acknowledge")}
                    </Button>
                  ) : null}
                  {item.sourceType === "NOTIFICATION" || item.readState === "UNREAD" ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => void markRead(item, item.readState === "UNREAD")} disabled={item.sourceType === "ANNOUNCEMENT" && item.readState === "READ"}>
                      {item.readState === "UNREAD" ? t("markRead") : t("markUnread")}
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {cursor ? (
            <div className="border-t border-line p-2 text-center">
              <Button type="button" variant="ghost" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? <Loader2 className="animate-spin" /> : null}
                {t("loadMore")}
              </Button>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
