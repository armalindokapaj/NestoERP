import Link from "@/components/navigation/nav-link";
import { PlatformCommandButton } from "@/components/platform/platform-command";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { listArchivedDocuments } from "@/lib/modules/platform/platform-recovery.service";
import { formatDate } from "@/lib/utils/format";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const size = (bytes: number | null) => (bytes === null ? "—" : bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`);

/** Archived documents across companies. Archiving never removes the file, so a restore returns it as it was. */
export async function RecoveryDocuments({ searchParams }: Props) {
  const raw = await searchParams;
  const q = first(raw.q)?.trim() ?? "";
  const pageNumber = Number(first(raw.page)) || 1;
  const context = await requirePlatformContext();
  const { rows, total, page, pages } = await listArchivedDocuments(context, { q, page: pageNumber });
  const canRestore = canPlatform(context, "platform.recovery.restore");
  const href = (next: number) => `/admin/system/recovery?${new URLSearchParams({ section: "documents", ...(q ? { q } : {}), ...(next > 1 ? { page: String(next) } : {}) })}`;
  return (
    <div className="space-y-5">
      <PageHeader title="Recover documents" description="Documents archived by any company. Restoring one puts it back in its company with the status it had." />
      <form action="/admin/system/recovery" className="flex gap-2">
        <input type="hidden" name="section" value="documents" />
        <input name="q" defaultValue={q} placeholder="Search by document or file name" aria-label="Search documents" className="h-9 w-full max-w-sm rounded-md border border-line bg-surface px-3 text-body" />
        <button type="submit" className="h-9 rounded-md border border-line px-3 text-table hover:bg-surface-muted">Search</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title={q ? "No archived document matches" : "No archived documents"} description={q ? "Try another name." : "Documents a company archives appear here."} />
      ) : (
        <section className="nesto-card p-5">
          <Table flush aria-label="Archived documents" data-testid="archived-documents">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Document</TableHeaderCell>
                <TableHeaderCell>Company</TableHeaderCell>
                <TableHeaderCell>Size</TableHeaderCell>
                <TableHeaderCell>Archived</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium text-fg">{row.name}</TableCell>
                  <TableCell><Link href={`/admin/organizations/${row.company.id}`} className="hover:underline">{row.company.name}</Link></TableCell>
                  <TableCell>{size(row.sizeBytes)}</TableCell>
                  <TableCell>{row.archivedAt ? formatDate(row.archivedAt) : "—"}{row.archivedBy ? <p className="text-meta text-fg-subtle">by {row.archivedBy}</p> : null}</TableCell>
                  <TableCell className="text-right">
                    {canRestore ? <PlatformCommandButton label="Restore" title={`Restore ${row.name}?`} description={`It returns to ${row.company.name} as it was before it was archived.`} action="document.restore" fixed={{ documentId: row.id }} reasonOnly submitLabel="Restore" success="Document restored." /> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 flex items-center justify-between text-meta text-fg-subtle">
            <span>{total} archived {total === 1 ? "document" : "documents"}</span>
            {pages > 1 ? (
              <span className="flex gap-3">
                {page > 1 ? <Link href={href(page - 1)} className="hover:underline">Previous</Link> : null}
                <span>Page {page} of {pages}</span>
                {page < pages ? <Link href={href(page + 1)} className="hover:underline">Next</Link> : null}
              </span>
            ) : null}
          </p>
        </section>
      )}
    </div>
  );
}
