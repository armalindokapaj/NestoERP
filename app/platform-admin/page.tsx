import type { Metadata } from "next";

import { StatusBadge } from "@/components/modules/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { listParentGroups } from "@/lib/modules/platform/platform.service";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Parent groups" };

export default async function PlatformAdminPage() {
  const context = await requirePlatformContext();
  const groups = await listParentGroups(context);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Parent groups"
        description="Every group on the platform, the companies connected to it and where its implementation stands."
      />

      <section className="nesto-card p-5">
        {groups.length === 0 ? (
          <EmptyState title="No parent groups yet" description="A group appears here once it has been created." />
        ) : (
          <Table flush aria-label="Parent groups">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Group</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Companies</TableHeaderCell>
                <TableHeaderCell>Country</TableHeaderCell>
                <TableHeaderCell>Activated</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group.id}>
                  <TableCell>
                    <p className="font-medium text-fg">{group.name}</p>
                    <p className="text-meta text-fg-subtle">{group.slug}</p>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={group.status} />
                  </TableCell>
                  <TableCell>{group.companyCount}</TableCell>
                  <TableCell>{group.country ?? "—"}</TableCell>
                  <TableCell>{group.activatedAt ? formatDate(group.activatedAt) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
