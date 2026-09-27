import type { Metadata } from "next";
import { Suspense } from "react";

import {
  DashboardGrid,
  KpiGrid,
  widgetSpanClasses,
} from "@/components/dashboard/dashboard-grid";
import { DashboardWidget, SPAN } from "@/components/dashboard/dashboard-widget";
import { KpiCard } from "@/components/dashboard/kpi-card";
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
 */
export default async function DashboardPage() {
  const context = await requireUserContext();
  const plan = await planDashboard(context);
  // The group's banner is the Group workspace's (D-01 §26, §66; Workspace Context §18).
  const group = groupIdentity(context).catch(() => null);
  const primary = plan.widgets[0]
    ? `widget:${plan.widgets[0].key}`
    : plan.kpis[0]
      ? `kpi:${plan.kpis[0].key}`
      : null;

  return (
    <ModuleMessages namespaces={["dashboard"]}>
      <div className="space-y-6">
        <WelcomeHeader context={context} focus={plan.focus} />

        <Suspense fallback={null}>
          <GroupBanner group={group} />
        </Suspense>

        <QuickActions actions={plan.quickActions} />

        {plan.kpis.length > 0 ? (
          <KpiGrid count={plan.kpis.length}>
            {plan.kpis.map((definition) => (
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
          {plan.widgets.map((definition) => {
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
                    fallback={<WidgetSkeleton title={definition.title} />}
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
