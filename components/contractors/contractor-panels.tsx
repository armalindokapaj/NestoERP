"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { Mail, Pencil, Phone, Plus, Trash2, Upload } from "lucide-react";

import { useUploadQueue } from "@/components/documents/upload-queue";
import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { dateLabel, ReviewBadge } from "@/components/engineering/engineering-ui";
import { FormDialog, ReasonDialog } from "@/components/engineering/form-kit";
import { complianceFields, contactFields } from "@/components/engineering/record-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { COMPLIANCE_STATUS_LABELS, COMPLIANCE_TYPE_LABELS, CONTACT_ROLE_LABELS, type ComplianceItemDTO, type ContactDTO } from "@/lib/modules/contractors/contractor.types";
import type { Option } from "@/lib/modules/engineering/engineering.types";
import { cn } from "@/lib/utils/cn";

/**
 * A contractor's people and paperwork (PRD #46 §20-§23, §41-§49, §312).
 * Contacts are business cards — nobody here signs in. Compliance shows what
 * expires when, the evidence behind it, and waives with a reason.
 */

export function ContactsPanel({ contractorId, contacts, canManage }: { contractorId: string; contacts: ContactDTO[]; canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = React.useState<ContactDTO | "new" | null>(null);

  async function remove(contact: ContactDTO) {
    try {
      const result = await engineeringApi<{ removed: boolean }>(`/api/contractor-contacts/${contact.id}`, { method: "DELETE" });
      toast({ title: result.removed ? "Contact removed." : "Contact kept as inactive: an assignment still names them.", tone: "success" });
      router.refresh();
    } catch (failure) {
      toast({ title: failureMessage(failure), tone: "danger" });
    }
  }

  return (
    <section className="space-y-4" data-testid="contacts-panel">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-section font-semibold text-fg">Contacts</h2>
          <p className="mt-0.5 text-table text-fg-muted">The people at this contractor the company works with. Contact records only — none of them has a login.</p>
        </div>
        {canManage ? (
          <Button type="button" size="sm" onClick={() => setEditing("new")} data-testid="add-contact">
            <Plus aria-hidden="true" />
            Add contact
          </Button>
        ) : null}
      </div>
      {contacts.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-table text-fg-muted">No contacts yet.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {contacts.map((contact) => (
            <li key={contact.id} className={cn("nesto-card p-4", !contact.active && "opacity-60")} data-testid="contact-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-body font-medium text-fg">{contact.name}</p>
                  <p className="text-table text-fg-muted">{[contact.roleTitle, contact.contactRole ? CONTACT_ROLE_LABELS[contact.contactRole] : null].filter(Boolean).join(" · ") || "—"}</p>
                </div>
                {!contact.active ? <Badge tone="default">Inactive</Badge> : null}
              </div>
              <div className="mt-3 space-y-1 text-table">
                {contact.email ? (
                  <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-fg underline-offset-4 hover:underline">
                    <Mail aria-hidden="true" className="size-3.5 text-fg-subtle" />
                    {contact.email}
                  </a>
                ) : null}
                {contact.phone ? (
                  <a href={`tel:${contact.phone}`} className="flex items-center gap-2 text-fg">
                    <Phone aria-hidden="true" className="size-3.5 text-fg-subtle" />
                    {contact.phone}
                  </a>
                ) : null}
              </div>
              {canManage ? (
                <div className="mt-3 flex gap-1 border-t border-line pt-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(contact)}>
                    <Pencil aria-hidden="true" />
                    Edit
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void remove(contact)}>
                    <Trash2 aria-hidden="true" />
                    Remove
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
        title={editing === "new" ? "Add contact" : "Edit contact"}
        fields={contactFields}
        initial={editing && editing !== "new" ? editing : { active: true }}
        submitLabel={editing === "new" ? "Add contact" : "Save changes"}
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

function expiryText(item: ComplianceItemDTO): string {
  if (!item.expiresAt) return "No expiry";
  if (item.daysToExpiry === null) return dateLabel(item.expiresAt);
  if (item.daysToExpiry < 0) return `Expired ${dateLabel(item.expiresAt)}`;
  if (item.daysToExpiry === 0) return "Expires today";
  return `${dateLabel(item.expiresAt)} · in ${item.daysToExpiry} ${item.daysToExpiry === 1 ? "day" : "days"}`;
}

export function CompliancePanel({ contractorId, items, canManage, canUpload, highlight, showContractor = false }: { contractorId: string | null; items: ComplianceItemDTO[]; canManage: boolean; canUpload: boolean; highlight?: string | null; showContractor?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = React.useState<ComplianceItemDTO | "new" | null>(null);
  const [waiving, setWaiving] = React.useState<ComplianceItemDTO | null>(null);
  const [documents, setDocuments] = React.useState<Option[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const target = editing && editing !== "new" ? editing : null;
  const ownerId = target?.contractor.id ?? contractorId;

  const loadDocuments = React.useCallback(async (itemId: string | null, owner: string | null) => {
    if (!owner) return [];
    const rows = await engineeringApi<Option[]>(`/api/contractors/${owner}/compliance/documents${itemId ? `?itemId=${itemId}` : ""}`).catch(() => []);
    setDocuments(rows);
    setLoaded(true);
    return rows;
  }, []);

  const upload = useUploadQueue({
    parent: { context: "record", entityType: target ? "contractor_compliance" : "contractor", entityId: target?.id ?? ownerId ?? "" },
    onUploaded: () => void loadDocuments(target?.id ?? null, ownerId).then(() => toast({ title: "File uploaded. Choose it as the evidence.", tone: "success" })),
  });
  const uploading = upload.items.some((item) => ["queued", "authorising", "uploading", "verifying", "processing"].includes(item.status));

  async function open(item: ComplianceItemDTO | "new") {
    setLoaded(false);
    await loadDocuments(item === "new" ? null : item.id, item === "new" ? contractorId : item.contractor.id);
    setEditing(item);
  }

  async function archive(item: ComplianceItemDTO) {
    try {
      await engineeringApi(`/api/contractor-compliance/${item.id}/archive`, { body: {} });
      toast({ title: "Compliance item archived.", tone: "success" });
      router.refresh();
    } catch (failure) {
      toast({ title: failureMessage(failure), tone: "danger" });
    }
  }

  return (
    <section className="space-y-4" data-testid="compliance-panel">
      {contractorId ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-section font-semibold text-fg">Compliance</h2>
            <p className="mt-0.5 text-table text-fg-muted">Insurance, licences, guarantees and certificates. Expiring and expired follow from the dates.</p>
          </div>
          {canManage ? (
            <Button type="button" size="sm" onClick={() => void open("new")} data-testid="add-compliance">
              <Plus aria-hidden="true" />
              Add requirement
            </Button>
          ) : null}
        </div>
      ) : null}
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-table text-fg-muted">No compliance items recorded.</p>
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell scope="col">Requirement</TableHeaderCell>
              {showContractor ? <TableHeaderCell scope="col">Contractor</TableHeaderCell> : null}
              <TableHeaderCell scope="col">Type</TableHeaderCell>
              <TableHeaderCell scope="col">Status</TableHeaderCell>
              <TableHeaderCell scope="col">Expiry</TableHeaderCell>
              <TableHeaderCell scope="col">Evidence</TableHeaderCell>
              <TableHeaderCell scope="col">
                <span className="sr-only">Actions</span>
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} data-testid="compliance-row" data-status={item.status} className={cn(highlight === item.id && "bg-accent-soft/40", item.archived && "opacity-60")}>
                <TableCell className="min-w-[12rem]">
                  <p className="font-medium text-fg">{item.title}</p>
                  {item.referenceNumber || item.issuer ? <p className="text-meta text-fg-muted">{[item.issuer, item.referenceNumber].filter(Boolean).join(" · ")}</p> : null}
                  {item.status === "WAIVED" && item.waivedReason ? <p className="text-meta text-fg-muted">Waived: {item.waivedReason}</p> : null}
                </TableCell>
                {showContractor ? (
                  <TableCell>
                    <Link href={item.contractor.href} className="text-fg hover:underline">
                      {item.contractor.label}
                    </Link>
                  </TableCell>
                ) : null}
                <TableCell className="whitespace-nowrap text-fg-muted">{COMPLIANCE_TYPE_LABELS[item.type]}</TableCell>
                <TableCell>
                  <ReviewBadge status={item.status} label={COMPLIANCE_STATUS_LABELS[item.status]} testId="compliance-status" />
                </TableCell>
                <TableCell className={cn("whitespace-nowrap tabular-nums", item.status === "EXPIRED" ? "text-danger-strong" : item.status === "EXPIRING" ? "text-warning-strong" : "text-fg")}>{expiryText(item)}</TableCell>
                <TableCell>
                  {item.document ? (
                    <Link href={item.document.href} className="text-fg underline-offset-4 hover:underline">
                      {item.document.name}
                    </Link>
                  ) : (
                    <span className="text-fg-subtle">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {item.canManage ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => void open(item)} data-testid="edit-compliance">
                        {item.status === "EXPIRED" || item.status === "EXPIRING" || item.status === "MISSING" ? "Renew" : "Edit"}
                      </Button>
                    ) : null}
                    {item.canWaive && item.status !== "VALID" ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setWaiving(item)} data-testid="waive-compliance">
                        Waive
                      </Button>
                    ) : null}
                    {item.canManage ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => void archive(item)}>
                        Archive
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {editing && loaded ? (
        <FormDialog
          open
          onOpenChange={(next) => !next && setEditing(null)}
          title={editing === "new" ? "Add compliance requirement" : `Renew or edit — ${editing.title}`}
          description="Upload the certificate, set its dates, and the status follows."
          fields={complianceFields(documents)}
          initial={editing === "new" ? { status: "VALID", type: "INSURANCE" } : { ...editing, status: editing.status === "MISSING" ? "MISSING" : "VALID", documentId: editing.document?.id ?? null }}
          submitLabel={editing === "new" ? "Add requirement" : "Save"}
          wide
          testId="compliance-form"
          onSubmit={async (payload) => {
            if (editing === "new") await engineeringApi(`/api/contractors/${contractorId}/compliance`, { body: payload });
            else await engineeringApi(`/api/contractor-compliance/${editing.id}`, { method: "PATCH", body: payload });
            toast({ title: "Compliance saved.", tone: "success" });
            router.refresh();
          }}
        >
          {canUpload && ownerId ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-line-strong px-4 py-3">
              <input ref={fileInput} type="file" className="sr-only" aria-label="Upload evidence" data-testid="compliance-upload" onChange={(event) => { if (event.target.files?.length) upload.enqueue([...event.target.files], (file) => ({ name: file.name })); event.target.value = ""; }} />
              <p className="text-table text-fg-muted">{uploading ? "Uploading and checking the file…" : "Upload the certificate, then choose it as the evidence."}</p>
              <Button type="button" size="sm" variant="secondary" onClick={() => fileInput.current?.click()} disabled={uploading}>
                <Upload aria-hidden="true" />
                Upload
              </Button>
            </div>
          ) : null}
        </FormDialog>
      ) : null}

      <ReasonDialog
        open={waiving !== null}
        onOpenChange={(next) => !next && setWaiving(null)}
        title={`Waive ${waiving?.title ?? "requirement"}`}
        description="A waiver is recorded with your name and reason in the audit trail."
        confirmLabel="Waive requirement"
        onConfirm={async (payload) => {
          await engineeringApi(`/api/contractor-compliance/${waiving!.id}/waive`, { body: payload });
          toast({ title: "Requirement waived.", tone: "success" });
          router.refresh();
        }}
      />
    </section>
  );
}
