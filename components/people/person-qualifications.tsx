"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { Award, MoreHorizontal, Plus } from "lucide-react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, ReasonDialog, useCommand, type FormField, type FormValues } from "@/components/engineering/form-kit";
import { VerificationBadge } from "@/components/hr/employee-documents";
import { uploadToEmployment } from "@/components/hr/employee-file-upload";
import { usePeopleTranslations } from "@/components/people/people-text";
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
import { peopleLabel } from "@/lib/i18n/modules/people/labels";

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
  const t = usePeopleTranslations();
  if (!row.expiryDate) return null;
  const tone = !row.isCurrent ? "text-fg-muted" : row.expiry === "EXPIRED" ? "text-danger-strong" : row.expiry === "EXPIRING" ? "text-warning-strong" : "text-fg-muted";
  return (
    <span className={cn("text-meta", tone)}>
      {row.expiry === "EXPIRED" ? t("qualifications.expired") : t("qualifications.expires")} {formatDate(row.expiryDate)}
      {row.isCurrent && row.expiry === "EXPIRING" ? t("qualifications.inDays", { count: row.daysToExpiry ?? 0 }) : ""}
    </span>
  );
}

export function PersonQualifications({ data, name }: { data: PersonQualificationsDTO; name: string }) {
  const t = usePeopleTranslations();
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
            {t("qualifications.heading")}
          </h2>
          <p className="mt-0.5 text-meta text-fg-subtle">
            {data.records ? (data.isSelf ? t("qualifications.selfNote") : t("qualifications.hrNote")) : t("qualifications.sharedNote", { name })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hiddenCount > 0 || history ? (
            <Button size="sm" variant="ghost" onClick={() => setHistory(!history)} aria-pressed={history}>
              {history ? t("qualifications.hideEarlier") : t("qualifications.showEarlier", { count: hiddenCount })}
            </Button>
          ) : null}
          {data.capabilities.canAdd ? (
            <Button size="sm" onClick={() => setAdding({})} data-testid="add-qualification">
              <Plus aria-hidden="true" />
              {data.isSelf ? t("qualifications.addQualification") : t("qualifications.add")}
            </Button>
          ) : null}
        </div>
      </div>

      {empty ? (
        <EmptyState
          icon={<Award />}
          title={data.records ? t("qualifications.noneAdded") : t("qualifications.noneShared")}
          description={data.records ? t("qualifications.noneAddedDescription") : t("qualifications.noneSharedDescription")}
        />
      ) : null}

      {data.records ? (
        QUALIFICATION_SECTIONS.map((section) => {
          const rows = shown.filter((row) => row.section === section.key);
          if (rows.length === 0) return null;
          return (
            <div key={section.key} className="space-y-2" data-testid="qualification-section" data-section={section.key}>
              <h3 className="text-table font-semibold text-fg">{peopleLabel(t, "section", section.key, section.label)}</h3>
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
  const t = usePeopleTranslations();
  const bySection = (key: Section) => rows.filter((row) => row.section === key);
  return (
    <div className="space-y-3" data-testid="qualification-summaries">
      {shared ? <h3 className="text-table font-semibold text-fg">{t("qualifications.sharedWithGroup")}</h3> : null}
      {QUALIFICATION_SECTIONS.map((section) =>
        bySection(section.key).length === 0 ? null : (
          <div key={section.key} className="space-y-1.5">
            {shared ? null : <h3 className="text-table font-semibold text-fg">{peopleLabel(t, "section", section.key, section.label)}</h3>}
            <ul className="grid gap-2 lg:grid-cols-2">
              {bySection(section.key).map((row) => (
                <li key={row.id} className="nesto-card flex items-start justify-between gap-3 p-3" data-testid="qualification-summary">
                  <span className="min-w-0">
                    <span className="block font-medium text-fg">{row.title}</span>
                    <span className="block text-meta text-fg-muted">
                      {peopleLabel(t, "qualificationType", row.type, row.typeLabel)}
                      {row.issuer ? ` · ${row.issuer}` : ""}
                      {row.proficiency ? ` · ${peopleLabel(t, "proficiency", row.proficiency, PROFICIENCY_LABELS[row.proficiency])}` : ""}
                    </span>
                    {row.expiryDate ? <span className="block text-meta text-fg-subtle">{t("qualifications.expires")} {formatDate(row.expiryDate)}</span> : null}
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
  const t = usePeopleTranslations();
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
            {peopleLabel(t, "qualificationType", row.type, row.typeLabel)}
            {row.issuer ? ` · ${row.issuer}` : ""}
            {row.proficiency ? ` · ${peopleLabel(t, "proficiency", row.proficiency, PROFICIENCY_LABELS[row.proficiency])}` : ""}
          </p>
        </div>
        {anyAction ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label={t("qualifications.actionsFor", { title: row.title })} data-testid="qualification-actions">
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {actions.canVerify ? <DropdownMenuItem onSelect={() => setDialog("verify")}>{t("qualifications.verify")}</DropdownMenuItem> : null}
              {actions.canReject ? <DropdownMenuItem onSelect={() => setDialog("reject")}>{t("qualifications.reject")}</DropdownMenuItem> : null}
              {actions.canResubmit ? <DropdownMenuItem onSelect={() => setDialog("resubmit")}>{t("qualifications.resubmit")}</DropdownMenuItem> : null}
              {(actions.canVerify || actions.canReject || actions.canResubmit) && (actions.canEdit || actions.canRenew || actions.canArchive) ? <DropdownMenuSeparator /> : null}
              {actions.canEdit ? <DropdownMenuItem onSelect={() => setDialog("edit")}>{t("qualifications.edit")}</DropdownMenuItem> : null}
              {actions.canRenew ? <DropdownMenuItem onSelect={onRenew}>{t("qualifications.renew")}</DropdownMenuItem> : null}
              {actions.canArchive ? <DropdownMenuItem onSelect={() => setDialog("archive")}>{t("qualifications.archiveMenu")}</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <VerificationBadge status={row.verificationStatus} />
        {row.archived ? <Badge>{t("qualifications.archived")}</Badge> : !row.isCurrent ? <Badge>{t("qualifications.historical")}</Badge> : null}
        <Badge tone="default">{peopleLabel(t, "visibility", row.visibility, QUALIFICATION_VISIBILITY_LABELS[row.visibility])}</Badge>
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-meta text-fg-muted">
        {row.issueDate ? <span>{t("qualifications.issued", { date: formatDate(row.issueDate) })}</span> : null}
        <Expiry row={row} />
        {row.documentNumber ? <span>{t("qualifications.number", { number: row.documentNumber })}</span> : null}
      </p>
      {row.verificationStatus === "REJECTED" && row.verificationNote ? <p className="text-meta text-danger-strong">{t("qualifications.notAccepted", { note: row.verificationNote })}</p> : null}
      {row.verifiedBy && row.verificationStatus !== "REJECTED" ? (
        <p className="text-meta text-fg-subtle">
          {t("qualifications.verifiedBy", { name: row.verifiedBy })}
          {row.verifiedAt ? `, ${formatDate(row.verifiedAt)}` : ""}
          {row.newFileSinceVerification ? <span className="text-warning-strong">{t("qualifications.newFile")}</span> : null}
        </p>
      ) : null}
      {row.supersededBy ? <p className="text-meta text-fg-subtle">{t("qualifications.renewedBy", { title: row.supersededBy.title })}</p> : null}
      {row.file ? (
        row.file.openable && row.file.href ? (
          <p className="text-meta">
            <Link href={row.file.href} className="font-medium text-accent-strong hover:underline">
              {row.file.fileName}
            </Link>
          </p>
        ) : (
          <p className="text-meta text-fg-subtle">{t("qualifications.fileKeptBy", { company: row.file.companyName })}</p>
        )
      ) : null}

      <FormDialog
        open={dialog === "verify"}
        onOpenChange={(open) => setDialog(open ? "verify" : null)}
        title={t("qualifications.verifyTitle", { title: row.title })}
        description={t("qualifications.verifyDescription")}
        fields={[{ name: "note", label: t("qualifications.note"), type: "textarea", rows: 2 }]}
        submitLabel={t("qualifications.verify")}
        saveKind="none"
        module="people"
        testId="verify-qualification-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`${url}/verify`, { body: { ...payload, expectedVersion: row.version } });
          await run("verify", async () => null, t("qualifications.verified"));
        }}
      />
      <ReasonDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        title={t("qualifications.rejectTitle", { title: row.title })}
        description={t("qualifications.rejectDescription")}
        confirmLabel={t("qualifications.reject")}
        onConfirm={async (payload) => {
          await engineeringApi(`${url}/reject`, { body: { ...payload, expectedVersion: row.version } });
          await run("reject", async () => null, t("qualifications.rejected"));
        }}
      />
      <ReasonDialog
        open={dialog === "archive"}
        onOpenChange={(open) => setDialog(open ? "archive" : null)}
        title={t("qualifications.archiveTitle", { title: row.title })}
        description={t("qualifications.archiveDescription")}
        confirmLabel={t("qualifications.archive")}
        onConfirm={async (payload) => {
          await engineeringApi(`${url}/archive`, { body: { ...payload, expectedVersion: row.version } });
          await run("archive", async () => null, t("qualifications.archivedToast"));
        }}
      />
      <ResubmitDialog open={dialog === "resubmit"} onOpenChange={(open) => setDialog(open ? "resubmit" : null)} row={row} employmentId={data.capabilities.fileEmploymentId} />
      <QualificationDialog request={dialog === "edit" ? { edits: row } : null} onClose={() => setDialog(null)} data={data} />
    </li>
  );
}

function FileInput({ onChange }: { onChange: (file: File | null) => void }) {
  const t = usePeopleTranslations();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="qualification-file" className="text-meta font-medium text-fg-muted">
        {t("qualifications.supportingFile")}
      </label>
      {/* Named, so a chosen file is part of what the dialog would lose (AUD-03 §3). */}
      <input id="qualification-file" name="file" type="file" data-testid="qualification-file" className="text-table file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-muted file:px-3 file:py-1.5 file:text-table" onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
      <p className="text-meta text-fg-subtle">{t("qualifications.fileNote")}</p>
    </div>
  );
}

function ResubmitDialog({ open, onOpenChange, row, employmentId }: { open: boolean; onOpenChange: (open: boolean) => void; row: QualificationDTO; employmentId: string | null }) {
  const { run } = useCommand();
  const t = usePeopleTranslations();
  const [file, setFile] = React.useState<File | null>(null);
  // A discarded dialog takes its chosen file with it: the input starts empty next time.
  React.useEffect(() => {
    if (!open) setFile(null);
  }, [open]);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("qualifications.resubmitTitle", { title: row.title })}
      description={t("qualifications.resubmitDescription")}
      fields={[{ name: "note", label: t("qualifications.noteForHr"), type: "textarea", rows: 2 }]}
      submitLabel={t("qualifications.resubmit")}
      saveKind="none"
      module="people"
      onSubmit={async (payload) => {
        const documentId = file && employmentId ? await uploadToEmployment(employmentId, file, `${row.title} — ${file.name}`) : undefined;
        await engineeringApi(`/api/people/${row.personId}/qualifications/${row.id}/resubmit`, { body: { ...payload, documentId, expectedVersion: row.version } });
        await run("resubmit", async () => null, t("qualifications.resubmitted"));
      }}
    >
      {employmentId ? <FileInput onChange={setFile} /> : null}
    </FormDialog>
  );
}

function QualificationDialog({ request, onClose, data }: { request: { renews?: QualificationDTO; edits?: QualificationDTO } | null; onClose: () => void; data: PersonQualificationsDTO }) {
  const { run } = useCommand();
  const t = usePeopleTranslations();
  const [file, setFile] = React.useState<File | null>(null);
  const base = request?.edits ?? request?.renews ?? null;
  const [type, setType] = React.useState<QualificationType | "">(base?.type ?? "");
  React.useEffect(() => {
    setType(request?.edits?.type ?? request?.renews?.type ?? "");
    setFile(null);
  }, [request]);

  const rule = type ? QUALIFICATION_TYPE_RULES[type] : null;
  const fields: FormField[] = [
    ...(request?.renews ? [] : [{ name: "type", label: t("qualifications.whatItIs"), type: "select" as const, required: true, emptyLabel: t("qualifications.choose"), options: QUALIFICATION_TYPES.map((key) => ({ value: key, label: peopleLabel(t, "qualificationType", key, QUALIFICATION_TYPE_RULES[key].label) })) }]),
    { name: "title", label: t("qualifications.title"), type: "text", required: true, placeholder: rule?.hasProficiency ? t("qualifications.titleSkill") : t("qualifications.titleOther"), wide: !request?.renews ? false : true },
    ...(rule?.hasProficiency ? [{ name: "proficiency", label: t("qualifications.level"), type: "select" as const, emptyLabel: "—", options: Object.entries(PROFICIENCY_LABELS).map(([value, label]) => ({ value, label: peopleLabel(t, "proficiency", value, label) })) }] : []),
    // A skill is held, not issued (§14): no issuer, number or dates to ask for.
    ...(type === "SKILL"
      ? []
      : [
          { name: "issuer", label: t("qualifications.issuedBy"), type: "text" as const },
          { name: "documentNumber", label: t("qualifications.numberLabel"), type: "text" as const },
          { name: "issueDate", label: t("qualifications.issuedOn"), type: "date" as const },
          { name: "expiryDate", label: rule?.expiryExpected ? t("qualifications.expiresOn") : t("qualifications.expiresOnIf"), type: "date" as const },
        ]),
    { name: "visibility", label: t("qualifications.whoMaySee"), type: "select", required: true, options: (base && !data.capabilities.visibilities.includes(base.visibility) ? [base.visibility, ...data.capabilities.visibilities] : data.capabilities.visibilities).map((value) => ({ value, label: peopleLabel(t, "visibility", value, QUALIFICATION_VISIBILITY_LABELS[value]) })), wide: true },
  ];
  const edits = request?.edits;
  const renews = request?.renews;

  return (
    <FormDialog
      open={request !== null}
      onOpenChange={(open) => !open && onClose()}
      title={edits ? t("qualifications.editTitle", { title: edits.title }) : renews ? t("qualifications.renewTitle", { title: renews.title }) : t("qualifications.addTitle")}
      description={renews ? t("qualifications.renewDescription") : edits ? t("qualifications.editDescription") : data.isSelf ? t("qualifications.addSelfDescription") : t("qualifications.addOtherDescription")}
      fields={fields}
      initial={base ? { type: base.type, title: base.title, issuer: base.issuer, documentNumber: edits ? base.documentNumber : "", issueDate: edits ? base.issueDate : "", expiryDate: edits ? base.expiryDate : "", proficiency: base.proficiency, visibility: base.visibility } : { visibility: "EMPLOYEE_AND_HR" }}
      submitLabel={edits ? t("qualifications.save") : renews ? t("qualifications.renew") : t("qualifications.add")}
      saveKind={edits ? "save" : "create"}
      module="people"
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
        await run("qualification", async () => null, edits ? t("qualifications.saved") : renews ? t("qualifications.renewed") : t("qualifications.added"));
      }}
    >
      {data.capabilities.fileEmploymentId && !edits?.file ? <FileInput onChange={setFile} /> : null}
    </FormDialog>
  );
}
