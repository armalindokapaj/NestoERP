import Link from "@/components/navigation/nav-link";

import { CreateGroupButton } from "@/components/platform/platform-actions";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { listParentGroups } from "@/lib/modules/platform/platform.service";
import { formatDate } from "@/lib/utils/format";

export const metadata = { title: "Parent groups" };
const tone = (status: string) => status === "ACTIVE" ? "success" as const : status === "SUSPENDED" || status === "ARCHIVED" ? "danger" as const : "warning" as const;

export default async function GroupsPage() {
  const context = await requirePlatformContext();
  const groups = await listParentGroups(context);
  return <div className="space-y-5"><PageHeader title="Parent groups" description="Canonical tenant roots, their lifecycle and implementation state." actions={canPlatform(context, "platform.group.create") ? <CreateGroupButton /> : undefined} />
    <section className="nesto-card p-5">{groups.length === 0 ? <EmptyState title="No parent groups yet" description="Create the first tenant implementation." /> : <Table flush aria-label="Parent groups"><TableHead><TableRow><TableHeaderCell>Group</TableHeaderCell><TableHeaderCell>Code</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell>Companies</TableHeaderCell><TableHeaderCell>Country</TableHeaderCell><TableHeaderCell>Activated</TableHeaderCell></TableRow></TableHead><TableBody>{groups.map((group) => <TableRow key={group.id}><TableCell><Link href={`/platform-admin/groups/${group.id}`} className="font-medium text-fg hover:text-accent-strong hover:underline">{group.name}</Link></TableCell><TableCell className="font-mono text-meta">{group.slug}</TableCell><TableCell><Badge tone={tone(group.status)}>{group.status.replaceAll("_", " ")}</Badge></TableCell><TableCell>{group.companyCount}</TableCell><TableCell>{group.country ?? "—"}</TableCell><TableCell>{group.activatedAt ? formatDate(group.activatedAt) : "—"}</TableCell></TableRow>)}</TableBody></Table>}</section>
  </div>;
}
