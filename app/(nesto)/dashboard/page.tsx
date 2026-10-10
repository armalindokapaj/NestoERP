import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";
import Link from "@/components/navigation/nav-link";

import {
  DashboardGrid,
  KpiGrid,
  widgetSpanClasses,
} from "@/components/dashboard/dashboard-grid";
import { DashboardWidget, SPAN } from "@/components/dashboard/dashboard-widget";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PendingApprovalsFigure, PendingApprovalsList, PendingApprovalsSkeleton } from "@/components/dashboard/pending-approvals";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { GroupHero } from "@/components/dashboard/group-hero";
import { WelcomeHeader } from "@/components/dashboard/welcome-header";
import { SectionBoundary } from "@/components/modules/page-section";
import { ModuleMessages } from "@/components/i18n/module-messages";
import { getTranslations } from "@/lib/i18n/server";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUserContext } from "@/lib/context/current-user";
import { groupIdentity } from "@/lib/modules/dashboard/dashboard.group";
import {
  loadPlannedKpi,
  loadPlannedWidget,
  planDashboard,
  type DashboardPlan,
} from "@/lib/modules/dashboard/dashboard.service";
import type { UserContext } from "@/lib/context/types";
import { cn } from "@/lib/utils/cn";
import { kpiLabel, widgetText } from "@/components/dashboard/config-text";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

/**
 * The one dashboard route (PRD #4 §4). The group's Owner and the heads of its
 * functions see the group above their own (D-01 §25).
 *
 * There is no /dashboard/architect and no /dashboard/finance. Every one of the
 * 18 roles lands here, and the resolver decides what they see from their role,
 * permissions and data scope (PRD #4 §103).
 *
 * The page waits only for the plan — which KPIs, widgets and quick actions this
 * reader may have, decided from access alone — and draws it at once. Each KPI,
 * each widget and the group banner then arrives in its own place, in the
 * configured order and size, so a slow widget holds back nothing and moves
 * nothing (NAV-03 STREAM-02, STREAM-03). The primary section is the first
 * planned widget, or the first KPI when there is none.
 *
 * The heading takes two thirds of the first row, and its height is the row's;
 * the last third is My Day with Pending Approvals under it, drawn on the accent
 * colour and held to that height. Pending Approvals is
 * the planned widget (or, in the Group workspace, the planned figure) moved up
 * there — shown once, and only for a reader whose plan has it.
 */
export default async function DashboardPage() {
  const context = await requireUserContext();
  const t = await getTranslations("dashboard");
  const misc = await getTranslations("misc");
  const plan = await planDashboard(context);
  // The group's banner is the Group workspace's (D-01 §26, §66; Workspace Context §18).
  const group = groupIdentity(context).catch(() => null);
  const primary = plan.widgets[0]
    ? `widget:${plan.widgets[0].key}`
    : plan.kpis[0]
      ? `kpi:${plan.kpis[0].key}`
      : null;
  // Pending Approvals sits beside the heading: the widget where the plan has one, else the group's figure.
  const approvalsWidget = plan.widgets.find((definition) => definition.key === "pendingApprovals") ?? null;
  const approvalsKpi = approvalsWidget ? null : (plan.kpis.find((definition) => definition.key === "groupPendingApprovals") ?? null);
  const widgets = plan.widgets.filter((definition) => definition !== approvalsWidget);
  const kpis = plan.kpis.filter((definition) => definition !== approvalsKpi);

  return (
    <ModuleMessages namespaces={["dashboard"]}>
      <div className="space-y-6">
        <WelcomeHeader
          context={context}
          focus={plan.focus}
          aside={
            <>
              {/* The day's entry point: a dark card on a phone, the plain row from tablet up (Premium Mobile §5.2). */}
              <Link
                href="/my-day"
                data-testid="open-my-day"
                className={cn(
                  "group relative flex items-center justify-between gap-3 overflow-hidden border border-accent/30 bg-hero p-5 text-hero-fg",
                  "rounded-[22px] before:absolute before:left-5 before:top-0 before:h-0.5 before:w-9 before:bg-hero-accent before:content-['']",
                  "md:min-h-14 md:rounded-lg md:border-line md:bg-surface md:px-4 md:py-3 md:text-fg md:before:hidden md:hover:bg-row-hover",
                  // Beside the heading it is one slim row, so Pending Approvals keeps most of the heading's height.
                  "lg:min-h-0 lg:shrink-0 lg:py-2",
                )}
              >
                <span className="min-w-0 lg:flex lg:items-baseline lg:gap-2.5">
                  <span className="nesto-eyebrow block text-hero-accent md:text-body md:font-semibold md:normal-case md:tracking-normal md:text-fg lg:shrink-0">{misc("myDay.title")}</span>
                  <span className="mt-1.5 block font-serif text-[1.375rem] leading-tight md:mt-0 md:truncate md:font-sans md:text-meta md:leading-normal md:text-fg-muted lg:min-w-0">{misc("myDay.openMyDayHint")}</span>
                </span>
                <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-hero-accent text-hero md:size-auto md:bg-transparent md:text-fg-subtle">
                  <ArrowRight className="size-[18px] md:hidden" />
                  <ChevronRight className="hidden size-4 md:block" />
                </span>
              </Link>

              {/* Pending Approvals, on the accent colour and inside the heading's height: what fits, and a way to the rest. */}
              {approvalsWidget ? (
                <div
                  className="nesto-on-accent flex min-h-0 min-w-0 flex-1 flex-col"
                  data-testid="dashboard-approvals"
                  data-section={primary === `widget:${approvalsWidget.key}` ? "primary" : undefined}
                >
                  <SectionBoundary className="nesto-card flex-1">
                    <Suspense fallback={<PendingApprovalsSkeleton title={widgetText(t, approvalsWidget.key, "title", approvalsWidget.title)} />}>
                      <PendingApprovalsList context={context} definition={approvalsWidget} />
                    </Suspense>
                  </SectionBoundary>
                </div>
              ) : approvalsKpi ? (
                <div
                  className="nesto-on-accent flex min-h-0 min-w-0 flex-1 flex-col"
                  data-testid="dashboard-approvals"
                  data-section={primary === `kpi:${approvalsKpi.key}` ? "primary" : undefined}
                >
                  <SectionBoundary className="nesto-card flex-1">
                    <Suspense fallback={<PendingApprovalsSkeleton title={kpiLabel(t, approvalsKpi.key, approvalsKpi.label)} />}>
                      <PendingApprovalsFigure context={context} definition={approvalsKpi} />
                    </Suspense>
                  </SectionBoundary>
                </div>
              ) : null}
            </>
          }
        />

        <Suspense fallback={null}>
          <GroupBanner group={group} />
        </Suspense>

        <QuickActions actions={plan.quickActions} />

        {kpis.length > 0 ? (
          <KpiGrid count={kpis.length}>
            {kpis.map((definition) => (
              <SectionBoundary key={definition.key} className="nesto-card">
                <Suspense fallback={<KpiSkeleton />}>
                  <Kpi
                    context={context}
                    definition={definition}
                    primary={primary === `kpi:${definition.key}`}
                  />
                </Suspense>
              </SectionBoundary>
            ))}
          </KpiGrid>
        ) : null}

        <DashboardGrid>
          {widgets.map((definition) => {
            const span = widgetSpanClasses[SPAN[definition.size]];
            return (
              <div
                key={definition.key}
                className={cn("flex min-w-0 flex-col", span)}
                data-section={
                  primary === `widget:${definition.key}` ? "primary" : undefined
                }
              >
                <SectionBoundary className="nesto-card flex-1">
                  <Suspense
                    fallback={<WidgetSkeleton title={widgetText(t, definition.key, "title", definition.title)} />}
                  >
                    <Widget context={context} definition={definition} />
                  </Suspense>
                </SectionBoundary>
              </div>
            );
          })}
        </DashboardGrid>
      </div>
    </ModuleMessages>
  );
}

async function GroupBanner({
  group,
}: {
  group: Promise<Awaited<ReturnType<typeof groupIdentity>> | null>;
}) {
  const identity = await group;
  return identity ? <GroupHero identity={identity} /> : null;
}

async function Kpi({
  context,
  definition,
  primary,
}: {
  context: UserContext;
  definition: DashboardPlan["kpis"][number];
  primary: boolean;
}) {
  const kpi = await loadPlannedKpi(context, definition);
  // Nothing behind a group figure for this reader: the tile is left out (D-01 §66).
  if (!kpi) return null;
  return primary ? (
    <div data-section="primary" className="contents">
      <KpiCard kpi={kpi} />
    </div>
  ) : (
    <KpiCard kpi={kpi} />
  );
}

async function Widget({
  context,
  definition,
}: {
  context: UserContext;
  definition: DashboardPlan["widgets"][number];
}) {
  const widget = await loadPlannedWidget(context, definition);
  // Inside its planned cell: the cell owns the span, the widget fills it.
  return <DashboardWidget widget={widget} fill />;
}

function KpiSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="nesto-card space-y-3 p-4"
      data-testid="section-skeleton"
    >
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-lg" />
        <Skeleton className="h-3.5 w-24" />
      </div>
      <Skeleton className="h-7 w-16" />
    </div>
  );
}

/** A widget's title is only drawn where the plan already gave the reader that widget. */
function WidgetSkeleton({ title }: { title: string }) {
  return (
    <section
      aria-busy="true"
      className="nesto-card flex min-h-48 flex-1 flex-col p-5"
      data-testid="section-skeleton"
    >
      <h2 className="text-card font-semibold text-fg">{title}</h2>
      <div aria-hidden="true" className="mt-4 space-y-3">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3.5 w-1/2" />
      </div>
    </section>
  );
}
