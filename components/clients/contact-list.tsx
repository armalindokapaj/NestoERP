"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { Archive, ArchiveRestore, MoreHorizontal, PenLine, Star, UserPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import {
  archiveContactAction,
  createContactAction,
  type ClientActionResult,
  makePrimaryContactAction,
  restoreContactAction,
  updateContactAction,
} from "@/lib/actions/clients";
import type { ContactDTO } from "@/lib/modules/clients/client.types";
import { useClientsServerText, useClientsTranslations } from "./clients-text";
import { FormSelect } from "@/components/ui/form-select";

/**
 * Client contacts (PRD #12 §76–§89).
 *
 * A client has at most one primary contact, and promoting somebody stands the
 * previous one down in the same transaction. Archiving the primary leaves the
 * client without one rather than picking a replacement — that is a decision for
 * a person (PRD #12 §83, §87).
 */
export function ContactList({
  clientId,
  contacts,
  canCreate,
  canUpdate,
  canArchive,
  canRestore,
}: {
  clientId: string;
  contacts: ContactDTO[];
  canCreate: boolean;
  canUpdate: boolean;
  canArchive: boolean;
  canRestore: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const t = useClientsTranslations();
  const serverText = useClientsServerText();
  const [pending, startTransition] = React.useTransition();
  const [editing, setEditing] = React.useState<ContactDTO | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [archiving, setArchiving] = React.useState<ContactDTO | null>(null);

  function run(work: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        toast({ title: success });
        setEditing(null);
        setAdding(false);
        setArchiving(null);
        router.refresh();
      } else {
        toast({ title: serverText(result.error) ?? t("common.somethingWrong"), tone: "danger" });
      }
    });
  }

  /** A committed contact save: the dialog's editor is clean, so it closes at once (AUD-03 §5). */
  function saved(success: string) {
    toast({ title: success });
    setEditing(null);
    setAdding(false);
    router.refresh();
  }

  const active = contacts.filter((contact) => contact.status !== "ARCHIVED");
  const archived = contacts.filter((contact) => contact.status === "ARCHIVED");

  return (
    <div className="space-y-4">
      {canCreate ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setAdding(true)}>
            <UserPlus aria-hidden="true" />
            {t("contacts.add")}
          </Button>
        </div>
      ) : null}

      {active.length === 0 && archived.length === 0 ? (
        <EmptyState
          icon={<UserPlus />}
          title={t("contacts.emptyTitle")}
          description={t("contacts.emptyDescription")}
        />
      ) : (
        <ul className="nesto-card divide-y divide-line">
          {[...active, ...archived].map((contact) => (
            <li key={contact.id} className="flex flex-wrap items-start gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-table font-medium text-fg">{contact.fullName}</p>
                  {contact.isPrimary ? <Badge tone="info">{t("common.primary")}</Badge> : null}
                  {contact.status === "INACTIVE" ? <Badge tone="neutral">{t("common.inactive")}</Badge> : null}
                  {contact.status === "ARCHIVED" ? <Badge tone="neutral">{t("common.archived")}</Badge> : null}
                </div>
                {contact.jobTitle ? (
                  <p className="mt-0.5 text-meta text-fg-subtle">{contact.jobTitle}</p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-meta text-fg-muted">
                  {contact.email ? (
                    <a href={`mailto:${contact.email}`} className="min-w-0 hover:text-accent [overflow-wrap:anywhere]">
                      {contact.email}
                    </a>
                  ) : null}
                  {contact.phone ? (
                    <a href={`tel:${contact.phone}`} className="hover:text-accent">
                      {contact.phone}
                    </a>
                  ) : null}
                </div>
              </div>

              {canUpdate || canArchive || canRestore ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("contacts.actionsFor", { name: contact.fullName })}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canUpdate && contact.status !== "ARCHIVED" ? (
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          setEditing(contact);
                        }}
                      >
                        <PenLine />
                        {t("contacts.edit")}
                      </DropdownMenuItem>
                    ) : null}

                    {canUpdate && !contact.isPrimary && contact.status === "ACTIVE" ? (
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          run(
                            () => makePrimaryContactAction(clientId, contact.id),
                            t("contacts.primaryChanged"),
                          );
                        }}
                      >
                        <Star />
                        {t("contacts.makePrimary")}
                      </DropdownMenuItem>
                    ) : null}

                    {canArchive && contact.status !== "ARCHIVED" ? (
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          setArchiving(contact);
                        }}
                      >
                        <Archive />
                        {t("contacts.archive")}
                      </DropdownMenuItem>
                    ) : null}

                    {canRestore && contact.status === "ARCHIVED" ? (
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          run(
                            () => restoreContactAction(clientId, contact.id),
                            t("contacts.restored"),
                          );
                        }}
                      >
                        <ArchiveRestore />
                        {t("contacts.restore")}
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ContactDialog
        open={adding}
        onOpenChange={setAdding}
        title={t("contacts.add")}
        action={(formData) => createContactAction(clientId, formData)}
        onSaved={() => saved(t("contacts.added"))}
      />

      <ContactDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={t("contacts.edit")}
        contact={editing}
        action={(formData) =>
          editing
            ? updateContactAction(clientId, editing.id, formData)
            : Promise.resolve({ ok: false as const, code: "VALIDATION_ERROR", category: "validation" as const, error: t("contacts.chooseToEdit") })
        }
        onSaved={() => saved(t("contacts.updated"))}
      />

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={archiving ? t("contacts.archiveTitle", { name: archiving.fullName }) : ""}
        description={
          archiving?.isPrimary
            ? t("contacts.archivePrimary")
            : t("contacts.archiveOther")
        }
        confirmLabel={t("contacts.archive")}
        pending={pending}
        onConfirm={() =>
          archiving
            ? run(() => archiveContactAction(clientId, archiving.id), t("contacts.archivedToast"))
            : undefined
        }
      />
    </div>
  );
}

const selectClass =
  "h-10 w-full rounded-md border border-line bg-surface px-3 text-body text-fg transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20";

/**
 * The add/edit contact dialog. Its form registers with the unsaved-work
 * coordinator, so the X, Escape, the backdrop and Cancel ask before throwing
 * typed details away, and a save has an explicit outcome (AUD-03 §3, §5).
 */
function ContactDialog({
  open,
  onOpenChange,
  title,
  contact,
  action,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  contact?: ContactDTO | null;
  action: (formData: FormData) => Promise<ClientActionResult>;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <ContactForm contact={contact} action={action} onSaved={onSaved} />
      </DialogContent>
    </Dialog>
  );
}

function ContactForm({
  contact,
  action,
  onSaved,
}: {
  contact?: ContactDTO | null;
  action: (formData: FormData) => Promise<ClientActionResult>;
  onSaved: () => void;
}) {
  const t = useClientsTranslations();
  const formRef = React.useRef<HTMLFormElement>(null);
  const save = useEditorSave({
    formRef,
    action,
    module: "clients",
    saveKind: contact ? "save" : "create",
    label: contact ? contact.fullName : t("contacts.newContact"),
    onCommitted: () => {
      onSaved();
      return true;
    },
  });
  const { pending, fieldErrors } = save;
  // The service's message beside the field it is about (AUD-09 §3, §6), linked
  // to the input; the banner above keeps the form-level message.
  const invalid = (name: string, id: string) =>
    fieldErrors[name] ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
  const errorOf = (name: string, id: string) =>
    fieldErrors[name] ? (
      <p id={`${id}-error`} className="text-meta text-danger-strong">
        {fieldErrors[name][0]}
      </p>
    ) : null;

  return (
    <form ref={formRef} className="mt-4 space-y-4" onSubmit={save.onSubmit}>
      <SaveMessages save={save} />
      <fieldset disabled={pending || Boolean(save.saved)} className="m-0 min-w-0 space-y-4 border-0 p-0">
        {contact ? (
          <input type="hidden" name="versionUpdatedAt" value={contact.updatedAt} />
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="firstName">
              {t("contacts.firstName")}<span className="ml-0.5 text-danger-strong">*</span>
            </Label>
            <Input
              id="firstName"
              {...invalid("firstName", "firstName")}
              name="firstName"
              required
              maxLength={120}
              defaultValue={contact?.firstName ?? ""}
            />
            {errorOf("firstName", "firstName")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lastName">
              {t("contacts.lastName")}<span className="ml-0.5 text-danger-strong">*</span>
            </Label>
            <Input
              id="lastName"
              {...invalid("lastName", "lastName")}
              name="lastName"
              required
              maxLength={120}
              defaultValue={contact?.lastName ?? ""}
            />
            {errorOf("lastName", "lastName")}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="jobTitle">{t("contacts.jobTitle")}</Label>
          <Input
            id="jobTitle"
            {...invalid("jobTitle", "jobTitle")}
            name="jobTitle"
            maxLength={160}
            defaultValue={contact?.jobTitle ?? ""}
          />
          {errorOf("jobTitle", "jobTitle")}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="contact-email">{t("contacts.email")}</Label>
            <Input
              id="contact-email"
              {...invalid("email", "contact-email")}
              name="email"
              type="email"
              maxLength={254}
              defaultValue={contact?.email ?? ""}
            />
            {errorOf("email", "contact-email")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-phone">{t("contacts.phone")}</Label>
            <Input
              id="contact-phone"
              {...invalid("phone", "contact-phone")}
              name="phone"
              type="tel"
              maxLength={40}
              defaultValue={contact?.phone ?? ""}
            />
            {errorOf("phone", "contact-phone")}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="contact-status">{t("contacts.status")}</Label>
            <FormSelect
              id="contact-status"
              name="status"
              defaultValue={contact?.status === "INACTIVE" ? "INACTIVE" : "ACTIVE"}
              className={selectClass}
            >
              <option value="ACTIVE">{t("contacts.active")}</option>
              <option value="INACTIVE">{t("contacts.inactive")}</option>
            </FormSelect>
          </div>

          <label className="flex items-center gap-2 self-end pb-2.5 text-table text-fg">
            {/* An unticked box submits nothing; this says "not primary" out loud,
                and the ticked box, later in the form, overrides it (AUD-09 §4). */}
            <input type="hidden" name="isPrimary" value="false" />
            <input
              type="checkbox"
              value="true"
              name="isPrimary"
              defaultChecked={contact?.isPrimary ?? false}
              className="size-4 rounded border-line text-accent focus:ring-ring/20"
            />
            {t("contacts.primaryContact")}
          </label>
        </div>

      </fieldset>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="submit" disabled={pending || Boolean(save.saved)}>
          {pending ? t("contacts.saving") : t("contacts.save")}
        </Button>
        {/* Through the dialog's guard, like the X and Escape (AUD-03 §5). */}
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            {t("common.cancel")}
          </Button>
        </DialogClose>
        <UnsavedIndicator save={save} />
      </div>
    </form>
  );
}
