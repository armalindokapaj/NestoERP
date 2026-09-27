import Link from "@/components/navigation/nav-link";
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
import { EngineeringLabel, EngineeringText, type EngineeringKey } from "./engineering-text";

const T = ({ k, values }: { k: EngineeringKey; values?: Record<string, string | number> }) => <EngineeringText k={k} values={values} />;

/**
 * The engineering registers (PRD #46 §77, §166-§169, §314, §317). A clean data
 * table with a sticky header on a desk; on a phone each row becomes a card
 * with the number, the status and what is late. Every row opens the record.
 */

/*
 * AUD-04 §5 (D-09-05, MW-05): a card carries what its table row says — the
 * project on a cross-project register, contractor, revision, priority, age or
 * issue date — so a phone reader can tell rows apart. Long numbers and titles
 * break instead of widening the card.
 */
function MobileCard({ href, number, title, status, lines, testId }: { href: string; number: React.ReactNode; title: React.ReactNode; status: React.ReactNode; lines: Array<React.ReactNode>; testId: string }) {
  return (
    <li>
      <Link href={href} className="block rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong" data-testid={testId}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-meta text-fg-muted [overflow-wrap:anywhere]">{number}</p>
            <p className="mt-0.5 text-body font-medium text-fg [overflow-wrap:anywhere]">{title}</p>
          </div>
          <div className="shrink-0">{status}</div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-table text-fg-muted">{lines}</div>
      </Link>
    </li>
  );
}

const numberCell = "whitespace-nowrap font-mono text-table text-fg";

export function RfiRegister({ items, showProject = false, showAssignee = true, emptyTitle = <T k="registers.noRfis" /> }: { items: RfiRowDTO[]; showProject?: boolean; showAssignee?: boolean; emptyTitle?: React.ReactNode }) {
  if (!items.length) return <EmptyState icon={<MessageSquareText />} title={emptyTitle} description={<T k="registers.rfisEmptyBody" />} />;
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell scope="col"><T k="columns.rfi" /></TableHeaderCell>
              <TableHeaderCell scope="col"><T k="columns.subject" /></TableHeaderCell>
              {showProject ? <TableHeaderCell scope="col"><T k="columns.project" /></TableHeaderCell> : null}
              <TableHeaderCell scope="col"><T k="columns.contractor" /></TableHeaderCell>
              {showAssignee ? <TableHeaderCell scope="col"><T k="columns.assignee" /></TableHeaderCell> : null}
              <TableHeaderCell scope="col"><T k="columns.status" /></TableHeaderCell>
              <TableHeaderCell scope="col"><T k="columns.due" /></TableHeaderCell>
              <TableHeaderCell scope="col" className="text-right">
                <T k="columns.age" />
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
                  <ReviewBadge status={row.overdue ? "OVERDUE" : row.status} label={row.overdue ? <T k="ui.overdue" /> : undefined} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Due date={row.dueAt} overdue={row.overdue} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums text-fg-muted"><T k="ui.days" values={{ count: row.ageDays }} /></TableCell>
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
            status={<ReviewBadge status={row.overdue ? "OVERDUE" : row.status} label={row.overdue ? <T k="ui.overdue" /> : undefined} />}
            lines={[showProject ? <span key="p">{row.projectName}</span> : null, row.priority === "HIGH" || row.priority === "CRITICAL" ? <PriorityMark key="pr" priority={row.priority} /> : null, row.assignee ? <span key="a">{row.assignee.name}</span> : null, row.dueAt ? <span key="d"><T k="ui.due" /> <Due date={row.dueAt} overdue={row.overdue} /></span> : null, row.contractor ? <span key="c">{row.contractor.label}</span> : null, <span key="g" className="tabular-nums"><T k="ui.daysOld" values={{ count: row.ageDays }} /></span>]}
          />
        ))}
      </ul>
    </>
  );
}

export function SubmittalRegister({ items, showProject = false, emptyTitle = <T k="registers.noSubmittals" /> }: { items: SubmittalRowDTO[]; showProject?: boolean; emptyTitle?: React.ReactNode }) {
  if (!items.length) return <EmptyState icon={<FileStack />} title={emptyTitle} description={<T k="registers.submittalsEmptyBody" />} />;
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell scope="col"><T k="columns.submittal" /></TableHeaderCell>
              <TableHeaderCell scope="col"><T k="columns.title" /></TableHeaderCell>
              <TableHeaderCell scope="col"><T k="columns.type" /></TableHeaderCell>
              {showProject ? <TableHeaderCell scope="col"><T k="columns.project" /></TableHeaderCell> : null}
              <TableHeaderCell scope="col"><T k="columns.contractor" /></TableHeaderCell>
              <TableHeaderCell scope="col"><T k="columns.revision" /></TableHeaderCell>
              <TableHeaderCell scope="col"><T k="columns.reviewer" /></TableHeaderCell>
              <TableHeaderCell scope="col"><T k="columns.status" /></TableHeaderCell>
              <TableHeaderCell scope="col"><T k="columns.due" /></TableHeaderCell>
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
                <TableCell className="whitespace-nowrap text-fg-muted"><EngineeringLabel group="submittalType" value={row.submittalType} fallback={SUBMITTAL_TYPE_LABELS[row.submittalType]} /></TableCell>
                {showProject ? <TableCell className="text-fg-muted">{row.projectName}</TableCell> : null}
                <TableCell className="max-w-[14rem]">
                  <div className="truncate" title={row.contractor?.label}>
                    <Ref value={row.contractor} />
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-table">{row.currentRevision ? <T k="ui.rev" values={{ code: row.currentRevision.code }} /> : <span className="text-fg-subtle">—</span>}</TableCell>
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
            number={<>{row.submittalNumber}{row.currentRevision ? <> · <T k="ui.rev" values={{ code: row.currentRevision.code }} /></> : null}</>}
            title={row.title}
            status={<ReviewBadge status={row.status} />}
            lines={[showProject ? <span key="p">{row.projectName}</span> : null, <span key="t"><EngineeringLabel group="submittalType" value={row.submittalType} fallback={SUBMITTAL_TYPE_LABELS[row.submittalType]} /></span>, row.currentRevision ? <span key="v" className="font-mono"><T k="ui.rev" values={{ code: row.currentRevision.code }} /></span> : null, row.contractor ? <span key="c">{row.contractor.label}</span> : null, row.reviewer ? <span key="r">{row.reviewer.name}</span> : null, row.dueAt ? <span key="d"><T k="ui.due" /> <Due date={row.dueAt} overdue={row.overdue} /></span> : null]}
          />
        ))}
      </ul>
    </>
  );
}

export function DocumentRegister({ items, drawings = false, showProject = false, emptyTitle }: { items: EngineeringDocumentRowDTO[]; drawings?: boolean; showProject?: boolean; emptyTitle?: React.ReactNode }) {
  if (!items.length) return <EmptyState icon={<DraftingCompass />} title={emptyTitle ?? (drawings ? <T k="registers.noDrawings" /> : <T k="registers.noDocuments" />)} description={<T k="registers.documentsEmptyBody" />} />;
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell scope="col">{drawings ? <T k="columns.drawingNo" /> : <T k="columns.documentNo" />}</TableHeaderCell>
              <TableHeaderCell scope="col"><T k="columns.title" /></TableHeaderCell>
              {drawings ? null : <TableHeaderCell scope="col"><T k="columns.type" /></TableHeaderCell>}
              <TableHeaderCell scope="col"><T k="columns.discipline" /></TableHeaderCell>
              {showProject ? <TableHeaderCell scope="col"><T k="columns.project" /></TableHeaderCell> : null}
              <TableHeaderCell scope="col"><T k="columns.contractor" /></TableHeaderCell>
              <TableHeaderCell scope="col"><T k="columns.revision" /></TableHeaderCell>
              <TableHeaderCell scope="col"><T k="columns.status" /></TableHeaderCell>
              <TableHeaderCell scope="col"><T k="columns.reviewDue" /></TableHeaderCell>
              <TableHeaderCell scope="col"><T k="columns.reviewer" /></TableHeaderCell>
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
                {drawings ? null : <TableCell className="whitespace-nowrap text-fg-muted"><EngineeringLabel group="documentType" value={row.documentType} fallback={DOCUMENT_TYPE_LABELS[row.documentType]} /></TableCell>}
                <TableCell className="whitespace-nowrap text-fg-muted"><EngineeringLabel group="discipline" value={row.discipline} fallback={DISCIPLINE_LABELS[row.discipline]} /></TableCell>
                {showProject ? <TableCell className="text-fg-muted">{row.projectName}</TableCell> : null}
                <TableCell className="max-w-[14rem]">
                  <div className="truncate" title={row.contractor?.label}>
                    <Ref value={row.contractor} />
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-table" data-testid="document-current-revision">
                  {row.currentRevision ? <T k="ui.rev" values={{ code: row.currentRevision.code }} /> : <span className="text-fg-subtle">—</span>}
                  {row.revisionCount > 1 ? <span className="ml-1.5 font-sans text-meta text-fg-subtle"><T k="ui.ofCount" values={{ count: row.revisionCount }} /></span> : null}
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
            number={<>{row.documentNumber}{row.currentRevision ? <> · <T k="ui.rev" values={{ code: row.currentRevision.code }} /></> : null}</>}
            title={row.title}
            status={<ReviewBadge status={row.status} />}
            lines={[showProject ? <span key="p">{row.projectName}</span> : null, <span key="d"><EngineeringLabel group="discipline" value={row.discipline} fallback={DISCIPLINE_LABELS[row.discipline]} /></span>, row.currentRevision ? <span key="v" className="font-mono"><T k="ui.rev" values={{ code: row.currentRevision.code }} /></span> : null, row.contractor ? <span key="c">{row.contractor.label}</span> : null, row.reviewer ? <span key="w"><T k="ui.reviewer" /> {row.reviewer.name}</span> : null, row.reviewDueAt ? <span key="r"><T k="ui.review" /> <Due date={row.reviewDueAt} overdue={row.overdue} /></span> : null]}
          />
        ))}
      </ul>
    </>
  );
}

export function TransmittalRegister({ items, showProject = false }: { items: TransmittalRowDTO[]; showProject?: boolean }) {
  if (!items.length) return <EmptyState icon={<Send />} title={<T k="registers.noTransmittals" />} description={<T k="registers.transmittalsEmptyBody" />} />;
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell scope="col"><T k="columns.transmittal" /></TableHeaderCell>
              <TableHeaderCell scope="col"><T k="columns.subject" /></TableHeaderCell>
              {showProject ? <TableHeaderCell scope="col"><T k="columns.project" /></TableHeaderCell> : null}
              <TableHeaderCell scope="col"><T k="columns.direction" /></TableHeaderCell>
              <TableHeaderCell scope="col"><T k="columns.purpose" /></TableHeaderCell>
              <TableHeaderCell scope="col"><T k="columns.contractor" /></TableHeaderCell>
              <TableHeaderCell scope="col" className="text-right">
                <T k="columns.documents" />
              </TableHeaderCell>
              <TableHeaderCell scope="col"><T k="columns.issued" /></TableHeaderCell>
              <TableHeaderCell scope="col"><T k="columns.status" /></TableHeaderCell>
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
                    {row.subject ?? <span className="text-fg-subtle"><T k="ui.noSubject" /></span>}
                  </Link>
                </TableCell>
                {showProject ? <TableCell className="text-fg-muted">{row.projectName}</TableCell> : null}
                <TableCell className="text-fg-muted"><EngineeringLabel group="direction" value={row.direction} fallback={TRANSMITTAL_DIRECTION_LABELS[row.direction]} /></TableCell>
                <TableCell className="whitespace-nowrap text-fg-muted"><EngineeringLabel group="purpose" value={row.purpose} fallback={TRANSMITTAL_PURPOSE_LABELS[row.purpose]} /></TableCell>
                <TableCell className="max-w-[14rem]">
                  <div className="truncate" title={row.contractor?.label}>
                    <Ref value={row.contractor} />
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.itemCount}</TableCell>
                <TableCell>
                  <Due date={row.issuedAt} emptyLabel={<T k="ui.notIssued" />} />
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
          <MobileCard key={row.id} testId="transmittal-card" href={row.href} number={row.transmittalNumber} title={row.subject ?? <EngineeringLabel group="purpose" value={row.purpose} fallback={TRANSMITTAL_PURPOSE_LABELS[row.purpose]} />} status={<ReviewBadge status={row.status} />} lines={[showProject ? <span key="p">{row.projectName}</span> : null, <span key="d"><EngineeringLabel group="direction" value={row.direction} fallback={TRANSMITTAL_DIRECTION_LABELS[row.direction]} /></span>, <span key="n"><T k="ui.documentsCount" values={{ count: row.itemCount }} /></span>, row.contractor ? <span key="c">{row.contractor.label}</span> : null, <span key="i">{row.issuedAt ? <><T k="ui.issued" /> <Due date={row.issuedAt} /></> : <T k="ui.notIssued" />}</span>]} />
        ))}
      </ul>
    </>
  );
}
