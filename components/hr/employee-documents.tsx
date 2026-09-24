"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { FileText, MoreHorizontal, Paperclip, ShieldCheck } from "lucide-react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, ReasonDialog, useCommand, type FormField, type FormValues } from "@/components/engineering/form-kit";
import { selectClass } from "@/components/forms/record-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { PersonLink } from "@/components/people/person-link";
import {
  CATEGORY_RULES,
  VERIFICATION_LABELS,
  VISIBILITY_LABELS,
  type CredentialVerificationStatus,
  type DocumentGroup,
  type EmployeeDocumentCategory,
  type EmployeeDocumentDTO,
  type EmployeeDocumentsDTO,
  type UnfiledDocumentDTO,
} from "@/lib/modules/hr/documents/employee-document.types";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/format";
import { fileSize, uploadNewVersion, uploadToEmployment } from "./employee-file-upload";

/**
 * An employee's documents (E-02 §94-§99, §217-§223): the same list on the
 * person's profile and on HR's record.
 *
 * Everything shown came from the server already narrowed to this reader —
 * categories, counts, rows and actions (§98): nothing here hides a row or
 * decides a permission. Files go through the Documents pipeline and are filed
 * with what they are; a renewal is a new file, a correction a new version.
 */

const VERIFICATION_TONE: Record<CredentialVerificationStatus, "success" | "warning" | "danger" | "default" | "info"> = {
  VERIFIED: "success",
  UNVERIFIED: "info",
  REJECTED: "danger",
  EXPIRED: "warning",
  SUPERSEDED: "default",
};

type Status = "current" | "historical" | "all";

function date(value: string | null): string {
  return value ? formatDate(value) : "—";
}

export function VerificationBadge({ status, verifiable = true }: { status: CredentialVerificationStatus; verifiable?: boolean }) {
  if (!verifiable && status === "UNVERIFIED") return null;
  return (
    <Badge tone={VERIFICATION_TONE[status]} data-testid="verification">
      {status === "VERIFIED" ? <ShieldCheck className="size-3" aria-hidden="true" /> : null}
      {VERIFICATION_LABELS[status]}
    </Badge>
  );
}

function ExpiryText({ row }: { row: Pick<EmployeeDocumentDTO, "expiryDate" | "expiry" | "daysToExpiry" | "isCurrent"> }) {
  if (!row.expiryDate) return <span className="text-fg-subtle">—</span>;
  const tone = !row.isCurrent ? "text-fg-muted" : row.expiry === "EXPIRED" ? "text-danger-strong" : row.expiry === "EXPIRING" ? "text-warning-strong" : "text-fg";
  return (
    <span className={cn("whitespace-nowrap", tone)}>
      {formatDate(row.expiryDate)}
      {row.isCurrent && row.expiry === "EXPIRING" ? <span className="block text-meta">in {row.daysToExpiry} days</span> : null}
      {row.isCurrent && row.expiry === "EXPIRED" ? <span className="block text-meta">expired</span> : null}
    </span>
  );
}

function StateBadge({ row }: { row: EmployeeDocumentDTO }) {
  if (row.archived) return <Badge tone="default">Archived</Badge>;
  if (!row.isCurrent) return <Badge tone="default">Historical</Badge>;
  return <Badge tone="neutral">Current</Badge>;
}

/* -------------------------------------------------------------------------- */
/* The list                                                                    */
/* -------------------------------------------------------------------------- */

export function EmployeeDocuments({ data, heading = true, focusId }: { data: EmployeeDocumentsDTO; heading?: boolean; focusId?: string }) {
  const [group, setGroup] = React.useState<DocumentGroup | "ALL">("ALL");
  const [status, setStatus] = React.useState<Status>("current");
  const [verification, setVerification] = React.useState<CredentialVerificationStatus | "ALL">("ALL");
  const [query, setQuery] = React.useState("");
  // A worklist links to one document: it opens, whatever the filters show (§153, §154).
  const [selected, setSelected] = React.useState<EmployeeDocumentDTO | null>(() => (focusId ? (data.documents.find((row) => row.id === focusId) ?? null) : null));
  const [adding, setAdding] = React.useState<AddRequest | null>(null);

  const canAdd = data.capabilities.open && data.capabilities.addable.length > 0;
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = data.documents.filter((row) => {
    if (group !== "ALL" && row.group !== group) return false;
    if (status === "current" && (!row.isCurrent || row.archived)) return false;
    if (status === "historical" && row.isCurrent && !row.archived) return false;
    if (verification !== "ALL" && row.verificationStatus !== verification) return false;
    const haystack = `${row.title} ${row.categoryLabel} ${row.issuer ?? ""} ${row.documentNumber ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  const summaries = data.summaries.filter((row) => group === "ALL" || row.group === group);
  const groups = data.groups.filter((entry) => entry.count > 0);
  const contracts = data.documents.filter((row) => row.category === "EMPLOYMENT_CONTRACT" && !row.archived).map((row) => ({ value: row.id, label: row.title }));
  // The drawer follows the row, so an action taken in it shows its outcome there.
  const current = selected ? (data.documents.find((row) => row.id === selected.id) ?? selected) : null;

  const nothing = data.documents.length === 0 && data.summaries.length === 0 && data.unfiled.length === 0;

  return (
    <section className="space-y-4" aria-labelledby={heading ? "employee-documents-heading" : undefined} data-testid="employee-documents">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {heading ? (
          <div>
            <h2 id="employee-documents-heading" className="text-card font-semibold text-fg">
              Documents
            </h2>
            <p className="mt-0.5 text-meta text-fg-subtle">{data.isSelf ? "Your documents as your employer keeps them. What HR keeps to itself is not listed." : "Only the documents you may open are listed."}</p>
          </div>
        ) : (
          <span />
        )}
        {canAdd ? (
          <Button size="sm" onClick={() => setAdding({})} data-testid="add-employee-document">
            <Paperclip aria-hidden="true" />
            Add document
          </Button>
        ) : null}
      </div>

      {nothing ? (
        <EmptyState icon={<FileText />} title="No documents available to you" description={canAdd ? "Contracts, certificates, licences and a CV filed for this employee appear here." : "Documents you may open appear here."} />
      ) : (
        <>
          {groups.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" role="group" aria-label="Categories">
              {groups.map((entry) => (
                <button
                  key={entry.group}
                  type="button"
                  onClick={() => setGroup(group === entry.group ? "ALL" : entry.group)}
                  aria-pressed={group === entry.group}
                  data-testid="document-group"
                  data-group={entry.group}
                  className={cn("nesto-card flex flex-col items-start gap-0.5 p-3 text-left transition-colors hover:border-line-strong", group === entry.group && "border-accent ring-1 ring-accent")}
                >
                  <span className="text-meta font-medium text-fg-muted">{entry.label}</span>
                  <span className="text-card font-semibold tabular-nums text-fg">{entry.count}</span>
                  <span className="flex flex-wrap gap-1">
                    {entry.expiring > 0 ? <Badge tone="warning">{entry.expiring} expiring</Badge> : null}
                    {entry.unverified > 0 ? <Badge tone="info">{entry.unverified} to verify</Badge> : null}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {data.documents.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2" role="search">
              {/* On a phone the search takes its own row, and the two choices share the next. */}
              <label className="flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:max-w-xs sm:flex-1">
                <span className="text-meta font-medium text-fg-muted">Search</span>
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, issuer, number" aria-label="Search documents" />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
                <span className="text-meta font-medium text-fg-muted">Show</span>
                <select className={selectClass} value={status} onChange={(event) => setStatus(event.target.value as Status)} aria-label="Current or historical">
                  <option value="current">Current</option>
                  <option value="historical">Historical and archived</option>
                  <option value="all">All</option>
                </select>
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
                <span className="text-meta font-medium text-fg-muted">Verification</span>
                <select className={selectClass} value={verification} onChange={(event) => setVerification(event.target.value as CredentialVerificationStatus | "ALL")} aria-label="Verification">
                  <option value="ALL">Any</option>
                  {(Object.keys(VERIFICATION_LABELS) as CredentialVerificationStatus[]).map((key) => (
                    <option key={key} value={key}>
                      {VERIFICATION_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          {data.documents.length > 0 && rows.length === 0 ? <p className="nesto-card p-4 text-table text-fg-muted">No documents match. Clear a filter to see more.</p> : null}

          {rows.length > 0 ? (
            <>
              <div className="nesto-card hidden p-0 md:block">
                <Table aria-label="Documents">
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Title</TableHeaderCell>
                      <TableHeaderCell>Category</TableHeaderCell>
                      <TableHeaderCell>Issuer</TableHeaderCell>
                      <TableHeaderCell>Issued</TableHeaderCell>
                      <TableHeaderCell>Expires</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell>Verification</TableHeaderCell>
                      <TableHeaderCell>
                        <span className="sr-only">Actions</span>
                      </TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id} data-testid="employee-document" data-category={row.category}>
                        <TableCell className="max-w-[18rem]">
                          <button type="button" className="text-left font-medium text-fg hover:text-accent-strong hover:underline" onClick={() => setSelected(row)}>
                            {row.title}
                          </button>
                          {row.newFileSinceVerification ? <span className="block text-meta text-warning-strong">New file since it was verified</span> : null}
                        </TableCell>
                        <TableCell>{row.categoryLabel}</TableCell>
                        <TableCell>{row.issuer ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{date(row.issueDate)}</TableCell>
                        <TableCell>
                          <ExpiryText row={row} />
                        </TableCell>
                        <TableCell>
                          <StateBadge row={row} />
                        </TableCell>
                        <TableCell>
                          <VerificationBadge status={row.verificationStatus} verifiable={row.verifiable} />
                        </TableCell>
                        <TableCell className="text-right">
                          <DocumentActions row={row} contracts={contracts} onOpen={() => setSelected(row)} onRenew={() => setAdding({ replaces: row })} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <ul className="space-y-2 md:hidden" aria-label="Documents">
                {rows.map((row) => (
                  <li key={row.id} className="nesto-card flex items-start justify-between gap-3 p-3" data-testid="employee-document-card">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelected(row)}>
                      <span className="block truncate font-medium text-fg">{row.title}</span>
                      <span className="block text-meta text-fg-muted">
                        {row.categoryLabel}
                        {row.issuer ? ` · ${row.issuer}` : ""}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-meta">
                        <StateBadge row={row} />
                        <VerificationBadge status={row.verificationStatus} verifiable={row.verifiable} />
                        {row.expiryDate ? <ExpiryText row={row} /> : null}
                      </span>
                    </button>
                    <DocumentActions row={row} contracts={contracts} onOpen={() => setSelected(row)} onRenew={() => setAdding({ replaces: row })} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {summaries.length > 0 ? (
            <section className="space-y-2" aria-labelledby="shared-documents-heading" data-testid="document-summaries">
              <h3 id="shared-documents-heading" className="text-table font-semibold text-fg">
                Shared with colleagues
              </h3>
              <ul className="nesto-card divide-y divide-line p-0">
                {summaries.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-table" data-testid="document-summary">
                    <span className="min-w-0">
                      <span className="font-medium text-fg">{row.title}</span>
                      <span className="text-fg-muted">
                        {" · "}
                        {row.categoryLabel}
                        {row.issuer ? ` · ${row.issuer}` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 text-meta text-fg-muted">
                      {row.expiryDate ? `Expires ${formatDate(row.expiryDate)}` : null}
                      <VerificationBadge status="VERIFIED" />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {data.unfiled.length > 0 ? <UnfiledFiles files={data.unfiled} canFile={canAdd} onFile={(file) => setAdding({ unfiled: file })} /> : null}
        </>
      )}

      <DocumentDrawer row={current} onOpenChange={(open) => !open && setSelected(null)} contracts={contracts} onRenew={(row) => setAdding({ replaces: row })} />
      <AddDocumentDialog request={adding} onClose={() => setAdding(null)} data={data} contracts={contracts} />
    </section>
  );
}

function UnfiledFiles({ files, canFile, onFile }: { files: UnfiledDocumentDTO[]; canFile: boolean; onFile: (file: UnfiledDocumentDTO) => void }) {
  return (
    <section className="space-y-2" aria-labelledby="unfiled-heading" data-testid="unfiled-documents">
      <h3 id="unfiled-heading" className="text-table font-semibold text-fg">
        Not filed yet
      </h3>
      <p className="text-meta text-fg-subtle">Uploaded to this record without saying what they are. Until they are filed only HR and whoever uploaded them can see them.</p>
      <ul className="nesto-card divide-y divide-line p-0">
        {files.map((file) => (
          <li key={file.documentId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-table" data-testid="unfiled-document">
            <span className="min-w-0">
              <Link href={file.href} className="font-medium text-fg hover:underline">
                {file.name}
              </Link>
              <span className="text-meta text-fg-subtle">
                {" · "}
                {fileSize(file.sizeBytes)} · uploaded {formatDate(file.uploadedAt)}
              </span>
            </span>
            {canFile && file.storageStatus === "AVAILABLE" ? (
              <Button size="sm" variant="secondary" onClick={() => onFile(file)}>
                File it
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

function base(row: Pick<EmployeeDocumentDTO, "employeeId" | "id">) {
  return `/api/hr/employees/${row.employeeId}/documents/${row.id}`;
}

function DocumentActions({ row, contracts, onOpen, onRenew }: { row: EmployeeDocumentDTO; contracts: Array<{ value: string; label: string }>; onOpen?: () => void; onRenew: () => void }) {
  const { run } = useCommand();
  const [dialog, setDialog] = React.useState<"verify" | "reject" | "supersede" | "archive" | "edit" | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const { actions } = row;
  const openable = row.file.storageStatus === "AVAILABLE";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" aria-label={`Actions for ${row.title}`} data-testid="employee-document-actions">
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onOpen ? <DropdownMenuItem onSelect={onOpen}>Details</DropdownMenuItem> : null}
          {openable ? (
            <DropdownMenuItem asChild>
              <a href={`/api/documents/${row.file.documentId}/download`} download>
                Download
              </a>
            </DropdownMenuItem>
          ) : null}
          {actions.canVerify || actions.canReject || actions.canResubmit ? <DropdownMenuSeparator /> : null}
          {actions.canVerify ? <DropdownMenuItem onSelect={() => setDialog("verify")}>Verify</DropdownMenuItem> : null}
          {actions.canReject ? <DropdownMenuItem onSelect={() => setDialog("reject")}>Reject</DropdownMenuItem> : null}
          {actions.canResubmit ? (
            <DropdownMenuItem onSelect={() => void run("resubmit", () => engineeringApi(`${base(row)}/resubmit`, { body: { expectedVersion: versionOf(row) } }), "Sent back for verification.")}>Resubmit</DropdownMenuItem>
          ) : null}
          {actions.canEdit || actions.canReplaceFile || actions.canRenew || actions.canSupersede || actions.canArchive ? <DropdownMenuSeparator /> : null}
          {actions.canEdit ? <DropdownMenuItem onSelect={() => setDialog("edit")}>Edit details</DropdownMenuItem> : null}
          {actions.canReplaceFile ? <DropdownMenuItem onSelect={() => fileInput.current?.click()}>Replace file (new version)</DropdownMenuItem> : null}
          {actions.canRenew ? <DropdownMenuItem onSelect={onRenew}>Renew</DropdownMenuItem> : null}
          {actions.canSupersede ? <DropdownMenuItem onSelect={() => setDialog("supersede")}>No longer current…</DropdownMenuItem> : null}
          {actions.canArchive ? <DropdownMenuItem onSelect={() => setDialog("archive")}>Archive…</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        aria-label={`New version of ${row.title}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void run("version", () => uploadNewVersion(row.file.documentId, file), "New version uploaded. It counts once it has been checked.");
        }}
      />

      <FormDialog
        open={dialog === "verify"}
        onOpenChange={(open) => setDialog(open ? "verify" : null)}
        title={`Verify ${row.title}`}
        description="Check the file, the issuer, the number and the dates against the original. You cannot verify your own."
        fields={[{ name: "note", label: "Note", type: "textarea", rows: 2, placeholder: "For example: checked against the register" }]}
        submitLabel="Verify"
        testId="verify-document-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`${base(row)}/verify`, { body: { ...payload, expectedVersion: versionOf(row) } });
          await run("verify", async () => null, "Verified.");
        }}
      />
      <ReasonDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        title={`Reject ${row.title}`}
        description="The employee reads this reason and can resubmit with a corrected file."
        confirmLabel="Reject"
        onConfirm={async (payload) => {
          await engineeringApi(`${base(row)}/reject`, { body: { ...payload, expectedVersion: versionOf(row) } });
          await run("reject", async () => null, "Rejected.");
        }}
      />
      <ReasonDialog
        open={dialog === "supersede"}
        onOpenChange={(open) => setDialog(open ? "supersede" : null)}
        title={`${row.title} no longer applies`}
        description="It stays on file as history, marked superseded. Nothing is deleted."
        confirmLabel="Mark superseded"
        required={false}
        extraFields={[{ name: "replacementId", label: "Replaced by", type: "select", emptyLabel: "Nothing on file", options: (row.category === "EMPLOYMENT_CONTRACT" ? contracts : []).filter((option) => option.value !== row.id), wide: true }]}
        onConfirm={async (payload) => {
          await engineeringApi(`${base(row)}/supersede`, { body: { ...payload, expectedVersion: versionOf(row) } });
          await run("supersede", async () => null, "Marked superseded.");
        }}
      />
      <ReasonDialog
        open={dialog === "archive"}
        onOpenChange={(open) => setDialog(open ? "archive" : null)}
        title={`Archive ${row.title}`}
        description="It leaves the employee's file. HR keeps it, with its history, among archived documents."
        confirmLabel="Archive"
        destructive
        onConfirm={async (payload) => {
          await engineeringApi(`${base(row)}/archive`, { body: { ...payload, expectedVersion: versionOf(row) } });
          await run("archive", async () => null, "Archived.");
        }}
      />
      <EditDocumentDialog row={row} open={dialog === "edit"} onOpenChange={(open) => setDialog(open ? "edit" : null)} />
    </>
  );
}

/** The version the page was rendered from, for the server's guard: a stale page is told, not obeyed (§192). */
function versionOf(row: EmployeeDocumentDTO): number {
  return row.version;
}

/* -------------------------------------------------------------------------- */
/* The drawer (§218-§220)                                                      */
/* -------------------------------------------------------------------------- */

function DocumentDrawer({ row, onOpenChange, contracts, onRenew }: { row: EmployeeDocumentDTO | null; onOpenChange: (open: boolean) => void; contracts: Array<{ value: string; label: string }>; onRenew: (row: EmployeeDocumentDTO) => void }) {
  return (
    <Drawer open={row !== null} onOpenChange={onOpenChange}>
      <DrawerContent side="right" className="p-5" data-testid="employee-document-drawer">
        {row ? (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <DrawerTitle className="text-card font-semibold text-fg">{row.title}</DrawerTitle>
                <DrawerDescription className="text-meta text-fg-muted">{row.categoryLabel}</DrawerDescription>
              </div>
              <DocumentActions row={row} contracts={contracts} onRenew={() => onRenew(row)} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <StateBadge row={row} />
              <VerificationBadge status={row.verificationStatus} verifiable={row.verifiable} />
            </div>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-table">
              <dt className="text-fg-muted">Issuer</dt>
              <dd>{row.issuer ?? "—"}</dd>
              <dt className="text-fg-muted">Number</dt>
              <dd>{row.documentNumber ?? "—"}</dd>
              <dt className="text-fg-muted">Issued</dt>
              <dd>{date(row.issueDate)}</dd>
              <dt className="text-fg-muted">Expires</dt>
              <dd>
                <ExpiryText row={row} />
              </dd>
              {row.effectiveFrom || row.effectiveTo ? (
                <>
                  <dt className="text-fg-muted">In effect</dt>
                  <dd>
                    {date(row.effectiveFrom)} – {row.effectiveTo ? date(row.effectiveTo) : "open"}
                  </dd>
                </>
              ) : null}
              <dt className="text-fg-muted">Who may see it</dt>
              <dd>{VISIBILITY_LABELS[row.visibility]}</dd>
              <dt className="text-fg-muted">Filed by</dt>
              <dd>
                {row.createdBy ? <PersonLink memberId={row.createdByMemberId} name={row.createdBy} /> : "—"} · {formatDate(row.createdAt)}
              </dd>
              {row.verifiable ? (
                <>
                  <dt className="text-fg-muted">Verification</dt>
                  <dd>
                    {VERIFICATION_LABELS[row.verificationStatus]}
                    {row.verifiedBy ? <> by <PersonLink memberId={row.verifiedByMemberId} name={row.verifiedBy} /></> : null}
                    {row.verifiedAt ? `, ${formatDate(row.verifiedAt)}` : ""}
                    {row.verificationNote ? <span className="block text-meta text-fg-muted">“{row.verificationNote}”</span> : null}
                    {row.newFileSinceVerification ? <span className="block text-meta text-warning-strong">A new file was uploaded after it was verified.</span> : null}
                  </dd>
                </>
              ) : null}
              {row.archived ? (
                <>
                  <dt className="text-fg-muted">Archived</dt>
                  <dd>{row.archiveReason ?? "—"}</dd>
                </>
              ) : null}
            </dl>

            {row.amends || row.supersedes || row.supersededBy ? (
              <section aria-labelledby="document-history-heading" className="space-y-1.5 text-table">
                <h3 id="document-history-heading" className="font-semibold text-fg">
                  History
                </h3>
                {row.amends ? <p>Amends {row.amends.title}</p> : null}
                {row.supersedes ? <p>Replaces {row.supersedes.title}</p> : null}
                {row.supersededBy ? <p>Replaced by {row.supersededBy.title}</p> : null}
              </section>
            ) : null}

            <section aria-labelledby="document-file-heading" className="space-y-1.5 text-table">
              <h3 id="document-file-heading" className="font-semibold text-fg">
                File
              </h3>
              <p className="text-fg-muted">
                {row.file.fileName}
                {row.file.versionNumber ? ` · version ${row.file.versionNumber}` : ""} · {fileSize(row.file.sizeBytes)}
              </p>
              {row.file.storageStatus === "AVAILABLE" ? (
                <p className="flex flex-wrap gap-3">
                  <a href={`/api/documents/${row.file.documentId}/download`} download className="font-medium text-accent-strong hover:underline">
                    Download
                  </a>
                  <Link href={row.file.href} className="font-medium text-accent-strong hover:underline">
                    Versions and activity
                  </Link>
                </p>
              ) : (
                <p className="text-warning-strong">File temporarily unavailable.</p>
              )}
            </section>
          </div>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */
/* Adding and editing                                                          */
/* -------------------------------------------------------------------------- */

type AddRequest = { replaces?: EmployeeDocumentDTO; unfiled?: UnfiledDocumentDTO };

function metadataFields(category: EmployeeDocumentCategory | "", visibilities: string[], contracts: Array<{ value: string; label: string }>, withCategory: Array<{ value: string; label: string }> | null): FormField[] {
  const rule = category ? CATEGORY_RULES[category] : null;
  const dated = rule ? rule.class === "EMPLOYMENT" || rule.class === "COMPENSATION" : false;
  return [
    ...(withCategory ? [{ name: "category", label: "What it is", type: "select" as const, required: true, emptyLabel: "Choose…", options: withCategory, wide: true }] : []),
    { name: "title", label: "Title", type: "text", placeholder: rule ? `For example ${rule.label}` : "What HR calls it", wide: true },
    { name: "issuer", label: "Issued by", type: "text" },
    { name: "documentNumber", label: "Number", type: "text" },
    { name: "issueDate", label: "Issued on", type: "date" },
    { name: "expiryDate", label: rule?.expiryExpected ? "Expires on" : "Expires on (if it does)", type: "date" },
    ...(dated
      ? [
          { name: "effectiveFrom", label: "In effect from", type: "date" as const },
          { name: "effectiveTo", label: "In effect until", type: "date" as const },
        ]
      : []),
    ...(category === "CONTRACT_AMENDMENT" ? [{ name: "amendsId", label: "Amends", type: "select" as const, emptyLabel: "Choose the contract…", options: contracts, wide: true }] : []),
    { name: "visibility", label: "Who may see it", type: "select", emptyLabel: rule ? `Default: ${VISIBILITY_LABELS[rule.defaultVisibility]}` : "Default for this kind of document", options: visibilities.map((value) => ({ value, label: VISIBILITY_LABELS[value as keyof typeof VISIBILITY_LABELS] })), wide: true },
  ];
}

function AddDocumentDialog({ request, onClose, data, contracts }: { request: AddRequest | null; onClose: () => void; data: EmployeeDocumentsDTO; contracts: Array<{ value: string; label: string }> }) {
  const { run } = useCommand();
  const [file, setFile] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const fixed = request?.replaces?.category ?? null;
  const [category, setCategory] = React.useState<EmployeeDocumentCategory | "">(fixed ?? "");
  React.useEffect(() => {
    setCategory(request?.replaces?.category ?? "");
    setFile(null);
    setFileError(null);
  }, [request]);

  const addable = data.capabilities.addable;
  const entry = addable.find((row) => row.category === (fixed ?? category));
  const options = addable.map((row) => ({ value: row.category, label: `${CATEGORY_RULES[row.category].label}` }));
  const fields = metadataFields(fixed ?? category, entry?.visibilities ?? [], contracts, fixed ? null : options);
  const renewing = request?.replaces;
  const needsFile = !request?.unfiled;

  return (
    <FormDialog
      open={request !== null}
      onOpenChange={(open) => !open && onClose()}
      title={renewing ? `Renew ${renewing.title}` : request?.unfiled ? `File ${request.unfiled.name}` : "Add a document"}
      description={renewing ? "The new document becomes current. The one it renews stays on file, marked superseded." : "The file is kept once, on this employee's record. Say what it is and who may see it."}
      fields={fields}
      initial={renewing ? { title: renewing.title, issuer: renewing.issuer ?? "", documentNumber: "", category: renewing.category } : { title: request?.unfiled ? request.unfiled.name.replace(/\.[A-Za-z0-9]{1,6}$/, "") : "" }}
      submitLabel={renewing ? "Renew" : request?.unfiled ? "File it" : "Add document"}
      testId="add-employee-document-dialog"
      wide
      onValuesChange={(values: FormValues) => {
        if (!fixed && typeof values.category === "string") setCategory(values.category as EmployeeDocumentCategory | "");
      }}
      onSubmit={async (payload) => {
        const chosen = (fixed ?? payload.category) as EmployeeDocumentCategory | null;
        if (!chosen) throw { status: 400, code: "VALIDATION_ERROR", message: "Say what the document is.", details: { category: ["Say what the document is."] } };
        let documentId = request?.unfiled?.documentId ?? null;
        if (!documentId) {
          if (!file) {
            setFileError("Choose the file.");
            throw { status: 400, code: "VALIDATION_ERROR", message: "Choose the file.", details: {} };
          }
          documentId = await uploadToEmployment(data.employeeId, file, String(payload.title ?? "") || file.name);
        }
        const body = { ...payload, category: chosen, documentId, visibility: payload.visibility ?? undefined };
        const url = renewing ? `/api/hr/employees/${data.employeeId}/documents/${renewing.id}/renew` : `/api/hr/employees/${data.employeeId}/documents`;
        await engineeringApi(url, { body });
        await run("add", async () => null, renewing ? "Renewed. The earlier document is kept as history." : "Document filed.");
      }}
    >
      {needsFile ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="employee-document-file" className="text-meta font-medium text-fg-muted">
            File<span className="text-danger-strong"> *</span>
          </label>
          <input
            id="employee-document-file"
            type="file"
            data-testid="employee-document-file"
            className="text-table file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-muted file:px-3 file:py-1.5 file:text-table"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setFileError(null);
            }}
            aria-invalid={Boolean(fileError) || undefined}
          />
          {fileError ? <p className="text-meta text-danger-strong">{fileError}</p> : <p className="text-meta text-fg-subtle">PDF or an image. It is checked before it can be opened.</p>}
        </div>
      ) : null}
    </FormDialog>
  );
}

function EditDocumentDialog({ row, open, onOpenChange }: { row: EmployeeDocumentDTO; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { run } = useCommand();
  const visibilities = (CATEGORY_RULES[row.category].visibilities as string[]).filter((value) => value !== "PRIVATE_EMPLOYEE" || row.visibility === "PRIVATE_EMPLOYEE");
  const fields = metadataFields(row.category, visibilities, [], null).filter((field) => field.name !== "amendsId");
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${row.title}`}
      description="Corrects what it is and who may see it. Its verification is never changed here."
      fields={fields}
      initial={{ title: row.title, issuer: row.issuer, documentNumber: row.documentNumber, issueDate: row.issueDate, expiryDate: row.expiryDate, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, visibility: row.visibility }}
      submitLabel="Save"
      testId="edit-employee-document-dialog"
      wide
      onSubmit={async (payload) => {
        await engineeringApi(base(row), { method: "PATCH", body: { ...payload, visibility: payload.visibility ?? row.visibility, title: payload.title ?? row.title, expectedVersion: versionOf(row) } });
        await run("edit", async () => null, "Saved.");
      }}
    />
  );
}
