import type { Metadata } from "next";

import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { moduleCatalog } from "@/lib/modules/entitlements/entitlement.service";

export const metadata: Metadata = { title: "Module catalog" };

/**
 * The module catalog (Admin Modules PRD #4 §4-§7, §37-§39): what NESTO
 * functionality exists, its stable key, scope and dependencies. Modules are
 * defined in code and never deleted from here; Required ones cannot be
 * withheld from any company.
 */
export default async function ModuleCatalogPage() {
  const context = await requirePlatformContext();
  const catalog = await moduleCatalog(context);
  return (
    <div className="space-y-5">
      <PageHeader title="Module catalog" description="Every NESTO module, its internal key, scope and what it needs granted beside it." />
      <section className="nesto-card overflow-x-auto">
        <Table flush aria-label="Module catalog">
          <TableHead><TableRow><TableHeaderCell>Module</TableHeaderCell><TableHeaderCell className="max-md:hidden">Internal key</TableHeaderCell><TableHeaderCell>Scope</TableHeaderCell><TableHeaderCell className="max-lg:hidden">Needs</TableHeaderCell><TableHeaderCell className="max-sm:hidden">In use</TableHeaderCell><TableHeaderCell>Availability</TableHeaderCell></TableRow></TableHead>
          <TableBody>
            {catalog.modules.map((row) => (
              <TableRow key={row.key}>
                <TableCell><span className="font-medium text-fg">{row.name}</span><p className="max-w-md text-meta text-fg-subtle max-md:hidden">{row.description}</p></TableCell>
                <TableCell className="font-mono text-meta max-md:hidden">{row.key}</TableCell>
                <TableCell>{row.scope === "Required" ? <AdminStatusBadge status="Required" /> : row.scope}</TableCell>
                <TableCell className="text-meta text-fg-muted max-lg:hidden">{row.dependencies.join(", ") || "—"}</TableCell>
                <TableCell className="tabular-nums max-sm:hidden">{row.scope === "Required" ? "All" : row.scope === "Project" ? `${row.enabled} projects` : `${row.enabled} / ${catalog.companies}`}</TableCell>
                <TableCell>{row.availability}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
