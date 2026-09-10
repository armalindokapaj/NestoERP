"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, MoreHorizontal, PenLine, Star, UserPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
import {
  archiveContactAction,
  createContactAction,
  makePrimaryContactAction,
  restoreContactAction,
  updateContactAction,
} from "@/lib/actions/clients";
import type { ContactDTO } from "@/lib/modules/clients/client.types";

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
        toast({ title: result.error ?? "Something went wrong.", tone: "danger" });
      }
    });
  }

  const active = contacts.filter((contact) => contact.status !== "ARCHIVED");
  const archived = contacts.filter((contact) => contact.status === "ARCHIVED");

  return (
    <div className="space-y-4">
      {canCreate ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setAdding(true)}>
            <UserPlus aria-hidden="true" />
            Add contact
          </Button>
        </div>
      ) : null}

      {active.length === 0 && archived.length === 0 ? (
        <EmptyState
          icon={<UserPlus />}
          title="No contacts added yet."
          description="People you deal with at this client will appear here."
        />
      ) : (
        <ul className="nesto-card divide-y divide-line">
          {[...active, ...archived].map((contact) => (
            <li key={contact.id} className="flex flex-wrap items-start gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-table font-medium text-fg">{contact.fullName}</p>
                  {contact.isPrimary ? <Badge tone="info">Primary</Badge> : null}
                  {contact.status === "INACTIVE" ? <Badge tone="neutral">Inactive</Badge> : null}
                  {contact.status === "ARCHIVED" ? <Badge tone="neutral">Archived</Badge> : null}
                </div>
                {contact.jobTitle ? (
                  <p className="mt-0.5 text-meta text-fg-subtle">{contact.jobTitle}</p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-meta text-fg-muted">
                  {contact.email ? (
                    <a href={`mailto:${contact.email}`} className="hover:text-accent">
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
                      aria-label={`Actions for ${contact.fullName}`}
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
                        Edit contact
                      </DropdownMenuItem>
                    ) : null}

                    {canUpdate && !contact.isPrimary && contact.status === "ACTIVE" ? (
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          run(
                            () => makePrimaryContactAction(clientId, contact.id),
                            "Primary contact changed.",
                          );
                        }}
                      >
                        <Star />
                        Make primary
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
                        Archive contact
                      </DropdownMenuItem>
                    ) : null}

                    {canRestore && contact.status === "ARCHIVED" ? (
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          run(
                            () => restoreContactAction(clientId, contact.id),
                            "Contact restored.",
                          );
                        }}
                      >
                        <ArchiveRestore />
                        Restore contact
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
        title="Add contact"
        pending={pending}
        onSubmit={(formData) =>
          run(() => createContactAction(clientId, formData), "Contact added.")
        }
      />

      <ContactDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title="Edit contact"
        contact={editing}
        pending={pending}
        onSubmit={(formData) =>
          editing
            ? run(() => updateContactAction(clientId, editing.id, formData), "Contact updated.")
            : undefined
        }
      />

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={archiving ? `Archive ${archiving.fullName}?` : ""}
        description={
          archiving?.isPrimary
            ? "This is the primary contact. Archiving them leaves the client without one until you choose a replacement."
            : "The contact will be removed from the active list. Their history is kept and they can be restored."
        }
        confirmLabel="Archive contact"
        pending={pending}
        onConfirm={() =>
          archiving
            ? run(() => archiveContactAction(clientId, archiving.id), "Contact archived.")
            : undefined
        }
      />
    </div>
  );
}

const selectClass =
  "h-10 w-full rounded-md border border-line bg-surface px-3 text-body text-fg transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20";

function ContactDialog({
  open,
  onOpenChange,
  title,
  contact,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  contact?: ContactDTO | null;
  pending: boolean;
  onSubmit: (formData: FormData) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(new FormData(event.currentTarget));
          }}
        >
          {contact ? (
            <input type="hidden" name="versionUpdatedAt" value={contact.updatedAt} />
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">
                First name<span className="ml-0.5 text-danger-strong">*</span>
              </Label>
              <Input
                id="firstName"
                name="firstName"
                required
                maxLength={120}
                defaultValue={contact?.firstName ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">
                Last name<span className="ml-0.5 text-danger-strong">*</span>
              </Label>
              <Input
                id="lastName"
                name="lastName"
                required
                maxLength={120}
                defaultValue={contact?.lastName ?? ""}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="jobTitle">Job title</Label>
            <Input
              id="jobTitle"
              name="jobTitle"
              maxLength={160}
              defaultValue={contact?.jobTitle ?? ""}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contact-email">Email</Label>
              <Input
                id="contact-email"
                name="email"
                type="email"
                maxLength={254}
                defaultValue={contact?.email ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-phone">Phone</Label>
              <Input
                id="contact-phone"
                name="phone"
                type="tel"
                maxLength={40}
                defaultValue={contact?.phone ?? ""}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contact-status">Status</Label>
              <select
                id="contact-status"
                name="status"
                defaultValue={contact?.status === "INACTIVE" ? "INACTIVE" : "ACTIVE"}
                className={selectClass}
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>

            <label className="flex items-center gap-2 self-end pb-2.5 text-table text-fg">
              <input
                type="checkbox"
                name="isPrimary"
                defaultChecked={contact?.isPrimary ?? false}
                className="size-4 rounded border-line text-accent focus:ring-ring/20"
              />
              Primary contact
            </label>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save contact"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
