import { Suspense } from "react";

import { AdminSectionBoundary } from "@/components/platform/admin-section-boundary";
import { AdminRefreshButton } from "@/components/platform/admin-refresh-button";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { dashboardSummary } from "@/lib/modules/platform/platform-dashboard.query";
import {
  ActivitySection, AttentionSection, FirstRun, ListSkeleton, OrganizationsSection, ProjectsSection, SummarySection, SummarySkeleton, UsageSection,
} from "./_dashboard/sections";

export const metadata = { title: "Dashboard" };

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
  const section = (title: string, node: React.ReactNode, fallback: React.ReactNode) => (
    <AdminSectionBoundary title={title}><Suspense fallback={fallback}>{node}</Suspense></AdminSectionBoundary>
  );
  return (
    <div className="space-y-5">
      <PageHeader title="Dashboard" description="Platform status and administration overview." actions={<AdminRefreshButton />} />
      {section("Summary", <SummarySection context={context} summary={summary} />, <SummarySkeleton />)}
      <Suspense fallback={null}><FirstRun summary={summary} /></Suspense>
      <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
        {section("Attention required", <AttentionSection context={context} />, <ListSkeleton rows={3} label="attention" />)}
        {section("Recent activity", <ActivitySection context={context} />, <ListSkeleton rows={6} label="recent activity" />)}
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        {section("Organizations", <OrganizationsSection context={context} />, <ListSkeleton label="organizations" />)}
        {section("Projects", <ProjectsSection context={context} summary={summary} />, <ListSkeleton label="projects" />)}
      </div>
      {section("Platform usage", <UsageSection context={context} />, <ListSkeleton rows={2} label="platform usage" />)}
    </div>
  );
}
