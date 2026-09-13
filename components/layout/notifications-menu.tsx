"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCheck, Loader2 } from "lucide-react";

import { useLocale, useTranslations } from "@/components/i18n/i18n-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NotificationListItemDTO, NotificationPage, UnreadCountDTO } from "@/lib/core/notifications/notification.service";
import { cn } from "@/lib/utils/cn";

/**
 * The notification bell (PRD #38 §72, §73, §82).
 *
 * The count is polled — cheap, two indexed counts — and the list is fetched
 * only when the panel opens. Every entry links through
 * `/notifications/:id/open`, which reads the record again at the moment it is
 * followed, so a notification about something the reader has since lost access
 * to opens onto "no longer available", never onto the record.
 */

const POLL_MS = 60_000;
const PAGE_SIZE = 8;

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error(String(response.status));
  if (response.status === 204) return undefined as T;
  const json = (await response.json()) as { data?: T } & T;
  return (json.data ?? json) as T;
}

export function relativeTime(iso: string, locale: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(0, "second");
}

export function NotificationsMenu() {
  const t = useTranslations("shell");
  const locale = useLocale();
  const router = useRouter();

  const [open, setOpen] = React.useState(false);
  const [counts, setCounts] = React.useState<UnreadCountDTO | null>(null);
  const [items, setItems] = React.useState<NotificationListItemDTO[] | null>(null);
  const [nextBefore, setNextBefore] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const refreshCount = React.useCallback(async () => {
    try {
      setCounts(await getJson<UnreadCountDTO>("/api/notifications/unread-count"));
    } catch {
      // The badge simply keeps its last value; the panel reports failures.
    }
  }, []);

  React.useEffect(() => {
    void refreshCount();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshCount();
    }, POLL_MS);
    const onFocus = () => void refreshCount();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshCount]);

  const loadPage = React.useCallback(async (before: string | null) => {
    setLoading(true);
    setFailed(false);
    try {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (before) query.set("before", before);
      // The page itself is the body — `data` is its list, not an envelope.
      const response = await fetch(`/api/notifications?${query}`);
      if (!response.ok) throw new Error(String(response.status));
      const page = (await response.json()) as NotificationPage;
      setItems((current) => (before && current ? [...current, ...page.data] : page.data));
      setNextBefore(page.nextBefore);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      void loadPage(null);
      void refreshCount();
    }
  }

  async function markRead(id: string) {
    setItems((current) => current?.map((item) => (item.id === id ? { ...item, readState: "READ" } : item)) ?? null);
    try {
      await getJson(`/api/notifications/${id}/read`, { method: "POST", body: JSON.stringify({ read: true }) });
    } finally {
      void refreshCount();
    }
  }

  async function markAllRead() {
    setItems((current) => current?.map((item) => ({ ...item, readState: "READ" })) ?? null);
    try {
      await getJson("/api/notifications/read-all", { method: "POST", body: "{}" });
    } finally {
      void refreshCount();
    }
  }

  const unread = counts?.unread ?? 0;
  const critical = (counts?.criticalUnread ?? 0) > 0;
  const label = unread > 0 ? `${t("notifications")} — ${t("unreadCount", { count: unread })}` : t("notifications");

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        className="relative grid size-9 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg data-[state=open]:bg-hover"
        aria-label={label}
        data-testid="notification-bell"
      >
        <Bell aria-hidden="true" className="size-[18px]" />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            data-testid="notification-badge"
            className={cn(
              "absolute right-1 top-1 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold leading-4 ring-2 ring-surface",
              critical ? "bg-danger text-white" : "bg-accent text-accent-fg",
            )}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between gap-2 px-2.5 pt-2">
          <DropdownMenuLabel className="px-0">{t("notifications")}</DropdownMenuLabel>
          {unread > 0 ? (
            <DropdownMenuItem
              className="h-7 px-2 text-table text-accent-strong"
              onSelect={(event) => {
                event.preventDefault();
                void markAllRead();
              }}
            >
              <CheckCheck aria-hidden="true" />
              {t("markAllRead")}
            </DropdownMenuItem>
          ) : null}
        </div>

        <div className="max-h-[min(28rem,70vh)] overflow-y-auto p-1">
          {items === null && loading ? (
            <p className="flex items-center gap-2 px-2.5 py-3 text-table text-fg-subtle">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              {t("loadingNotifications")}
            </p>
          ) : failed && !items?.length ? (
            <div className="px-2.5 py-3">
              <p className="text-table text-fg-muted">{t("notificationsError")}</p>
              <DropdownMenuItem
                className="mt-1 w-fit px-0 text-table text-accent-strong focus:bg-transparent"
                onSelect={(event) => {
                  event.preventDefault();
                  void loadPage(null);
                }}
              >
                {t("tryAgain")}
              </DropdownMenuItem>
            </div>
          ) : items && items.length === 0 ? (
            <p className="px-2.5 py-3 text-table text-fg-muted">{t("noNotifications")}</p>
          ) : (
            <ul>
              {items?.map((item) => (
                <li key={item.id} className="flex items-start gap-1" data-testid="notification-item">
                  <DropdownMenuItem
                    className="min-w-0 flex-1 items-start"
                    onSelect={() => {
                      if (item.href) router.push(item.href);
                      else void markRead(item.id);
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        item.readState === "UNREAD"
                          ? item.priority === "CRITICAL"
                            ? "bg-danger"
                            : "bg-accent"
                          : "bg-transparent",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-table", item.readState === "UNREAD" ? "font-semibold text-fg" : "text-fg-muted")}>
                        {item.title}
                      </span>
                      {item.body ? <span className="line-clamp-2 block text-meta text-fg-muted">{item.body}</span> : null}
                      <span className="mt-0.5 flex items-center gap-2 text-micro text-fg-subtle">
                        <time dateTime={item.createdAt}>{relativeTime(item.createdAt, locale)}</time>
                        {item.priority === "CRITICAL" ? <span className="font-semibold text-danger-strong">{t("critical")}</span> : null}
                        {item.priority === "HIGH" ? <span className="font-medium text-warning-strong">{t("high")}</span> : null}
                        {item.readState === "UNREAD" ? <span className="sr-only">{t("unread")}</span> : null}
                      </span>
                    </span>
                  </DropdownMenuItem>
                  {item.readState === "UNREAD" ? (
                    <DropdownMenuItem
                      className="mt-1 size-8 justify-center p-0"
                      aria-label={`${t("markRead")}: ${item.title}`}
                      onSelect={(event) => {
                        event.preventDefault();
                        void markRead(item.id);
                      }}
                    >
                      <Check aria-hidden="true" />
                    </DropdownMenuItem>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {nextBefore ? (
            <DropdownMenuItem
              className="justify-center text-table text-accent-strong"
              disabled={loading}
              onSelect={(event) => {
                event.preventDefault();
                void loadPage(nextBefore);
              }}
            >
              {loading ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              {t("loadMore")}
            </DropdownMenuItem>
          ) : null}
        </div>

        <DropdownMenuSeparator className="mx-0 my-0" />
        <DropdownMenuItem asChild className="justify-center rounded-none py-2.5 text-table font-medium text-accent-strong">
          <Link href="/notifications" prefetch={false}>
            {t("viewAllNotifications")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
