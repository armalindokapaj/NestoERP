import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { Settings2 } from "lucide-react";

import { ActivityView, type ActivityQueryState } from "@/components/activity/activity-view";
import { AttentionList } from "@/components/notifications/attention-list";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireUserContext } from "@/lib/context/current-user";
import { resolvePersonalContexts } from "@/lib/context/workspace-access";
import { listReadableAttentionForWorkspace } from "@/lib/core/notifications/attention.service";
import { getTranslations } from "@/lib/i18n/server";
import { activityFilters, activityQuerySchema } from "@/lib/modules/activity/activity-center.schema";
import { listActivity, type ActivityPage } from "@/lib/modules/activity/activity-center.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("activity");
  return { title: t("title") };
}

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The Activity Center page (Activity Center §35-§41, §164-§168): every
 * notification and announcement addressed to the person, across every company
 * they may use, with filters. Workspace-neutral — it belongs to no company
 * (§168) — and the single in-app attention destination (§99): the old
 * Notifications and Announcements reader pages redirect here.
 */
export default async function ActivityPage({ searchParams }: Params) {
  const context = await requireUserContext();
  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => (typeof value === "string" && value !== "" ? [[key, value]] : [])));
  const parsed = activityQuerySchema.safeParse(flat);
  if (!parsed.success) redirect("/activity");
  const input = parsed.data;
  const t = await getTranslations("activity");
  const m = await getTranslations("misc");

  let page: ActivityPage;
  try {
    page = await listActivity(context, { ...activityFilters(input), cursor: null });
  } catch (error) {
    // A company the person may not use is refused by the API (§142); here the filter is simply dropped.
    if (error instanceof AccessError && error.status === 403) redirect("/activity");
    throw error;
  }
  const [attention, contexts] = await Promise.all([
    input.type === "ANNOUNCEMENT" ? Promise.resolve([]) : listReadableAttentionForWorkspace(context, 10),
    resolvePersonalContexts(context),
  ]);
  const modules = [...new Set(contexts.flatMap((company) => Object.entries(company.moduleAccess).filter(([, access]) => access.enabled && access.accessLevel !== "NONE").map(([key]) => key)))].sort();

  const query: ActivityQueryState = { companyId: input.companyId, moduleKey: input.moduleKey, priority: input.priority, readState: input.readState, q: input.q, from: input.from, to: input.to };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Breadcrumbs items={[{ label: t("title") }]} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-page font-semibold tracking-tight text-fg">{t("title")}</h1>
          <p className="mt-1.5 text-body text-fg-muted">{m("activity.description")}</p>
        </div>
        <div className="flex items-center gap-2">
          {context.permissions.includes("announcement.create") ? (
            <Link href="/announcements?tab=manage" className="inline-flex h-8 items-center rounded-md border border-line-strong bg-surface px-3 text-table font-medium text-fg hover:bg-hover">
              {t("manage")}
            </Link>
          ) : null}
          <Link href="/settings/notifications" className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-table font-medium text-fg hover:bg-hover">
            <Settings2 aria-hidden="true" className="size-4" />
            {m("activity.settings")}
          </Link>
        </div>
      </header>
      {attention.length ? (
        <section className="nesto-card px-5 py-2" aria-label={t("needsAttention")} data-testid="activity-attention">
          <h2 className="pt-3 text-card font-semibold text-fg">{t("needsAttention")}</h2>
          <AttentionList initial={attention} />
        </section>
      ) : null}
      <ActivityView key={JSON.stringify({ type: input.type, query })} type={input.type} query={query} initial={page} modules={modules} />
    </div>
  );
}
