"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { Mail, Pencil, Phone, Plus, Trash2, Upload } from "lucide-react";

import { UPLOAD_IN_FLIGHT, useUploadQueue } from "@/components/documents/upload-queue";
import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { dateLabel, ReviewBadge } from "@/components/engineering/engineering-ui";
import { FormDialog, ReasonDialog } from "@/components/engineering/form-kit";
import { complianceFields, KEEP_WAIVER, contactFields } from "@/components/engineering/record-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { COMPLIANCE_STATUS_LABELS, COMPLIANCE_TYPE_LABELS, CONTACT_ROLE_LABELS, type ComplianceItemDTO, type ContactDTO } from "@/lib/modules/contractors/contractor.types";
import type { Option } from "@/lib/modules/engineering/engineering.types";
import { cn } from "@/lib/utils/cn";
import { contractorsLabel } from "@/lib/i18n/modules/contractors/labels";
import type { Translate } from "@/lib/i18n/translator";
import { useContractorsTranslations } from "./contractors-text";

/**
 * A contractor's people and paperwork (PRD #46 §20-§23, §41-§49, §312).
 * Contacts are business cards — nobody here signs in. Compliance shows what
 * expires when, the evidence behind it, and waives with a reason.
 */

export function ContactsPanel({ contractorId, contacts, canManage }: { contractorId: string; contacts: ContactDTO[]; canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const t = useContractorsTranslations();
  const [editing, setEditing] = React.useState<ContactDTO | "new" | null>(null);

  async function remove(contact: ContactDTO) {
    try {
      const result = await engineeringApi<{ removed: boolean }>(`/api/contractor-contacts/${contact.id}`, { method: "DELETE" });
      toast({ title: result.removed ? t("contacts.removed") : t("contacts.keptInactive"), tone: "success" });
      router.refresh();
    } catch (failure) {
      toast({ title: failureMessage(failure), tone: "danger" });
    }
  }

  return (
    <section className="space-y-4" data-testid="contacts-panel">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-section font-semibold text-fg">{t("contacts.title")}</h2>
          <p className="mt-0.5 text-table text-fg-muted">{t("contacts.description")}</p>
        </div>
        {canManage ? (
          <Button type="button" size="sm" onClick={() => setEditing("new")} data-testid="add-contact">
            <Plus aria-hidden="true" />
            {t("contacts.add")}
          </Button>
        ) : null}
      </div>
      {contacts.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-table text-fg-muted">{t("contacts.empty")}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {contacts.map((contact) => (
            <li key={contact.id} className={cn("nesto-card p-4", !contact.active && "opacity-60")} data-testid="contact-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-body font-medium text-fg">{contact.name}</p>
                  <p className="text-table text-fg-muted">{[contact.roleTitle, contact.contactRole ? contractorsLabel(t, "contactRole", contact.contactRole, CONTACT_ROLE_LABELS[contact.contactRole]) : null].filter(Boolean).join(" · ") || "—"}</p>
                </div>
                {!contact.active ? <Badge tone="default">{t("contacts.inactive")}</Badge> : null}
              </div>
              <div className="mt-3 space-y-1 text-table">
                {contact.email ? (
                  // A long address breaks inside the card at 320px; 44px to tap (AUD-04 §3, D-09-13, MW-01).
                  <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-fg underline-offset-4 hover:underline touch:min-h-11">
                    <Mail aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{contact.email}</span>
                  </a>
                ) : null}
                {contact.phone ? (
                  <a href={`tel:${contact.phone}`} className="flex items-center gap-2 text-fg touch:min-h-11">
                    <Phone aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
                    {contact.phone}
                  </a>
                ) : null}
              </div>
              {canManage ? (
                <div className="mt-3 flex gap-1 border-t border-line pt-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(contact)}>
                    <Pencil aria-hidden="true" />
                    {t("contacts.edit")}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void remove(contact)}>
                    <Trash2 aria-hidden="true" />
                    {t("contacts.remove")}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === "new" ? t("contacts.add") : t("contacts.editTitle")}
        fields={contactFields(t)}
        initial={editing && editing !== "new" ? editing : { active: true }}
        submitLabel={editing === "new" ? t("contacts.add") : t("contacts.saveChanges")}
        saveKind={editing === "new" ? "create" : "save"}
        testId="contact-form"
        onSubmit={async (payload) => {
          if (editing === "new") await engineeringApi(`/api/contractors/${contractorId}/contacts`, { body: payload });
          else if (editing) await engineeringApi(`/api/contractor-contacts/${editing.id}`, { method: "PATCH", body: payload });
          router.refresh();
        }}
      />
    </section>
  );
}

function expiryText(item: ComplianceItemDTO, t: Translate<"contractors">): string {
  if (!item.expiresAt) return t("compliance.noExpiry");
  if (item.daysToExpiry === null) return dateLabel(item.expiresAt);
  if (item.daysToExpiry < 0) return t("compliance.expired", { date: dateLabel(item.expiresAt) });
  if (item.daysToExpiry === 0) return t("compliance.expiresToday");
  return t("compliance.inDays", { date: dateLabel(item.expiresAt), count: item.daysToExpiry });
}

export function CompliancePanel({ contractorId, items, canManage, canUpload, highlight, showContractor = false }: { contractorId: string | null; items: ComplianceItemDTO[]; canManage: boolean; canUpload: boolean; highlight?: string | null; showContractor?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const t = useContractorsTranslations();
  const [editing, setEditing] = React.useState<ComplianceItemDTO | "new" | null>(null);
  const [waiving, setWaiving] = React.useState<ComplianceItemDTO | null>(null);
  const [documents, setDocuments] = React.useState<Option[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  /** Whether the evidence choices could be read: when not, the field is left out and the evidence kept (AUD-09 §5, FV-09, FV-10). */
  const [evidenceReadable, setEvidenceReadable] = React.useState(true);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const target = editing && editing !== "new" ? editing : null;
  const ownerId = target?.contractor.id ?? contractorId;

  const loadDocuments = React.useCallback(async (itemId: string | null, owner: string | null) => {
    if (!owner) return [];
    let rows: Option[] = [];
    try {
      rows = await engineeringApi<Option[]>(`/api/contractors/${owner}/compliance/documents${itemId ? `?itemId=${itemId}` : ""}`);
      setEvidenceReadable(true);
    } catch {
      setEvidenceReadable(false);
    }
    setDocuments(rows);
    setLoaded(true);
    return rows;
  }, []);

  const upload = useUploadQueue({
    parent: { context: "record", entityType: target ? "contractor_compliance" : "contractor", entityId: target?.id ?? ownerId ?? "" },
    onUploaded: () => void loadDocuments(target?.id ?? null, ownerId).then(() => toast({ title: t("compliance.uploaded"), tone: "success" })),
  });
  const uploading = upload.items.some((item) => UPLOAD_IN_FLIGHT.includes(item.status));

  async function open(item: ComplianceItemDTO | "new") {
    setLoaded(false);
    await loadDocuments(item === "new" ? null : item.id, item === "new" ? contractorId : item.contractor.id);
    setEditing(item);
  }

  async function archive(item: ComplianceItemDTO) {
    try {
      await engineeringApi(`/api/contractor-compliance/${item.id}/archive`, { body: {} });
      toast({ title: t("compliance.archivedToast"), tone: "success" });
      router.refresh();
    } catch (failure) {
      toast({ title: failureMessage(failure), tone: "danger" });
    }
  }

  /** One requirement's actions, the same on the phone card and in the table row. */
  const complianceActions = (item: ComplianceItemDTO) => (
    <div className="flex flex-wrap justify-end gap-1">
      {item.canManage ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => void open(item)} data-testid="edit-compliance">
          {item.status === "EXPIRED" || item.status === "EXPIRING" || item.status === "MISSING" ? t("compliance.renew") : t("compliance.edit")}
        </Button>
      ) : null}
      {item.canWaive && item.status !== "VALID" ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => setWaiving(item)} data-testid="waive-compliance">
          {t("compliance.waive")}
        </Button>
      ) : null}
      {item.canManage ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => void archive(item)}>
          {t("compliance.archive")}
        </Button>
      ) : null}
    </div>
  );

  return (
    <section className="space-y-4" data-testid="compliance-panel">
      {contractorId ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-section font-semibold text-fg">{t("compliance.title")}</h2>
            <p className="mt-0.5 text-table text-fg-muted">{t("compliance.description")}</p>
          </div>
          {canManage ? (
            <Button type="button" size="sm" onClick={() => void open("new")} data-testid="add-compliance">
              <Plus aria-hidden="true" />
              {t("compliance.addRequirement")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-table text-fg-muted">{t("compliance.empty")}</p>
      ) : (
        <>
        {/*
          * A card per requirement on a phone, with Renew / Waive / Archive on
          * the card instead of past the right edge of the table (AUD-04 §5, D-09-12, MW-05).
          */}
        <ul className="space-y-2 md:hidden" aria-label={t("compliance.title")}>
          {items.map((item) => (
            <li key={item.id} className={cn("space-y-1.5 rounded-lg border border-line bg-surface p-4", highlight === item.id && "bg-accent-soft/40", item.archived && "opacity-60")} data-testid="compliance-card" data-status={item.status}>
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 font-medium text-fg [overflow-wrap:anywhere]">{item.title}</p>
                <ReviewBadge status={item.status} label={contractorsLabel(t, "complianceStatus", item.status, COMPLIANCE_STATUS_LABELS[item.status])} />
              </div>
              <p className="text-meta text-fg-muted [overflow-wrap:anywhere]">
                {[showContractor ? item.contractor.label : null, contractorsLabel(t, "complianceType", item.type, COMPLIANCE_TYPE_LABELS[item.type]), item.issuer, item.referenceNumber].filter(Boolean).join(" · ")}
              </p>
              {item.status === "WAIVED" && item.waivedReason ? <p className="text-meta text-fg-muted">{t("compliance.waived", { reason: item.waivedReason })}</p> : null}
              <p className={cn("text-table tabular-nums", item.status === "EXPIRED" ? "text-danger-strong" : item.status === "EXPIRING" ? "text-warning-strong" : "text-fg")}>{expiryText(item, t)}</p>
              {item.document ? (
                <Link href={item.document.href} className="inline-flex items-center text-table text-fg underline-offset-4 [overflow-wrap:anywhere] hover:underline touch:min-h-11">
                  {item.document.name}
                </Link>
              ) : null}
              {showContractor ? (
                <Link href={item.contractor.href} className="inline-flex items-center text-table text-accent-strong hover:underline touch:min-h-11">
                  {t("compliance.openContractor")}
                </Link>
              ) : null}
              {complianceActions(item)}
            </li>
          ))}
        </ul>
        <div className="hidden md:block">
        <Table label={t("compliance.title")}>
          <TableHead>
            <TableRow>
              <TableHeaderCell scope="col">{t("compliance.requirement")}</TableHeaderCell>
              {showContractor ? <TableHeaderCell scope="col">{t("compliance.contractor")}</TableHeaderCell> : null}
              <TableHeaderCell scope="col">{t("compliance.type")}</TableHeaderCell>
              <TableHeaderCell scope="col">{t("compliance.status")}</TableHeaderCell>
              <TableHeaderCell scope="col">{t("compliance.expiry")}</TableHeaderCell>
              <TableHeaderCell scope="col">{t("compliance.evidence")}</TableHeaderCell>
              <TableHeaderCell scope="col">
                <span className="sr-only">{t("compliance.actions")}</span>
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} data-testid="compliance-row" data-status={item.status} className={cn(highlight === item.id && "bg-accent-soft/40", item.archived && "opacity-60")}>
                <TableCell className="min-w-[12rem]">
                  <p className="font-medium text-fg">{item.title}</p>
                  {item.referenceNumber || item.issuer ? <p className="text-meta text-fg-muted">{[item.issuer, item.referenceNumber].filter(Boolean).join(" · ")}</p> : null}
                  {item.status === "WAIVED" && item.waivedReason ? <p className="text-meta text-fg-muted">{t("compliance.waived", { reason: item.waivedReason })}</p> : null}
                </TableCell>
                {showContractor ? (
                  <TableCell>
                    <Link href={item.contractor.href} className="text-fg hover:underline">
                      {item.contractor.label}
                    </Link>
                  </TableCell>
                ) : null}
                <TableCell className="whitespace-nowrap text-fg-muted">{contractorsLabel(t, "complianceType", item.type, COMPLIANCE_TYPE_LABELS[item.type])}</TableCell>
                <TableCell>
                  <ReviewBadge status={item.status} label={contractorsLabel(t, "complianceStatus", item.status, COMPLIANCE_STATUS_LABELS[item.status])} testId="compliance-status" />
                </TableCell>
                <TableCell className={cn("whitespace-nowrap tabular-nums", item.status === "EXPIRED" ? "text-danger-strong" : item.status === "EXPIRING" ? "text-warning-strong" : "text-fg")}>{expiryText(item, t)}</TableCell>
                <TableCell>
                  {item.document ? (
                    <Link href={item.document.href} className="text-fg underline-offset-4 hover:underline">
                      {item.document.name}
                    </Link>
                  ) : (
                    <span className="text-fg-subtle">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">{complianceActions(item)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
        </>
      )}

      {editing && loaded ? (
        <FormDialog
          open
          onOpenChange={(next) => !next && setEditing(null)}
          title={editing === "new" ? t("compliance.addTitle") : t("compliance.editTitle", { title: editing.title })}
          description={t("compliance.formDescription")}
          fields={complianceFields(documents, { waived: target?.status === "WAIVED", evidence: evidenceReadable }, t)}
          initial={editing === "new" ? { status: "VALID", type: "INSURANCE" } : { ...editing, status: editing.status === "WAIVED" ? KEEP_WAIVER : editing.status === "MISSING" ? "MISSING" : "VALID", documentId: editing.document?.id ?? null }}
          submitLabel={editing === "new" ? t("compliance.addRequirement") : t("compliance.save")}
          saveKind={editing === "new" ? "create" : "save"}
          wide
          testId="compliance-form"
          onSubmit={async (payload) => {
            // "Keep the waiver" is no status at all: the server keeps the one stored (AUD-09 §5, FV-10).
            if (payload.status === KEEP_WAIVER) delete payload.status;
            if (editing === "new") await engineeringApi(`/api/contractors/${contractorId}/compliance`, { body: payload });
            else await engineeringApi(`/api/contractor-compliance/${editing.id}`, { method: "PATCH", body: payload });
            toast({ title: t("compliance.saved"), tone: "success" });
            router.refresh();
          }}
        >
          {!evidenceReadable ? (
            <p className="text-table text-fg-muted" data-testid="compliance-evidence-kept">
              {t("compliance.evidenceKept")}
            </p>
          ) : null}
          {canUpload && ownerId ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-line-strong px-4 py-3">
              <input ref={fileInput} type="file" className="sr-only" aria-label={t("compliance.uploadEvidence")} data-testid="compliance-upload" onChange={(event) => { if (event.target.files?.length) upload.enqueue([...event.target.files], (file) => ({ name: file.name })); event.target.value = ""; }} />
              <p className="text-table text-fg-muted">{uploading ? t("compliance.uploading") : t("compliance.uploadHint")}</p>
              <Button type="button" size="sm" variant="secondary" onClick={() => fileInput.current?.click()} disabled={uploading}>
                <Upload aria-hidden="true" />
                {t("compliance.upload")}
              </Button>
            </div>
          ) : null}
        </FormDialog>
      ) : null}

      <ReasonDialog
        open={waiving !== null}
        onOpenChange={(next) => !next && setWaiving(null)}
        title={t("compliance.waiveTitle", { title: waiving?.title ?? t("compliance.requirementFallback") })}
        description={t("compliance.waiveDescription")}
        confirmLabel={t("compliance.waiveConfirm")}
        onConfirm={async (payload) => {
          await engineeringApi(`/api/contractor-compliance/${waiving!.id}/waive`, { body: payload });
          toast({ title: t("compliance.waivedToast"), tone: "success" });
          router.refresh();
        }}
      />
    </section>
  );
}
