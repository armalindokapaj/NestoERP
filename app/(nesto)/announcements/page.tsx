import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { Plus, Search } from "lucide-react";

import { AnnouncementList } from "@/components/announcements/announcement-list";
import { ProductivitySettingsForm } from "@/components/announcements/productivity-settings-form";
import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { addressableAudiences, announcementsOpen, managedWhere } from "@/lib/modules/announcements/announcement.permissions";
import { feedQuerySchema } from "@/lib/modules/announcements/announcement.schema";
import { listAnnouncements } from "@/lib/modules/announcements/announcement.service";
import { ANNOUNCEMENT_PRIORITIES, ANNOUNCEMENT_STATUSES, AUDIENCE_LABELS, AUDIENCE_TYPES, FEED_TAB_LABELS, FEED_TABS, PRIORITY_LABELS, STATUS_LABELS, type FeedTab } from "@/lib/modules/announcements/announcement.types";
import { resolveProductivitySettings } from "@/lib/modules/productivity/productivity.settings";
import { ensureCompanySettings } from "@/lib/modules/settings/company-settings.service";
import { prisma } from "@/lib/database/prisma";
import { cn } from "@/lib/utils/cn";
import { HelpEntry } from "@/components/help/help-entry";
import { getTranslations } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/translator";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("announcements");
  return { title: t("meta.announcements") };
}

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

/**
 * /announcements (PRD #45 §58, §59, §216, §221). For Me, Pinned, Unread, To
 * Acknowledge and History read the member's audience; Manage lists what they
 * write — and, for the company's authority, the switches for this layer.
 */
export default async function AnnouncementsPage({ searchParams }: Params) {
  const context = await requireModule("announcements");
  if (!announcementsOpen(context)) redirect("/access-denied");
  const params = await searchParams;
  const t = await getTranslations("announcements");
  const label = (group: "priority" | "audience" | "status" | "tab", value: string, fallback: string) => {
    const key = `labels.${group}.${value}` as MessageKey<"announcements">;
    const text = t(key);
    return text === key ? fallback : text;
  };
  const audiences = addressableAudiences(context);
  const canManage = audiences.length > 0 || (await prisma.announcement.count({ where: { companyId: context.companyId, AND: [managedWhere(context)] } })) > 0;
  // Reading happens in the Activity Center (Activity Center §4, §164); this route keeps what authors
  // and managers need — the Manage tab — reached from the bell's "Manage announcements" (§82, §83, §151).
  const requested = one(params.tab) as FeedTab | undefined;
  if (requested !== "manage" || !canManage) redirect("/activity?type=announcements");
  const tabs: FeedTab[] = FEED_TABS.filter((tab): boolean => tab === "manage");
  const tab = "manage" as FeedTab;
  const query = feedQuerySchema.parse({ tab, priority: one(params.priority), audienceType: one(params.audience), status: tab === "manage" ? one(params.status) : undefined, q: one(params.q) });
  const [settings, company] = await Promise.all([resolveProductivitySettings(context.companyId), ensureCompanySettings(context.companyId)]);
  const feed = settings.announcementsEnabled || tab === "manage" ? await listAnnouncements(context, query) : null;
  const queryString = new URLSearchParams(Object.entries({ tab, priority: query.priority, audienceType: query.audienceType, status: query.status, q: query.q }).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
  const href = (next: Record<string, string | undefined>) => {
    const merged = { tab, priority: query.priority, audience: query.audienceType, status: query.status, q: query.q, ...next };
    const search = new URLSearchParams(Object.entries(merged).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
    return `/announcements${search ? `?${search}` : ""}`;
  };
  const count = (key: FeedTab) => (key === "unread" ? feed?.counts.unread : key === "acknowledge" ? feed?.counts.acknowledge : undefined);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-page font-semibold tracking-tight text-fg">{t("page.title")}</h1>
          <p className="mt-1.5 text-body text-fg-muted">{t("page.description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HelpEntry moduleKey="announcements" moduleLabel={t("meta.announcements")} />
          {audiences.length && can(context, "announcement.create") ? (
            <Button asChild size="sm">
              <Link href="/announcements/new">
                <Plus /> {t("page.newAnnouncement")}
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      <nav aria-label={t("page.views")} className="flex items-center gap-1 overflow-x-auto border-b border-line">
        {tabs.map((key) => (
          <Link key={key} href={`/announcements${key === "for_me" ? "" : `?tab=${key}`}`} aria-current={tab === key ? "page" : undefined} className={cn("-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 touch:min-h-11 text-table font-medium transition-colors", tab === key ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg")} data-testid={`announcement-tab-${key}`}>
            {label("tab", key, FEED_TAB_LABELS[key])}
            {count(key) ? <span className="rounded-full bg-accent-soft px-1.5 text-micro font-semibold tabular-nums text-accent-strong">{count(key)}</span> : null}
          </Link>
        ))}
      </nav>

      <form method="get" className="flex flex-wrap items-center gap-2" aria-label={t("page.filter")}>
        {tab !== "for_me" ? <input type="hidden" name="tab" value={tab} /> : null}
        <label className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <span className="sr-only">{t("page.search")}</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input name="q" defaultValue={query.q} placeholder={t("page.search")} className="h-9 pl-8" />
        </label>
        <select name="priority" defaultValue={query.priority ?? ""} className={cn(selectClass, "h-9 w-auto")} aria-label={t("page.priority")}>
          <option value="">{t("page.anyPriority")}</option>
          {ANNOUNCEMENT_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {label("priority", priority, PRIORITY_LABELS[priority])}
            </option>
          ))}
        </select>
        <select name="audience" defaultValue={query.audienceType ?? ""} className={cn(selectClass, "h-9 w-auto")} aria-label={t("page.scope")}>
          <option value="">{t("page.anyScope")}</option>
          {AUDIENCE_TYPES.map((type) => (
            <option key={type} value={type}>
              {label("audience", type, AUDIENCE_LABELS[type])}
            </option>
          ))}
        </select>
        {tab === "manage" ? (
          <select name="status" defaultValue={query.status ?? ""} className={cn(selectClass, "h-9 w-auto")} aria-label={t("page.status")}>
            <option value="">{t("page.anyStatus")}</option>
            {ANNOUNCEMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {label("status", status, STATUS_LABELS[status])}
              </option>
            ))}
          </select>
        ) : null}
        <Button type="submit" size="sm" variant="secondary" className="h-9">
          {t("page.apply")}
        </Button>
        {query.q || query.priority || query.audienceType || query.status ? (
          <Link href={href({ q: undefined, priority: undefined, audience: undefined, status: undefined })} className="text-table text-fg-muted hover:text-fg">
            {t("page.clear")}
          </Link>
        ) : null}
      </form>

      {feed ? <AnnouncementList initial={feed} tab={tab} query={queryString} zone={company.timezone} /> : <EmptyState title={t("page.offTitle")} description={t("page.offBody")} />}

      {tab === "manage" && can(context, "announcement.manage_company") ? (
        <section className="max-w-2xl space-y-2 pt-4" aria-labelledby="productivity-settings">
          <h2 id="productivity-settings" className="text-card font-semibold text-fg">
            {t("page.settings")}
          </h2>
          <ProductivitySettingsForm initial={settings} />
        </section>
      ) : null}
    </div>
  );
}
