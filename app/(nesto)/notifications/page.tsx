import type { Metadata } from "next";
import Link from "next/link";
import { Settings2 } from "lucide-react";

import { AttentionList } from "@/components/notifications/attention-list";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { PageHeader } from "@/components/ui/page-header";
import { requireUserContext } from "@/lib/context/current-user";
import { listReadableAttention } from "@/lib/core/notifications/attention.service";
import { listNotifications } from "@/lib/core/notifications/notification.service";
import { getTranslations } from "@/lib/i18n/server";
import { cn } from "@/lib/utils/cn";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notificationCenter");
  return { title: t("title") };
}

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TABS = ["all", "unread", "attention"] as const;
type Tab = (typeof TABS)[number];

/**
 * The notification centre (PRD #38 §72, §86).
 *
 * Always the reader's own: every query is keyed on the current membership, so
 * there is nothing here to authorise beyond the session.
 */
export default async function NotificationsPage({ searchParams }: Params) {
  const context = await requireUserContext();
  const params = await searchParams;
  const tab: Tab = TABS.includes(params.tab as Tab) ? (params.tab as Tab) : "all";
  const t = await getTranslations("notificationCenter");

  const [page, attention] = await Promise.all([
    tab === "attention" ? null : listNotifications(context, { readState: tab === "unread" ? "UNREAD" : undefined, limit: 20 }),
    tab === "attention" ? listReadableAttention(context, 50) : null,
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Link
            href="/settings/notifications"
            className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-table font-medium text-fg hover:bg-hover"
          >
            <Settings2 aria-hidden="true" className="size-4" />
            {t("settings")}
          </Link>
        }
      />

      <nav aria-label={t("title")} className="flex gap-1 border-b border-line">
        {TABS.map((key) => (
          <Link
            key={key}
            href={key === "all" ? "/notifications" : `/notifications?tab=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-table font-medium transition-colors",
              tab === key ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t(`tabs.${key}`)}
          </Link>
        ))}
      </nav>

      <section className="nesto-card px-5 py-2">
        {attention ? (
          <>
            <p className="pb-1 pt-3 text-meta text-fg-subtle">{t("attentionHint")}</p>
            <AttentionList initial={attention} />
          </>
        ) : page ? (
          <div className="py-3">
            <NotificationCenter key={tab} initial={page} readState={tab === "unread" ? "UNREAD" : undefined} />
          </div>
        ) : null}
      </section>
    </div>
  );
}
