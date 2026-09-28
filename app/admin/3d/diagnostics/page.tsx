import Link from "@/components/navigation/nav-link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { listProject3DDiagnostics } from "@/lib/modules/project-3d/project-3d.service";

export const metadata = { title: "3D Diagnostics" };

export default async function DiagnosticsPage() {
  const context = await requirePlatformContext();
  const rows = await listProject3DDiagnostics(context);
  const withoutModel = rows.filter((row) => row.slots.length === 0 || row.slots.some((slot) => slot.versions.length === 0));
  const failed = rows.flatMap((row) => row.slots.flatMap((slot) => slot.versions
    .filter((version) => version.status === "FAILED" || version.validationStatus === "BLOCKED")
    .map((version) => ({ row, slot, version }))));
  const unpublished = rows.filter((row) => row.entitlementStatus === "ACTIVE" && !row.activeReleaseId);

  return <div className="space-y-5">
    <PageHeader title="3D diagnostics" description="Model processing, validation, entitlement, and release integrity across native Project 3D workspaces." />
    <div className="grid gap-4 md:grid-cols-4">
      <Card className="p-5"><p className="text-table text-fg-muted">Workspaces</p><p className="mt-2 text-3xl font-semibold">{rows.length}</p></Card>
      <Card className="p-5"><p className="text-table text-fg-muted">Missing models</p><p className="mt-2 text-3xl font-semibold">{withoutModel.length}</p></Card>
      <Card className="p-5"><p className="text-table text-fg-muted">Failed versions</p><p className="mt-2 text-3xl font-semibold">{failed.length}</p></Card>
      <Card className="p-5"><p className="text-table text-fg-muted">Awaiting release</p><p className="mt-2 text-3xl font-semibold">{unpublished.length}</p></Card>
    </div>
    <Card className="p-5">
      <h2 className="text-card font-semibold">Findings</h2>
      <div className="mt-4 space-y-2">
        {withoutModel.map((row) => <Finding key={`model-${row.id}`} row={row} label="has an active slot without a model version." tone="warning" badge="MODEL NEEDED" />)}
        {failed.map(({ row, slot, version }) => <Finding key={version.id} row={row} label={`${slot.displayName} v${version.version} failed processing or validation.`} tone="danger" badge="FAILED" />)}
        {unpublished.map((row) => <Finding key={`release-${row.id}`} row={row} label="has active entitlement but no active release." tone="info" badge="UNPUBLISHED" />)}
        {!withoutModel.length && !failed.length && !unpublished.length ? <p className="text-table text-fg-muted">No 3D integrity problems detected.</p> : null}
      </div>
    </Card>
  </div>;
}

function Finding({ row, label, tone, badge }: {
  row: { projectId: string; projectName: string; companyName: string };
  label: string;
  tone: "warning" | "danger" | "info";
  badge: string;
}) {
  return <Link href={`/admin/3d/projects/${row.projectId}`} className="flex items-center justify-between gap-4 rounded-lg border border-line px-4 py-3 hover:bg-surface-subtle">
    <span><span className="font-medium text-fg">{row.projectName}</span> <span className="text-fg-muted">({row.companyName}) {label}</span></span>
    <Badge tone={tone}>{badge}</Badge>
  </Link>;
}
