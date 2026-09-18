"use client";

import * as React from "react";
import Link from "next/link";
import { Award, MoreHorizontal, Plus } from "lucide-react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, ReasonDialog, useCommand, type FormField, type FormValues } from "@/components/engineering/form-kit";
import { VerificationBadge } from "@/components/hr/employee-documents";
import { uploadToEmployment } from "@/components/hr/employee-file-upload";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import {
  PROFICIENCY_LABELS,
  QUALIFICATION_SECTIONS,
  QUALIFICATION_TYPE_RULES,
  QUALIFICATION_TYPES,
  QUALIFICATION_VISIBILITY_LABELS,
  type PersonQualificationsDTO,
  type QualificationDTO,
  type QualificationSummaryDTO,
  type QualificationType,
} from "@/lib/modules/hr/qualifications/qualification.types";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/format";

/**
 * Skills & qualifications (E-02 §100-§105, §221-§223).
 *
 * The person and HR see the full records the server gave them, with the
 * actions it allowed; colleagues see the verified summaries the person shares
 * with the group, and nothing about anything else (§98, §103). A supporting
 * file is uploaded onto the person's employment here and filed once; whether
 * it opens is the file's own rule, not the qualification's (§35, §104).
 */

type Section = (typeof QUALIFICATION_SECTIONS)[number]["key"];

function Expiry({ row }: { row: Pick<QualificationDTO, "expiryDate" | "expiry" | "daysToExpiry" | "isCurrent"> }) {
  if (!row.expiryDate) return null;
  const tone = !row.isCurrent ? "text-fg-muted" : row.expiry === "EXPIRED" ? "text-danger-strong" : row.expiry === "EXPIRING" ? "text-warning-strong" : "text-fg-muted";
  return (
    <span className={cn("text-meta", tone)}>
      {row.expiry === "EXPIRED" ? "Expired" : "Expires"} {formatDate(row.expiryDate)}
      {row.isCurrent && row.expiry === "EXPIRING" ? ` · in ${row.daysToExpiry} days` : ""}
    </span>
  );
}

export function PersonQualifications({ data, name }: { data: PersonQualificationsDTO; name: string }) {
  const [history, setHistory] = React.useState(false);
  const [adding, setAdding] = React.useState<{ renews?: QualificationDTO } | null>(null);
  const records = data.records ?? [];
  const shown = records.filter((row) => history || (row.isCurrent && !row.archived));
  const hiddenCount = records.length - shown.length;
  const empty = records.length === 0 && data.summaries.length === 0;

  return (
    <section className="space-y-4" aria-labelledby="qualifications-heading" data-testid="person-qualifications">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="qualifications-heading" className="text-card font-semibold text-fg">
            Skills & qualifications
          </h2>
          <p className="mt-0.5 text-meta text-fg-subtle">
            {data.records ? (data.isSelf ? "Yours across the group. Colleagues see only what you share once HR has verified it." : "As HR keeps them. Colleagues see only what is shared and verified.") : `What ${name} shares with the group, verified by HR.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hiddenCount > 0 || history ? (
            <Button size="sm" variant="ghost" onClick={() => setHistory(!history)} aria-pressed={history}>
              {history ? "Hide earlier" : `Show earlier and archived (${hiddenCount})`}
            </Button>
          ) : null}
          {data.capabilities.canAdd ? (
            <Button size="sm" onClick={() => setAdding({})} data-testid="add-qualification">
              <Plus aria-hidden="true" />
              {data.isSelf ? "Add qualification" : "Add"}
            </Button>
          ) : null}
        </div>
      </div>

      {empty ? (
        <EmptyState
          icon={<Award />}
          title={data.records ? "No qualifications added" : "No verified qualifications shared"}
          description={data.records ? "Skills, diplomas, licences and certificates appear here." : "Qualifications appear here once they are verified and shared with the group."}
        />
      ) : null}

      {data.records ? (
        QUALIFICATION_SECTIONS.map((section) => {
          const rows = shown.filter((row) => row.section === section.key);
          if (rows.length === 0) return null;
          return (
            <div key={section.key} className="space-y-2" data-testid="qualification-section" data-section={section.key}>
              <h3 className="text-table font-semibold text-fg">{section.label}</h3>
              <ul className="grid gap-2 lg:grid-cols-2">
                {rows.map((row) => (
                  <QualificationCard key={row.id} row={row} data={data} onRenew={() => setAdding({ renews: row })} />
                ))}
              </ul>
            </div>
          );
        })
      ) : null}

      {data.summaries.length > 0 ? <Summaries rows={data.summaries} shared={Boolean(data.records)} /> : null}

      <QualificationDialog request={adding} onClose={() => setAdding(null)} data={data} />
    </section>
  );
}

function Summaries({ rows, shared }: { rows: QualificationSummaryDTO[]; shared: boolean }) {
  const bySection = (key: Section) => rows.filter((row) => row.section === key);
  return (
    <div className="space-y-3" data-testid="qualification-summaries">
      {shared ? <h3 className="text-table font-semibold text-fg">Shared with the group</h3> : null}
      {QUALIFICATION_SECTIONS.map((section) =>
        bySection(section.key).length === 0 ? null : (
          <div key={section.key} className="space-y-1.5">
            {shared ? null : <h3 className="text-table font-semibold text-fg">{section.label}</h3>}
            <ul className="grid gap-2 lg:grid-cols-2">
              {bySection(section.key).map((row) => (
                <li key={row.id} className="nesto-card flex items-start justify-between gap-3 p-3" data-testid="qualification-summary">
                  <span className="min-w-0">
                    <span className="block font-medium text-fg">{row.title}</span>
                    <span className="block text-meta text-fg-muted">
                      {row.typeLabel}
                      {row.issuer ? ` · ${row.issuer}` : ""}
                      {row.proficiency ? ` · ${PROFICIENCY_LABELS[row.proficiency]}` : ""}
                    </span>
                    {row.expiryDate ? <span className="block text-meta text-fg-subtle">Expires {formatDate(row.expiryDate)}</span> : null}
                  </span>
                  <VerificationBadge status="VERIFIED" />
                </li>
              ))}
            </ul>
          </div>
        ),
      )}
    </div>
  );
}

function QualificationCard({ row, data, onRenew }: { row: QualificationDTO; data: PersonQualificationsDTO; onRenew: () => void }) {
  const { run } = useCommand();
  const [dialog, setDialog] = React.useState<"verify" | "reject" | "archive" | "edit" | "resubmit" | null>(null);
  const url = `/api/people/${row.personId}/qualifications/${row.id}`;
  const { actions } = row;
  const anyAction = actions.canEdit || actions.canVerify || actions.canReject || actions.canResubmit || actions.canRenew || actions.canArchive;

  return (
    <li id={`qualification-${row.id}`} className="nesto-card scroll-mt-24 space-y-2 p-3 target:border-accent target:ring-1 target:ring-accent" data-testid="qualification" data-type={row.type}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-fg">{row.title}</p>
          <p className="text-meta text-fg-muted">
            {row.typeLabel}
            {row.issuer ? ` · ${row.issuer}` : ""}
            {row.proficiency ? ` · ${PROFICIENCY_LABELS[row.proficiency]}` : ""}
          </p>
        </div>
        {anyAction ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label={`Actions for ${row.title}`} data-testid="qualification-actions">
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {actions.canVerify ? <DropdownMenuItem onSelect={() => setDialog("verify")}>Verify</DropdownMenuItem> : null}
              {actions.canReject ? <DropdownMenuItem onSelect={() => setDialog("reject")}>Reject</DropdownMenuItem> : null}
              {actions.canResubmit ? <DropdownMenuItem onSelect={() => setDialog("resubmit")}>Resubmit</DropdownMenuItem> : null}
              {(actions.canVerify || actions.canReject || actions.canResubmit) && (actions.canEdit || actions.canRenew || actions.canArchive) ? <DropdownMenuSeparator /> : null}
              {actions.canEdit ? <DropdownMenuItem onSelect={() => setDialog("edit")}>Edit</DropdownMenuItem> : null}
              {actions.canRenew ? <DropdownMenuItem onSelect={onRenew}>Renew</DropdownMenuItem> : null}
              {actions.canArchive ? <DropdownMenuItem onSelect={() => setDialog("archive")}>Archive…</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <VerificationBadge status={row.verificationStatus} />
        {row.archived ? <Badge>Archived</Badge> : !row.isCurrent ? <Badge>Historical</Badge> : null}
        <Badge tone="default">{QUALIFICATION_VISIBILITY_LABELS[row.visibility]}</Badge>
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-meta text-fg-muted">
        {row.issueDate ? <span>Issued {formatDate(row.issueDate)}</span> : null}
        <Expiry row={row} />
        {row.documentNumber ? <span>No. {row.documentNumber}</span> : null}
      </p>
      {row.verificationStatus === "REJECTED" && row.verificationNote ? <p className="text-meta text-danger-strong">Not accepted: {row.verificationNote}</p> : null}
      {row.verifiedBy && row.verificationStatus !== "REJECTED" ? (
        <p className="text-meta text-fg-subtle">
          Verified by {row.verifiedBy}
          {row.verifiedAt ? `, ${formatDate(row.verifiedAt)}` : ""}
          {row.newFileSinceVerification ? <span className="text-warning-strong"> · a new file since</span> : null}
        </p>
      ) : null}
      {row.supersededBy ? <p className="text-meta text-fg-subtle">Renewed by {row.supersededBy.title}</p> : null}
      {row.file ? (
        row.file.openable && row.file.href ? (
          <p className="text-meta">
            <Link href={row.file.href} className="font-medium text-accent-strong hover:underline">
              {row.file.fileName}
            </Link>
          </p>
        ) : (
          <p className="text-meta text-fg-subtle">Supporting file kept by {row.file.companyName}</p>
        )
      ) : null}

      <FormDialog
        open={dialog === "verify"}
        onOpenChange={(open) => setDialog(open ? "verify" : null)}
        title={`Verify ${row.title}`}
        description="Check the file, the issuer, the number and the dates. Nobody verifies their own."
        fields={[{ name: "note", label: "Note", type: "textarea", rows: 2 }]}
        submitLabel="Verify"
        testId="verify-qualification-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`${url}/verify`, { body: { ...payload, expectedVersion: row.version } });
          await run("verify", async () => null, "Verified.");
        }}
      />
      <ReasonDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        title={`Reject ${row.title}`}
        description="The person reads this reason and can resubmit."
        confirmLabel="Reject"
        onConfirm={async (payload) => {
          await engineeringApi(`${url}/reject`, { body: { ...payload, expectedVersion: row.version } });
          await run("reject", async () => null, "Rejected.");
        }}
      />
      <ReasonDialog
        open={dialog === "archive"}
        onOpenChange={(open) => setDialog(open ? "archive" : null)}
        title={`Archive ${row.title}`}
        description="It leaves the profile; its history stays."
        confirmLabel="Archive"
        onConfirm={async (payload) => {
          await engineeringApi(`${url}/archive`, { body: { ...payload, expectedVersion: row.version } });
          await run("archive", async () => null, "Archived.");
        }}
      />
      <ResubmitDialog open={dialog === "resubmit"} onOpenChange={(open) => setDialog(open ? "resubmit" : null)} row={row} employmentId={data.capabilities.fileEmploymentId} />
      <QualificationDialog request={dialog === "edit" ? { edits: row } : null} onClose={() => setDialog(null)} data={data} />
    </li>
  );
}

function FileInput({ onChange }: { onChange: (file: File | null) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="qualification-file" className="text-meta font-medium text-fg-muted">
        Supporting file
      </label>
      <input id="qualification-file" type="file" data-testid="qualification-file" className="text-table file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-muted file:px-3 file:py-1.5 file:text-table" onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
      <p className="text-meta text-fg-subtle">Kept on the employee file, seen by you and HR. Sharing the qualification never shares the file.</p>
    </div>
  );
}

function ResubmitDialog({ open, onOpenChange, row, employmentId }: { open: boolean; onOpenChange: (open: boolean) => void; row: QualificationDTO; employmentId: string | null }) {
  const { run } = useCommand();
  const [file, setFile] = React.useState<File | null>(null);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Resubmit ${row.title}`}
      description="Back to HR for verification. Add the corrected file if that was the reason."
      fields={[{ name: "note", label: "Note for HR", type: "textarea", rows: 2 }]}
      submitLabel="Resubmit"
      onSubmit={async (payload) => {
        const documentId = file && employmentId ? await uploadToEmployment(employmentId, file, `${row.title} — ${file.name}`) : undefined;
        await engineeringApi(`/api/people/${row.personId}/qualifications/${row.id}/resubmit`, { body: { ...payload, documentId, expectedVersion: row.version } });
        await run("resubmit", async () => null, "Sent back for verification.");
      }}
    >
      {employmentId ? <FileInput onChange={setFile} /> : null}
    </FormDialog>
  );
}

function QualificationDialog({ request, onClose, data }: { request: { renews?: QualificationDTO; edits?: QualificationDTO } | null; onClose: () => void; data: PersonQualificationsDTO }) {
  const { run } = useCommand();
  const [file, setFile] = React.useState<File | null>(null);
  const base = request?.edits ?? request?.renews ?? null;
  const [type, setType] = React.useState<QualificationType | "">(base?.type ?? "");
  React.useEffect(() => {
    setType(request?.edits?.type ?? request?.renews?.type ?? "");
    setFile(null);
  }, [request]);

  const rule = type ? QUALIFICATION_TYPE_RULES[type] : null;
  const fields: FormField[] = [
    ...(request?.renews ? [] : [{ name: "type", label: "What it is", type: "select" as const, required: true, emptyLabel: "Choose…", options: QUALIFICATION_TYPES.map((key) => ({ value: key, label: QUALIFICATION_TYPE_RULES[key].label })) }]),
    { name: "title", label: "Title", type: "text", required: true, placeholder: rule?.hasProficiency ? "For example AutoCAD" : "For example Professional Engineer Licence", wide: !request?.renews ? false : true },
    ...(rule?.hasProficiency ? [{ name: "proficiency", label: "Level", type: "select" as const, emptyLabel: "—", options: Object.entries(PROFICIENCY_LABELS).map(([value, label]) => ({ value, label })) }] : []),
    // A skill is held, not issued (§14): no issuer, number or dates to ask for.
    ...(type === "SKILL"
      ? []
      : [
          { name: "issuer", label: "Issued by", type: "text" as const },
          { name: "documentNumber", label: "Number", type: "text" as const },
          { name: "issueDate", label: "Issued on", type: "date" as const },
          { name: "expiryDate", label: rule?.expiryExpected ? "Expires on" : "Expires on (if it does)", type: "date" as const },
        ]),
    { name: "visibility", label: "Who may see it", type: "select", required: true, options: (base && !data.capabilities.visibilities.includes(base.visibility) ? [base.visibility, ...data.capabilities.visibilities] : data.capabilities.visibilities).map((value) => ({ value, label: QUALIFICATION_VISIBILITY_LABELS[value] })), wide: true },
  ];
  const edits = request?.edits;
  const renews = request?.renews;

  return (
    <FormDialog
      open={request !== null}
      onOpenChange={(open) => !open && onClose()}
      title={edits ? `Edit ${edits.title}` : renews ? `Renew ${renews.title}` : "Add a qualification"}
      description={renews ? "The renewed one becomes current and is verified afresh; the earlier one stays as history." : edits ? "Corrects it. Its verification is never changed here." : data.isSelf ? "HR verifies it before colleagues can see it." : "Recorded for this person; verification is separate."}
      fields={fields}
      initial={base ? { type: base.type, title: base.title, issuer: base.issuer, documentNumber: edits ? base.documentNumber : "", issueDate: edits ? base.issueDate : "", expiryDate: edits ? base.expiryDate : "", proficiency: base.proficiency, visibility: base.visibility } : { visibility: "EMPLOYEE_AND_HR" }}
      submitLabel={edits ? "Save" : renews ? "Renew" : "Add"}
      testId="qualification-dialog"
      wide
      onValuesChange={(values: FormValues) => {
        if (typeof values.type === "string") setType(values.type as QualificationType | "");
      }}
      onSubmit={async (payload) => {
        const documentId = file && data.capabilities.fileEmploymentId ? await uploadToEmployment(data.capabilities.fileEmploymentId, file, `${String(payload.title ?? "Qualification")} — ${file.name}`) : undefined;
        const body = { ...payload, ...(renews ? { type: renews.type } : {}), ...(documentId ? { documentId } : {}) };
        if (edits) await engineeringApi(`/api/people/${data.personId}/qualifications/${edits.id}`, { method: "PATCH", body: { ...body, expectedVersion: edits.version } });
        else if (renews) await engineeringApi(`/api/people/${data.personId}/qualifications/${renews.id}/renew`, { body });
        else await engineeringApi(`/api/people/${data.personId}/qualifications`, { body });
        await run("qualification", async () => null, edits ? "Saved." : renews ? "Renewed. The earlier one is kept as history." : "Added. HR verifies it before colleagues see it.");
      }}
    >
      {data.capabilities.fileEmploymentId && !edits?.file ? <FileInput onChange={setFile} /> : null}
    </FormDialog>
  );
}
