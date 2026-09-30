"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { Check, CheckCheck, Loader2, RotateCcw } from "lucide-react";

import { useLocale, useTranslations } from "@/components/i18n/i18n-provider";
import { relativeTime } from "@/lib/activity/client";
import { PersonLink } from "@/components/people/person-link";
import { Button } from "@/components/ui/button";
import { CompanyTag } from "@/components/workspace/company-tag";
import type { NotificationPage } from "@/lib/core/notifications/notification.service";
import { cn } from "@/lib/utils/cn";

/**
 * The notification list (PRD #38 §72, §73).
 *
 * Pages by cursor, newest first. Links go through the re-authorising open
 * route, never to the record directly (PRD #38 §82). In the Group workspace a
 * row names its company, and the open route enters that company's workspace
 * before it goes on (Workspace Context §45).
 */
export function NotificationCenter({ initial, readState }: { initial: NotificationPage; readState?: "UNREAD" }) {
  const t = useTranslations("notificationCenter");
  const locale = useLocale();
  const [items, setItems] = React.useState(initial.data);
  const [nextBefore, setNextBefore] = React.useState(initial.nextBefore);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    setItems(initial.data);
    setNextBefore(initial.nextBefore);
  }, [initial]);

  async function loadMore() {
    if (!nextBefore) return;
    setLoading(true);
    setFailed(false);
    try {
      const query = new URLSearchParams({ limit: "20", before: nextBefore });
      if (readState) query.set("readState", readState);
      const response = await fetch(`/api/notifications?${query}`);
      if (!response.ok) throw new Error(String(response.status));
      const page = (await response.json()) as NotificationPage;
      setItems((current) => [...current, ...page.data]);
      setNextBefore(page.nextBefore);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  async function setRead(id: string, read: boolean) {
    const previous = items;
    setItems((current) => current.map((item) => (item.id === id ? { ...item, readState: read ? "READ" : "UNREAD" } : item)));
    const response = await fetch(`/api/notifications/${id}/read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ read }),
    }).catch(() => null);
    if (!response?.ok) setItems(previous);
  }

  async function markAllRead() {
    const previous = items;
    setItems((current) => current.map((item) => ({ ...item, readState: "READ" })));
    const response = await fetch("/api/notifications/read-all", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
    if (!response?.ok) setItems(previous);
  }

  const hasUnread = items.some((item) => item.readState === "UNREAD");
  // New (unread) above Earlier (read), each newest first; one plain list when only one kind is present (MOB-06 §59).
  const fresh = items.filter((item) => item.readState === "UNREAD");
  const earlier = items.filter((item) => item.readState !== "UNREAD");
  const sections = [
    { key: "new", label: t("sectionNew"), items: fresh },
    { key: "earlier", label: t("sectionEarlier"), items: earlier },
  ].filter((section) => section.items.length > 0);

  return (
    <div>
      {hasUnread ? (
        <div className="mb-3 flex justify-end">
          <Button size="sm" variant="secondary" onClick={() => void markAllRead()}>
            <CheckCheck aria-hidden="true" />
            {t("markAllRead")}
          </Button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="py-8 text-center text-body text-fg-muted">{readState ? t("emptyUnread") : t("empty")}</p>
      ) : (
        <div data-testid="notification-center-list">
          {sections.map((section) => (
            <section key={section.key} aria-label={sections.length > 1 ? section.label : undefined} data-testid={`notification-section-${section.key}`}>
              {sections.length > 1 ? <h2 className="pb-1 pt-3 text-label font-semibold uppercase tracking-wider text-fg-subtle">{section.label}</h2> : null}
        <ul className="divide-y divide-line">
          {section.items.map((item) => {
            const unread = item.readState === "UNREAD";
            const content = (
              <>
                <span className={cn("block text-body", unread ? "font-semibold text-fg" : "text-fg-muted")}>{item.title}</span>
                {item.body ? <span className="mt-0.5 block text-table text-fg-muted">{item.body}</span> : null}
              </>
            );
            return (
              <li key={item.id} className="flex items-start gap-3 py-3" data-testid="notification-row">
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-2 size-2 shrink-0 rounded-full",
                    unread ? (item.priority === "CRITICAL" ? "bg-danger" : "bg-accent") : "bg-transparent",
                  )}
                />
                <div className="min-w-0 flex-1">
                  {item.href ? (
                    <Link href={item.href} prefetch={false} className="block rounded-sm hover:text-accent-strong">
                      {content}
                    </Link>
                  ) : (
                    content
                  )}
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-meta text-fg-subtle">
                    {item.company ? <CompanyTag name={item.company.name} /> : null}
                    {item.actorMemberId ? <PersonLink memberId={item.actorMemberId} name={item.actorName} variant="compact" /> : null}
                    <time dateTime={item.createdAt}>{relativeTime(item.createdAt, locale)}</time>
                    {item.priority === "CRITICAL" ? <span className="font-semibold text-danger-strong">{t("critical")}</span> : null}
                    {item.priority === "HIGH" ? <span className="font-medium text-warning-strong">{t("high")}</span> : null}
                    {unread ? <span className="sr-only">{t("unread")}</span> : null}
                  </p>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`${unread ? t("markRead") : t("markUnread")}: ${item.title}`}
                  title={unread ? t("markRead") : t("markUnread")}
                  onClick={() => void setRead(item.id, unread)}
                >
                  {unread ? <Check aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
                </Button>
              </li>
            );
          })}
        </ul>
            </section>
          ))}
        </div>
      )}

      {failed ? <p role="alert" className="mt-3 text-table text-danger-strong">{t("error")}</p> : null}
      {nextBefore ? (
        <div className="mt-4 flex justify-center">
          <Button size="sm" variant="secondary" onClick={() => void loadMore()} disabled={loading}>
            {loading ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            {loading ? t("loading") : t("loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
