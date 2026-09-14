import Link from "next/link";
import { DraftingCompass, FileStack, MessageSquareText, Send } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import {
  DISCIPLINE_LABELS,
  DOCUMENT_TYPE_LABELS,
  SUBMITTAL_TYPE_LABELS,
  TRANSMITTAL_DIRECTION_LABELS,
  TRANSMITTAL_PURPOSE_LABELS,
  type EngineeringDocumentRowDTO,
  type RfiRowDTO,
  type SubmittalRowDTO,
  type TransmittalRowDTO,
} from "@/lib/modules/engineering/engineering.types";
import { Due, Person, PriorityMark, Ref, ReviewBadge } from "./engineering-ui";

/**
 * The engineering registers (PRD #46 §77, §166-§169, §314, §317). A clean data
 * table with a sticky header on a desk; on a phone each row becomes a card
 * with the number, the status and what is late. Every row opens the record.
 */

function MobileCard({ href, number, title, status, lines, testId }: { href: string; number: string; title: string; status: React.ReactNode; lines: Array<React.ReactNode>; testId: string }) {
  return (
    <li>
      <Link href={href} className="block rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong" data-testid={testId}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-meta text-fg-muted">{number}</p>
            <p className="mt-0.5 text-body font-medium text-fg">{title}</p>
          </div>
          <div className="shrink-0">{status}</div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-table text-fg-muted">{lines}</div>
      </Link>
    </li>
  );
}

const numberCell = "whitespace-nowrap font-mono text-table text-fg";

export function RfiRegister({ items, showProject = false, showAssignee = true, emptyTitle = "No RFIs here." }: { items: RfiRowDTO[]; showProject?: boolean; showAssignee?: boolean; emptyTitle?: string }) {
  if (!items.length) return <EmptyState icon={<MessageSquareText />} title={emptyTitle} description="Requests for information raised on the project appear here." />;
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell scope="col">RFI</TableHeaderCell>
              <TableHeaderCell scope="col">Subject</TableHeaderCell>
              {showProject ? <TableHeaderCell scope="col">Project</TableHeaderCell> : null}
              <TableHeaderCell scope="col">Contractor</TableHeaderCell>
              {showAssignee ? <TableHeaderCell scope="col">Assignee</TableHeaderCell> : null}
              <TableHeaderCell scope="col">Status</TableHeaderCell>
              <TableHeaderCell scope="col">Due</TableHeaderCell>
              <TableHeaderCell scope="col" className="text-right">
                Age
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((row) => (
              <TableRow key={row.id} data-testid="rfi-row">
                <TableCell className={numberCell}>
                  <Link href={row.href} className="hover:underline">
                    {row.rfiNumber}
                  </Link>
                </TableCell>
                <TableCell className="min-w-[14rem]">
                  <Link href={row.href} className="font-medium text-fg hover:underline">
                    {row.subject}
                  </Link>
                  {row.priority === "HIGH" || row.priority === "CRITICAL" ? (
                    <span className="ml-2 align-middle">
                      <PriorityMark priority={row.priority} />
                    </span>
                  ) : null}
                </TableCell>
                {showProject ? <TableCell className="text-fg-muted">{row.projectName}</TableCell> : null}
                <TableCell className="max-w-[14rem]">
                  <div className="truncate" title={row.contractor?.label}>
                    <Ref value={row.contractor} />
                  </div>
                  {row.workPackage ? (
                    <div className="truncate text-meta text-fg-muted" title={row.workPackage.label}>
                      {row.workPackage.label}
                    </div>
                  ) : null}
                </TableCell>
                {showAssignee ? (
                  <TableCell className="whitespace-nowrap">
                    <Person value={row.assignee} />
                  </TableCell>
                ) : null}
                <TableCell>
                  <ReviewBadge status={row.overdue ? "OVERDUE" : row.status} label={row.overdue ? "Overdue" : undefined} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Due date={row.dueAt} overdue={row.overdue} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums text-fg-muted">{row.ageDays}d</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="space-y-2 md:hidden">
        {items.map((row) => (
          <MobileCard
            key={row.id}
            testId="rfi-card"
            href={row.href}
            number={row.rfiNumber}
            title={row.subject}
            status={<ReviewBadge status={row.overdue ? "OVERDUE" : row.status} label={row.overdue ? "Overdue" : undefined} />}
            lines={[row.assignee ? <span key="a">{row.assignee.name}</span> : null, row.dueAt ? <span key="d">Due <Due date={row.dueAt} overdue={row.overdue} /></span> : null, row.contractor ? <span key="c">{row.contractor.label}</span> : null, showProject ? <span key="p">{row.projectName}</span> : null]}
          />
        ))}
      </ul>
    </>
  );
}

export function SubmittalRegister({ items, showProject = false, emptyTitle = "No submittals here." }: { items: SubmittalRowDTO[]; showProject?: boolean; emptyTitle?: string }) {
  if (!items.length) return <EmptyState icon={<FileStack />} title={emptyTitle} description="Shop drawings, materials and method statements sent for review appear here." />;
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell scope="col">Submittal</TableHeaderCell>
              <TableHeaderCell scope="col">Title</TableHeaderCell>
              <TableHeaderCell scope="col">Type</TableHeaderCell>
              {showProject ? <TableHeaderCell scope="col">Project</TableHeaderCell> : null}
              <TableHeaderCell scope="col">Contractor</TableHeaderCell>
              <TableHeaderCell scope="col">Revision</TableHeaderCell>
              <TableHeaderCell scope="col">Reviewer</TableHeaderCell>
              <TableHeaderCell scope="col">Status</TableHeaderCell>
              <TableHeaderCell scope="col">Due</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((row) => (
              <TableRow key={row.id} data-testid="submittal-row">
                <TableCell className={numberCell}>
                  <Link href={row.href} className="hover:underline">
                    {row.submittalNumber}
                  </Link>
                </TableCell>
                <TableCell className="min-w-[14rem]">
                  <Link href={row.href} className="font-medium text-fg hover:underline">
                    {row.title}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap text-fg-muted">{SUBMITTAL_TYPE_LABELS[row.submittalType]}</TableCell>
                {showProject ? <TableCell className="text-fg-muted">{row.projectName}</TableCell> : null}
                <TableCell className="max-w-[14rem]">
                  <div className="truncate" title={row.contractor?.label}>
                    <Ref value={row.contractor} />
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-table">{row.currentRevision ? `Rev ${row.currentRevision.code}` : <span className="text-fg-subtle">—</span>}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <Person value={row.reviewer} />
                </TableCell>
                <TableCell>
                  <ReviewBadge status={row.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Due date={row.dueAt} overdue={row.overdue} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="space-y-2 md:hidden">
        {items.map((row) => (
          <MobileCard
            key={row.id}
            testId="submittal-card"
            href={row.href}
            number={`${row.submittalNumber}${row.currentRevision ? ` · Rev ${row.currentRevision.code}` : ""}`}
            title={row.title}
            status={<ReviewBadge status={row.status} />}
            lines={[<span key="t">{SUBMITTAL_TYPE_LABELS[row.submittalType]}</span>, row.reviewer ? <span key="r">{row.reviewer.name}</span> : null, row.dueAt ? <span key="d">Due <Due date={row.dueAt} overdue={row.overdue} /></span> : null]}
          />
        ))}
      </ul>
    </>
  );
}

export function DocumentRegister({ items, drawings = false, showProject = false, emptyTitle }: { items: EngineeringDocumentRowDTO[]; drawings?: boolean; showProject?: boolean; emptyTitle?: string }) {
  if (!items.length) return <EmptyState icon={<DraftingCompass />} title={emptyTitle ?? (drawings ? "No drawings registered." : "No engineering documents registered.")} description="Register a document, then add its revisions as files arrive." />;
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell scope="col">{drawings ? "Drawing no." : "Document no."}</TableHeaderCell>
              <TableHeaderCell scope="col">Title</TableHeaderCell>
              {drawings ? null : <TableHeaderCell scope="col">Type</TableHeaderCell>}
              <TableHeaderCell scope="col">Discipline</TableHeaderCell>
              {showProject ? <TableHeaderCell scope="col">Project</TableHeaderCell> : null}
              <TableHeaderCell scope="col">Contractor</TableHeaderCell>
              <TableHeaderCell scope="col">Revision</TableHeaderCell>
              <TableHeaderCell scope="col">Status</TableHeaderCell>
              <TableHeaderCell scope="col">Review due</TableHeaderCell>
              <TableHeaderCell scope="col">Reviewer</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((row) => (
              <TableRow key={row.id} data-testid="document-row" className={row.status === "SUPERSEDED" || row.status === "VOID" ? "opacity-70" : undefined}>
                <TableCell className={numberCell}>
                  <Link href={row.href} className="hover:underline">
                    {row.documentNumber}
                  </Link>
                </TableCell>
                <TableCell className="min-w-[14rem]">
                  <Link href={row.href} className="font-medium text-fg hover:underline">
                    {row.title}
                  </Link>
                </TableCell>
                {drawings ? null : <TableCell className="whitespace-nowrap text-fg-muted">{DOCUMENT_TYPE_LABELS[row.documentType]}</TableCell>}
                <TableCell className="whitespace-nowrap text-fg-muted">{DISCIPLINE_LABELS[row.discipline]}</TableCell>
                {showProject ? <TableCell className="text-fg-muted">{row.projectName}</TableCell> : null}
                <TableCell className="max-w-[14rem]">
                  <div className="truncate" title={row.contractor?.label}>
                    <Ref value={row.contractor} />
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-table" data-testid="document-current-revision">
                  {row.currentRevision ? `Rev ${row.currentRevision.code}` : <span className="text-fg-subtle">—</span>}
                  {row.revisionCount > 1 ? <span className="ml-1.5 font-sans text-meta text-fg-subtle">of {row.revisionCount}</span> : null}
                </TableCell>
                <TableCell>
                  <ReviewBadge status={row.status} />
                </TableCell>
                <TableCell>
                  <Due date={row.reviewDueAt} overdue={row.overdue} />
                </TableCell>
                <TableCell>
                  <Person value={row.reviewer} fallback="—" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="space-y-2 md:hidden">
        {items.map((row) => (
          <MobileCard
            key={row.id}
            testId="document-card"
            href={row.href}
            number={`${row.documentNumber}${row.currentRevision ? ` · Rev ${row.currentRevision.code}` : ""}`}
            title={row.title}
            status={<ReviewBadge status={row.status} />}
            lines={[<span key="d">{DISCIPLINE_LABELS[row.discipline]}</span>, row.reviewDueAt ? <span key="r">Review <Due date={row.reviewDueAt} overdue={row.overdue} /></span> : null]}
          />
        ))}
      </ul>
    </>
  );
}

export function TransmittalRegister({ items, showProject = false }: { items: TransmittalRowDTO[]; showProject?: boolean }) {
  if (!items.length) return <EmptyState icon={<Send />} title="No transmittals yet." description="A transmittal records a formal issue of documents — to a contractor, from one, or internally." />;
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell scope="col">Transmittal</TableHeaderCell>
              <TableHeaderCell scope="col">Subject</TableHeaderCell>
              {showProject ? <TableHeaderCell scope="col">Project</TableHeaderCell> : null}
              <TableHeaderCell scope="col">Direction</TableHeaderCell>
              <TableHeaderCell scope="col">Purpose</TableHeaderCell>
              <TableHeaderCell scope="col">Contractor</TableHeaderCell>
              <TableHeaderCell scope="col" className="text-right">
                Documents
              </TableHeaderCell>
              <TableHeaderCell scope="col">Issued</TableHeaderCell>
              <TableHeaderCell scope="col">Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((row) => (
              <TableRow key={row.id} data-testid="transmittal-row">
                <TableCell className={numberCell}>
                  <Link href={row.href} className="hover:underline">
                    {row.transmittalNumber}
                  </Link>
                </TableCell>
                <TableCell className="min-w-[12rem]">
                  <Link href={row.href} className="text-fg hover:underline">
                    {row.subject ?? <span className="text-fg-subtle">No subject</span>}
                  </Link>
                </TableCell>
                {showProject ? <TableCell className="text-fg-muted">{row.projectName}</TableCell> : null}
                <TableCell className="text-fg-muted">{TRANSMITTAL_DIRECTION_LABELS[row.direction]}</TableCell>
                <TableCell className="whitespace-nowrap text-fg-muted">{TRANSMITTAL_PURPOSE_LABELS[row.purpose]}</TableCell>
                <TableCell className="max-w-[14rem]">
                  <div className="truncate" title={row.contractor?.label}>
                    <Ref value={row.contractor} />
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.itemCount}</TableCell>
                <TableCell>
                  <Due date={row.issuedAt} emptyLabel="Not issued" />
                </TableCell>
                <TableCell>
                  <ReviewBadge status={row.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="space-y-2 md:hidden">
        {items.map((row) => (
          <MobileCard key={row.id} testId="transmittal-card" href={row.href} number={row.transmittalNumber} title={row.subject ?? TRANSMITTAL_PURPOSE_LABELS[row.purpose]} status={<ReviewBadge status={row.status} />} lines={[<span key="d">{TRANSMITTAL_DIRECTION_LABELS[row.direction]}</span>, <span key="n">{row.itemCount} documents</span>]} />
        ))}
      </ul>
    </>
  );
}
