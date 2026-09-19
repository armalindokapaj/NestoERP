import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { listImplementations } from "@/lib/modules/platform/platform-control.query";
import { formatDate } from "@/lib/utils/format";

export const metadata = { title: "Implementations" };

export default async function ImplementationsPage() {
  const context = await requirePlatformContext(); const rows = await listImplementations(context);
  return <div className="space-y-5"><PageHeader title="Implementations" description="Provisioning, validation and handover for every parent group." /><section className="nesto-card p-5"><Table flush aria-label="Implementations"><TableHead><TableRow><TableHeaderCell>Group</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell>Companies</TableHeaderCell><TableHeaderCell>People</TableHeaderCell><TableHeaderCell>Departments</TableHeaderCell><TableHeaderCell>Last updated</TableHeaderCell></TableRow></TableHead><TableBody>{rows.map((row) => <TableRow key={row.id}><TableCell><Link href={`/platform-admin/groups/${row.id}`} className="font-medium text-accent-strong hover:underline">{row.name}</Link><p className="font-mono text-micro text-fg-subtle">{row.slug}</p></TableCell><TableCell><Badge tone={row.implementationStatus === "COMPLETED" ? "success" : row.implementationStatus === "PAUSED" ? "danger" : "warning"}>{row.implementationStatus.replaceAll("_", " ")}</Badge></TableCell><TableCell>{row._count.companies}</TableCell><TableCell>{row._count.people}</TableCell><TableCell>{row._count.departments}</TableCell><TableCell>{formatDate(row.updatedAt)}</TableCell></TableRow>)}</TableBody></Table></section></div>;
}
