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
import { UnsavedValue } from "@/components/unsaved/unsaved-value";
import {
  CATEGORY_RULES,
  VERIFICATION_LABELS,
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
import { hrLabel, useHrTranslations } from "./hr-text";
import type { Translate } from "@/lib/i18n/translator";
import { FormSelect } from "@/components/ui/form-select";

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
  const t = useHrTranslations();
  if (!verifiable && status === "UNVERIFIED") return null;
  return (
    <Badge tone={VERIFICATION_TONE[status]} data-testid="verification">
      {status === "VERIFIED" ? <ShieldCheck className="size-3" aria-hidden="true" /> : null}
      {hrLabel(t, "verification", status)}
    </Badge>
  );
}

function ExpiryText({ row }: { row: Pick<EmployeeDocumentDTO, "expiryDate" | "expiry" | "daysToExpiry" | "isCurrent"> }) {
  const t = useHrTranslations();
  if (!row.expiryDate) return <span className="text-fg-subtle">—</span>;
  const tone = !row.isCurrent ? "text-fg-muted" : row.expiry === "EXPIRED" ? "text-danger-strong" : row.expiry === "EXPIRING" ? "text-warning-strong" : "text-fg";
  return (
    <span className={cn("whitespace-nowrap", tone)}>
      {formatDate(row.expiryDate)}
      {row.isCurrent && row.expiry === "EXPIRING" ? <span className="block text-meta">{t("worklist.inDays", { count: row.daysToExpiry ?? 0 })}</span> : null}
      {row.isCurrent && row.expiry === "EXPIRED" ? <span className="block text-meta">{t("employeeDocs.expired")}</span> : null}
    </span>
  );
}

function StateBadge({ row }: { row: EmployeeDocumentDTO }) {
  const t = useHrTranslations();
  if (row.archived) return <Badge tone="default">{t("employeeDocs.archived")}</Badge>;
  if (!row.isCurrent) return <Badge tone="default">{t("employeeDocs.historical")}</Badge>;
  return <Badge tone="neutral">{t("compensation.current")}</Badge>;
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
  const t = useHrTranslations();

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
              {t("tabs.documents")}
            </h2>
            <p className="mt-0.5 text-meta text-fg-subtle">{data.isSelf ? t("employeeDocs.selfNote") : t("employeeDocs.othersNote")}</p>
          </div>
        ) : (
          <span />
        )}
        {canAdd ? (
          <Button size="sm" onClick={() => setAdding({})} data-testid="add-employee-document">
            <Paperclip aria-hidden="true" />
            {t("employeeDocs.add")}
          </Button>
        ) : null}
      </div>

      {nothing ? (
        <EmptyState icon={<FileText />} title={t("employeeDocs.emptyTitle")} description={canAdd ? t("employeeDocs.emptyCanAdd") : t("employeeDocs.emptyOther")} />
      ) : (
        <>
          {groups.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" role="group" aria-label={t("employeeDocs.categories")}>
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
                    {entry.expiring > 0 ? <Badge tone="warning">{t("employeeDocs.expiring", { count: entry.expiring })}</Badge> : null}
                    {entry.unverified > 0 ? <Badge tone="info">{t("employeeDocs.toVerify", { count: entry.unverified })}</Badge> : null}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {data.documents.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2" role="search">
              {/* On a phone the search takes its own row, and the two choices share the next. */}
              <label className="flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:max-w-xs sm:flex-1">
                <span className="text-meta font-medium text-fg-muted">{t("employeeDocs.search")}</span>
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("employeeDocs.searchPlaceholder")} aria-label={t("employeeDocs.searchLabel")} />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
                <span className="text-meta font-medium text-fg-muted">{t("reports.show")}</span>
                <FormSelect className={selectClass} value={status} onChange={(event) => setStatus(event.target.value as Status)} aria-label={t("employeeDocs.currentOrHistorical")}>
                  <option value="current">{t("compensation.current")}</option>
                  <option value="historical">{t("employeeDocs.historicalArchived")}</option>
                  <option value="all">{t("recruitment.all")}</option>
                </FormSelect>
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
                <span className="text-meta font-medium text-fg-muted">{t("worklist.verification")}</span>
                <FormSelect className={selectClass} value={verification} onChange={(event) => setVerification(event.target.value as CredentialVerificationStatus | "ALL")} aria-label={t("worklist.verification")}>
                  <option value="ALL">{t("employeeDocs.any")}</option>
                  {(Object.keys(VERIFICATION_LABELS) as CredentialVerificationStatus[]).map((key) => (
                    <option key={key} value={key}>
                      {hrLabel(t, "verification", key)}
                    </option>
                  ))}
                </FormSelect>
              </label>
            </div>
          ) : null}

          {data.documents.length > 0 && rows.length === 0 ? <p className="nesto-card p-4 text-table text-fg-muted">{t("employeeDocs.noMatch")}</p> : null}

          {rows.length > 0 ? (
            <>
              <div className="nesto-card hidden p-0 md:block">
                <Table aria-label={t("tabs.documents")}>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>{t("employeeDocs.title")}</TableHeaderCell>
                      <TableHeaderCell>{t("columns.category")}</TableHeaderCell>
                      <TableHeaderCell>{t("worklist.issuer")}</TableHeaderCell>
                      <TableHeaderCell>{t("employeeDocs.issued")}</TableHeaderCell>
                      <TableHeaderCell>{t("worklist.expires")}</TableHeaderCell>
                      <TableHeaderCell>{t("columns.status")}</TableHeaderCell>
                      <TableHeaderCell>{t("worklist.verification")}</TableHeaderCell>
                      <TableHeaderCell>
                        <span className="sr-only">{t("employeeDocs.actions")}</span>
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
                          {row.newFileSinceVerification ? <span className="block text-meta text-warning-strong">{t("employeeDocs.newFileSince")}</span> : null}
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

              <ul className="space-y-2 md:hidden" aria-label={t("tabs.documents")}>
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
                {t("employeeDocs.shared")}
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
                      {row.expiryDate ? t("employeeDocs.expiresOn", { date: formatDate(row.expiryDate) }) : null}
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
  const t = useHrTranslations();
  return (
    <section className="space-y-2" aria-labelledby="unfiled-heading" data-testid="unfiled-documents">
      <h3 id="unfiled-heading" className="text-table font-semibold text-fg">
        {t("employeeDocs.notFiled")}
      </h3>
      <p className="text-meta text-fg-subtle">{t("employeeDocs.notFiledNote")}</p>
      <ul className="nesto-card divide-y divide-line p-0">
        {files.map((file) => (
          <li key={file.documentId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-table" data-testid="unfiled-document">
            <span className="min-w-0">
              <Link href={file.href} className="font-medium text-fg hover:underline">
                {file.name}
              </Link>
              <span className="text-meta text-fg-subtle">
                {" · "}
                {fileSize(file.sizeBytes)} · {t("employeeDocs.uploaded", { date: formatDate(file.uploadedAt) })}
              </span>
            </span>
            {canFile && file.storageStatus === "AVAILABLE" ? (
              <Button size="sm" variant="secondary" onClick={() => onFile(file)}>
                {t("employeeDocs.fileIt")}
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
  const t = useHrTranslations();
  const { run, pending } = useCommand();
  const [dialog, setDialog] = React.useState<"verify" | "reject" | "supersede" | "archive" | "edit" | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const { actions } = row;
  const openable = row.file.storageStatus === "AVAILABLE";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" aria-label={t("employeeDocs.actionsFor", { title: row.title })} data-testid="employee-document-actions">
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onOpen ? <DropdownMenuItem onSelect={onOpen}>{t("leave.details")}</DropdownMenuItem> : null}
          {openable ? (
            <DropdownMenuItem asChild>
              <a href={`/api/documents/${row.file.documentId}/download`} download>
                {t("employeeDocs.download")}
              </a>
            </DropdownMenuItem>
          ) : null}
          {actions.canVerify || actions.canReject || actions.canResubmit ? <DropdownMenuSeparator /> : null}
          {actions.canVerify ? <DropdownMenuItem onSelect={() => setDialog("verify")}>{t("employeeDocs.verify")}</DropdownMenuItem> : null}
          {actions.canReject ? <DropdownMenuItem onSelect={() => setDialog("reject")}>{t("leaveActions.reject")}</DropdownMenuItem> : null}
          {actions.canResubmit ? (
            <DropdownMenuItem onSelect={() => void run("resubmit", () => engineeringApi(`${base(row)}/resubmit`, { body: { expectedVersion: versionOf(row) } }), t("employeeDocs.resubmitted"))}>{t("employeeDocs.resubmit")}</DropdownMenuItem>
          ) : null}
          {actions.canEdit || actions.canReplaceFile || actions.canRenew || actions.canSupersede || actions.canArchive ? <DropdownMenuSeparator /> : null}
          {actions.canEdit ? <DropdownMenuItem onSelect={() => setDialog("edit")}>{t("meta.editDetails")}</DropdownMenuItem> : null}
          {actions.canReplaceFile ? <DropdownMenuItem onSelect={() => fileInput.current?.click()}>{t("employeeDocs.replaceFile")}</DropdownMenuItem> : null}
          {actions.canRenew ? <DropdownMenuItem onSelect={onRenew}>{t("employeeDocs.renew")}</DropdownMenuItem> : null}
          {actions.canSupersede ? <DropdownMenuItem onSelect={() => setDialog("supersede")}>{t("employeeDocs.noLongerCurrent")}</DropdownMenuItem> : null}
          {actions.canArchive ? <DropdownMenuItem onSelect={() => setDialog("archive")}>{t("employeeDocs.archiveEllipsis")}</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        aria-label={t("employeeDocs.newVersionOf", { title: row.title })}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void run("version", () => uploadNewVersion(row.file.documentId, file), t("employeeDocs.versionUploaded"));
        }}
      />
      {/* A new version on its way up would be lost by leaving now (AUD-03 §3 files). */}
      {pending === "version" ? <UnsavedValue dirty={false} saving module="hr" saveKind="none" label={t("employeeDocs.newVersionOf", { title: row.title })} /> : null}

      <FormDialog
        open={dialog === "verify"}
        onOpenChange={(open) => setDialog(open ? "verify" : null)}
        title={t("employeeDocs.verifyTitle", { title: row.title })}
        description={t("employeeDocs.verifyDescription")}
        fields={[{ name: "note", label: t("candidate.note"), type: "textarea", rows: 2, placeholder: t("employeeDocs.verifyPlaceholder") }]}
        submitLabel={t("employeeDocs.verify")}
        module="hr"
        testId="verify-document-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`${base(row)}/verify`, { body: { ...payload, expectedVersion: versionOf(row) } });
          await run("verify", async () => null, t("employeeDocs.verified"));
        }}
      />
      <ReasonDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        title={t("employeeDocs.rejectTitle", { title: row.title })}
        description={t("employeeDocs.rejectDescription")}
        confirmLabel={t("leaveActions.reject")}
        onConfirm={async (payload) => {
          await engineeringApi(`${base(row)}/reject`, { body: { ...payload, expectedVersion: versionOf(row) } });
          await run("reject", async () => null, t("employeeDocs.rejected"));
        }}
      />
      <ReasonDialog
        open={dialog === "supersede"}
        onOpenChange={(open) => setDialog(open ? "supersede" : null)}
        title={t("employeeDocs.supersedeTitle", { title: row.title })}
        description={t("employeeDocs.supersedeDescription")}
        confirmLabel={t("employeeDocs.markSuperseded")}
        required={false}
        extraFields={[{ name: "replacementId", label: t("employeeDocs.replacedByLabel"), type: "select", emptyLabel: t("employeeDocs.nothingOnFile"), options: (row.category === "EMPLOYMENT_CONTRACT" ? contracts : []).filter((option) => option.value !== row.id), wide: true }]}
        onConfirm={async (payload) => {
          await engineeringApi(`${base(row)}/supersede`, { body: { ...payload, expectedVersion: versionOf(row) } });
          await run("supersede", async () => null, t("employeeDocs.superseded"));
        }}
      />
      <ReasonDialog
        open={dialog === "archive"}
        onOpenChange={(open) => setDialog(open ? "archive" : null)}
        title={t("employeeDocs.archiveTitle", { title: row.title })}
        description={t("employeeDocs.archiveDescription")}
        confirmLabel={t("employeeDocs.archive")}
        destructive
        onConfirm={async (payload) => {
          await engineeringApi(`${base(row)}/archive`, { body: { ...payload, expectedVersion: versionOf(row) } });
          await run("archive", async () => null, t("employeeDocs.archivedDone"));
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
  const t = useHrTranslations();
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
            {/* Both columns may shrink and long numbers break, so the drawer never widens at 320px (AUD-04 §3, D-07-10, MW-01). */}
            <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-table [overflow-wrap:anywhere]">
              <dt className="text-fg-muted">{t("worklist.issuer")}</dt>
              <dd>{row.issuer ?? "—"}</dd>
              <dt className="text-fg-muted">{t("employeeDocs.number")}</dt>
              <dd>{row.documentNumber ?? "—"}</dd>
              <dt className="text-fg-muted">{t("employeeDocs.issued")}</dt>
              <dd>{date(row.issueDate)}</dd>
              <dt className="text-fg-muted">{t("worklist.expires")}</dt>
              <dd>
                <ExpiryText row={row} />
              </dd>
              {row.effectiveFrom || row.effectiveTo ? (
                <>
                  <dt className="text-fg-muted">{t("employeeDocs.inEffect")}</dt>
                  <dd>
                    {date(row.effectiveFrom)} – {row.effectiveTo ? date(row.effectiveTo) : t("compensation.open")}
                  </dd>
                </>
              ) : null}
              <dt className="text-fg-muted">{t("employeeDocs.whoMaySee")}</dt>
              <dd>{hrLabel(t, "visibility", row.visibility)}</dd>
              <dt className="text-fg-muted">{t("employeeDocs.filedBy")}</dt>
              <dd>
                {row.createdBy ? <PersonLink memberId={row.createdByMemberId} name={row.createdBy} /> : "—"} · {formatDate(row.createdAt)}
              </dd>
              {row.verifiable ? (
                <>
                  <dt className="text-fg-muted">{t("worklist.verification")}</dt>
                  <dd>
                    {hrLabel(t, "verification", row.verificationStatus)}
                    {row.verifiedBy ? <> {t("employeeDocs.by")} <PersonLink memberId={row.verifiedByMemberId} name={row.verifiedBy} /></> : null}
                    {row.verifiedAt ? `, ${formatDate(row.verifiedAt)}` : ""}
                    {row.verificationNote ? <span className="block text-meta text-fg-muted">“{row.verificationNote}”</span> : null}
                    {row.newFileSinceVerification ? <span className="block text-meta text-warning-strong">{t("employeeDocs.newFileAfter")}</span> : null}
                  </dd>
                </>
              ) : null}
              {row.archived ? (
                <>
                  <dt className="text-fg-muted">{t("employeeDocs.archived")}</dt>
                  <dd>{row.archiveReason ?? "—"}</dd>
                </>
              ) : null}
            </dl>

            {row.amends || row.supersedes || row.supersededBy ? (
              <section aria-labelledby="document-history-heading" className="space-y-1.5 text-table">
                <h3 id="document-history-heading" className="font-semibold text-fg">
                  {t("tabs.history")}
                </h3>
                {row.amends ? <p>{t("employeeDocs.amends", { title: row.amends.title })}</p> : null}
                {row.supersedes ? <p>{t("employeeDocs.replaces", { title: row.supersedes.title })}</p> : null}
                {row.supersededBy ? <p>{t("employeeDocs.replacedBy", { title: row.supersededBy.title })}</p> : null}
              </section>
            ) : null}

            <section aria-labelledby="document-file-heading" className="space-y-1.5 text-table">
              <h3 id="document-file-heading" className="font-semibold text-fg">
                {t("employeeDocs.file")}
              </h3>
              <p className="text-fg-muted">
                {row.file.fileName}
                {row.file.versionNumber ? t("employeeDocs.version", { number: row.file.versionNumber }) : ""} · {fileSize(row.file.sizeBytes)}
              </p>
              {row.file.storageStatus === "AVAILABLE" ? (
                <p className="flex flex-wrap gap-3">
                  <a href={`/api/documents/${row.file.documentId}/download`} download className="font-medium text-accent-strong hover:underline">
                    {t("employeeDocs.download")}
                  </a>
                  <Link href={row.file.href} className="font-medium text-accent-strong hover:underline">
                    {t("employeeDocs.versions")}
                  </Link>
                </p>
              ) : (
                <p className="text-warning-strong">{t("employeeDocs.unavailable")}</p>
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

function metadataFields(t: Translate<"hr">, category: EmployeeDocumentCategory | "", visibilities: string[], contracts: Array<{ value: string; label: string }>, withCategory: Array<{ value: string; label: string }> | null): FormField[] {
  const rule = category ? CATEGORY_RULES[category] : null;
  const dated = rule ? rule.class === "EMPLOYMENT" || rule.class === "COMPENSATION" : false;
  return [
    ...(withCategory ? [{ name: "category", label: t("employeeDocs.whatItIs"), type: "select" as const, required: true, emptyLabel: t("changes.choose"), options: withCategory, wide: true }] : []),
    { name: "title", label: t("employeeDocs.title"), type: "text", placeholder: rule ? t("employeeDocs.forExample", { label: rule.label }) : t("employeeDocs.whatHrCallsIt"), wide: true },
    { name: "issuer", label: t("employeeDocs.issuedBy"), type: "text" },
    { name: "documentNumber", label: t("employeeDocs.number"), type: "text" },
    { name: "issueDate", label: t("employeeDocs.issuedOn"), type: "date" },
    { name: "expiryDate", label: rule?.expiryExpected ? t("employeeDocs.expiresOnLabel") : t("employeeDocs.expiresIfItDoes"), type: "date" },
    ...(dated
      ? [
          { name: "effectiveFrom", label: t("employeeDocs.inEffectFrom"), type: "date" as const },
          { name: "effectiveTo", label: t("employeeDocs.inEffectUntil"), type: "date" as const },
        ]
      : []),
    ...(category === "CONTRACT_AMENDMENT" ? [{ name: "amendsId", label: t("employeeDocs.amendsLabel"), type: "select" as const, emptyLabel: t("employeeDocs.chooseContract"), options: contracts, wide: true }] : []),
    { name: "visibility", label: t("employeeDocs.whoMaySee"), type: "select", emptyLabel: rule ? t("employeeDocs.defaultVisibility", { label: hrLabel(t, "visibility", rule.defaultVisibility) }) : t("employeeDocs.defaultForKind"), options: visibilities.map((value) => ({ value, label: hrLabel(t, "visibility", value) })), wide: true },
  ];
}

function AddDocumentDialog({ request, onClose, data, contracts }: { request: AddRequest | null; onClose: () => void; data: EmployeeDocumentsDTO; contracts: Array<{ value: string; label: string }> }) {
  const t = useHrTranslations();
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
  const fields = metadataFields(t, fixed ?? category, entry?.visibilities ?? [], contracts, fixed ? null : options);
  const renewing = request?.replaces;
  const needsFile = !request?.unfiled;

  return (
    <FormDialog
      open={request !== null}
      onOpenChange={(open) => !open && onClose()}
      title={renewing ? t("employeeDocs.renewTitle", { title: renewing.title }) : request?.unfiled ? t("employeeDocs.fileTitle", { name: request.unfiled.name }) : t("employeeDocs.addTitle")}
      description={renewing ? t("employeeDocs.renewDescription") : t("employeeDocs.addDescription")}
      fields={fields}
      initial={renewing ? { title: renewing.title, issuer: renewing.issuer ?? "", documentNumber: "", category: renewing.category } : { title: request?.unfiled ? request.unfiled.name.replace(/\.[A-Za-z0-9]{1,6}$/, "") : "" }}
      submitLabel={renewing ? t("employeeDocs.renew") : request?.unfiled ? t("employeeDocs.fileIt") : t("employeeDocs.add")}
      saveKind="create"
      module="hr"
      testId="add-employee-document-dialog"
      wide
      onValuesChange={(values: FormValues) => {
        if (!fixed && typeof values.category === "string") setCategory(values.category as EmployeeDocumentCategory | "");
      }}
      onSubmit={async (payload) => {
        const chosen = (fixed ?? payload.category) as EmployeeDocumentCategory | null;
        if (!chosen) throw { status: 400, code: "VALIDATION_ERROR", message: t("employeeDocs.sayWhat"), details: { category: [t("employeeDocs.sayWhat")] } };
        let documentId = request?.unfiled?.documentId ?? null;
        if (!documentId) {
          if (!file) {
            setFileError(t("employeeDocs.chooseFile"));
            throw { status: 400, code: "VALIDATION_ERROR", message: t("employeeDocs.chooseFile"), details: {} };
          }
          documentId = await uploadToEmployment(data.employeeId, file, String(payload.title ?? "") || file.name);
        }
        const body = { ...payload, category: chosen, documentId, visibility: payload.visibility ?? undefined };
        const url = renewing ? `/api/hr/employees/${data.employeeId}/documents/${renewing.id}/renew` : `/api/hr/employees/${data.employeeId}/documents`;
        await engineeringApi(url, { body });
        await run("add", async () => null, renewing ? t("employeeDocs.renewed") : t("employeeDocs.filed"));
      }}
    >
      {needsFile ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="employee-document-file" className="text-meta font-medium text-fg-muted">
            {t("employeeDocs.file")}<span className="text-danger-strong"> *</span>
          </label>
          {/* Named, so a chosen file is part of what the dialog would lose (AUD-03 §3). */}
          <input
            id="employee-document-file"
            name="file"
            type="file"
            data-testid="employee-document-file"
            className="text-table file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-muted file:px-3 file:py-1.5 file:text-table"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setFileError(null);
            }}
            aria-invalid={Boolean(fileError) || undefined}
          />
          {fileError ? <p className="text-meta text-danger-strong">{fileError}</p> : <p className="text-meta text-fg-subtle">{t("employeeDocs.fileHint")}</p>}
        </div>
      ) : null}
    </FormDialog>
  );
}

function EditDocumentDialog({ row, open, onOpenChange }: { row: EmployeeDocumentDTO; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useHrTranslations();
  const { run } = useCommand();
  const visibilities = (CATEGORY_RULES[row.category].visibilities as string[]).filter((value) => value !== "PRIVATE_EMPLOYEE" || row.visibility === "PRIVATE_EMPLOYEE");
  const fields = metadataFields(t, row.category, visibilities, [], null).filter((field) => field.name !== "amendsId");
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("leave.editTitle", { label: row.title })}
      description={t("employeeDocs.editDescription")}
      fields={fields}
      initial={{ title: row.title, issuer: row.issuer, documentNumber: row.documentNumber, issueDate: row.issueDate, expiryDate: row.expiryDate, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, visibility: row.visibility }}
      submitLabel={t("candidate.save")}
      module="hr"
      testId="edit-employee-document-dialog"
      wide
      onSubmit={async (payload) => {
        await engineeringApi(base(row), { method: "PATCH", body: { ...payload, visibility: payload.visibility ?? row.visibility, title: payload.title ?? row.title, expectedVersion: versionOf(row) } });
        await run("edit", async () => null, t("server.saved"));
      }}
    />
  );
}
