import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PersonLink } from "@/components/people/person-link";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import type { CredentialWorkItemDTO, CredentialWorklistDTO } from "@/lib/modules/hr/credentials/credential.types";
import { VERIFICATION_LABELS } from "@/lib/modules/hr/documents/employee-document.types";
import { formatDate } from "@/lib/utils/format";

/**
 * HR's credential worklists (E-02 §153, §154): a list of what to open, each
 * row linking to the employee file or the person's qualifications where it is
 * verified, renewed or put away. Nothing is decided here; the rows are the
 * ones the server found this reader may act on.
 */

const EMPTY: Record<CredentialWorklistDTO["view"], { title: string; description: string }> = {
  verify: { title: "Nothing waiting to be verified", description: "Documents and qualifications added for people you look after appear here until somebody checks them." },
  expiring: { title: "Nothing runs out in the next 30 days", description: "Licences, permits and certificates appear here a month before their date." },
  expired: { title: "Nothing has run out", description: "A current document or qualification past its date appears here until it is renewed or put away." },
};

function When({ item, view }: { item: CredentialWorkItemDTO; view: CredentialWorklistDTO["view"] }) {
  if (view === "verify") return <span className="whitespace-nowrap text-fg-muted">added {formatDate(item.createdAt)}</span>;
  if (!item.expiryDate || item.daysToExpiry === null) return <span className="text-fg-subtle">—</span>;
  const overdue = item.daysToExpiry < 0;
  return (
    <span className={overdue ? "whitespace-nowrap text-danger-strong" : "whitespace-nowrap text-warning-strong"}>
      {formatDate(item.expiryDate)}
      <span className="block text-meta">{overdue ? `${-item.daysToExpiry} days ago` : item.daysToExpiry === 0 ? "today" : `in ${item.daysToExpiry} days`}</span>
    </span>
  );
}

export function CredentialWorklist({ data }: { data: CredentialWorklistDTO }) {
  if (data.items.length === 0) {
    return <EmptyState icon={<ShieldCheck />} title={EMPTY[data.view].title} description={EMPTY[data.view].description} />;
  }
  return (
    <div className="space-y-3" data-testid="credential-worklist" data-view={data.view}>
      <div className="nesto-card hidden p-0 md:block">
        <Table aria-label="Worklist">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Person</TableHeaderCell>
              <TableHeaderCell>What</TableHeaderCell>
              <TableHeaderCell>Issuer</TableHeaderCell>
              <TableHeaderCell>{data.view === "verify" ? "Waiting since" : "Expires"}</TableHeaderCell>
              <TableHeaderCell>Verification</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.items.map((item) => (
              <TableRow key={`${item.kind}:${item.id}`} data-testid="worklist-item" data-kind={item.kind}>
                <TableCell className="font-medium text-fg">
                  <PersonLink personId={item.personId} name={item.personName} />
                </TableCell>
                <TableCell className="max-w-[22rem]">
                  <Link href={item.href} className="font-medium text-fg hover:text-accent-strong hover:underline">
                    {item.title}
                  </Link>
                  <span className="block text-meta text-fg-muted">{item.kindLabel}</span>
                </TableCell>
                <TableCell>{item.issuer ?? "—"}</TableCell>
                <TableCell>
                  <When item={item} view={data.view} />
                </TableCell>
                <TableCell>
                  <Badge tone={item.verificationStatus === "VERIFIED" ? "success" : item.verificationStatus === "UNVERIFIED" ? "info" : "warning"}>{VERIFICATION_LABELS[item.verificationStatus]}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-2 md:hidden" aria-label="Worklist">
        {data.items.map((item) => (
          <li key={`${item.kind}:${item.id}`} data-testid="worklist-card">
            <Link href={item.href} className="nesto-card block space-y-1 p-3 hover:border-line-strong">
              <span className="block font-medium text-fg">{item.title}</span>
              <span className="block text-meta text-fg-muted">
                {item.personName} · {item.kindLabel}
              </span>
              <span className="flex flex-wrap items-center gap-2 text-meta">
                <When item={item} view={data.view} />
                <Badge tone={item.verificationStatus === "VERIFIED" ? "success" : item.verificationStatus === "UNVERIFIED" ? "info" : "warning"}>{VERIFICATION_LABELS[item.verificationStatus]}</Badge>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {data.truncated ? <p className="text-meta text-fg-subtle">Showing the first {data.items.length} of {data.counts[data.view]}. Work through these and the rest follow.</p> : null}
    </div>
  );
}
