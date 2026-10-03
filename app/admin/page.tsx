import { Suspense } from "react";

import { AdminSectionBoundary } from "@/components/platform/admin-section-boundary";
import { AdminRefreshButton } from "@/components/platform/admin-refresh-button";
import { getTranslations } from "@/lib/i18n/server";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { dashboardSummary } from "@/lib/modules/platform/platform-dashboard.query";
import {
  ActivitySection, AttentionSection, DashboardHeader, FirstRun, ListSkeleton, OrganizationsSection, ProjectsSection, SummarySection, SummarySkeleton, UsageSection,
} from "./_dashboard/sections";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("nav.dest.dashboard") };
}

/**
 * The Platform Admin home (Dashboard PRD §1-§5, §34, §35): platform state and
 * what needs attention first, then recent activity, the newest organizations
 * and projects, and usage. Authorization is settled before any section loads
 * (§61, §62); each section then streams and fails on its own (§43, §44).
 */
export default async function PlatformDashboardPage() {
  const context = await requirePlatformContext();
  // Read once, shared by the sections that need it.
  const summary = dashboardSummary(context);
  summary.catch(() => undefined);
  const t = await getTranslations("admin");
  const section = (title: string, node: React.ReactNode, fallback: React.ReactNode) => (
    <AdminSectionBoundary title={title}><Suspense fallback={fallback}>{node}</Suspense></AdminSectionBoundary>
  );
  return (
    <div className="space-y-6">
      <DashboardHeader context={context} actions={<AdminRefreshButton />} />
      {section(t("dashboard.summaryLabel"), <SummarySection context={context} summary={summary} />, <SummarySkeleton />)}
      <Suspense fallback={null}><FirstRun summary={summary} /></Suspense>
      <div className="grid gap-4 xl:grid-cols-[3fr_2fr] [&>*]:min-w-0">
        {section(t("dashboard.attentionTitle"), <AttentionSection context={context} />, <ListSkeleton rows={3} label={t("dashboard.attentionTitle").toLowerCase()} />)}
        {section(t("dashboard.activityTitle"), <ActivitySection context={context} />, <ListSkeleton rows={6} label={t("dashboard.activityTitle").toLowerCase()} />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        {section(t("dashboard.orgsTitle"), <OrganizationsSection context={context} />, <ListSkeleton label={t("dashboard.orgsTitle").toLowerCase()} />)}
        {section(t("dashboard.projectsTitle"), <ProjectsSection context={context} summary={summary} />, <ListSkeleton label={t("dashboard.projectsTitle").toLowerCase()} />)}
      </div>
      {section(t("dashboard.usageTitle"), <UsageSection context={context} />, <ListSkeleton rows={2} label={t("dashboard.usageTitle").toLowerCase()} />)}
    </div>
  );
}
