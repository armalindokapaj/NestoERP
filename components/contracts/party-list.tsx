"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { Plus, Trash2, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { selectClass } from "@/components/forms/record-form";
import {
  removeContractPartyAction,
  saveContractPartyAction,
} from "@/lib/actions/contracts";
import type { ContractPartyDTO } from "@/lib/modules/contracts/contract.types";
import {
  PARTY_ROLES,
  PARTY_TYPES,
  partyRoleLabels,
  partyTypeLabels,
} from "@/lib/modules/contracts/parties/party.schema";

/**
 * The parties to an agreement (PRD #18 §136–§147).
 *
 * Every field here is a **snapshot** of what the contract said. The form does
 * not read the current Client record and never will: renaming a customer must
 * not rewrite who signed (PRD #18 §141, §429).
 */
export function ContractPartyList({
  contractId,
  parties,
  canManage,
  canRemove,
  clients,
}: {
  contractId: string;
  parties: ContractPartyDTO[];
  canManage: boolean;
  canRemove: boolean;
  clients: { value: string; label: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = React.useState<ContractPartyDTO | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [removing, setRemoving] = React.useState<ContractPartyDTO | null>(null);
  const [pending, startTransition] = React.useTransition();

  function remove(party: ContractPartyDTO) {
    startTransition(async () => {
      const result = await removeContractPartyAction(contractId, party.id);
      setRemoving(null);
      if (result.ok) {
        toast({ title: `${party.name} removed.`, tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add party
          </Button>
        </div>
      ) : null}

      {parties.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="No parties recorded."
          description="The legal entities to this agreement — ours, the counterparty, and any guarantor."
        />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {parties.map((party) => (
            <li key={party.id} className="nesto-card space-y-3 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-table font-medium text-fg">{party.name}</p>
                  {party.legalName ? (
                    <p className="text-meta text-fg-subtle">{party.legalName}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Badge tone="neutral">{partyRoleLabels[party.role]}</Badge>
                  {party.isPrimaryCounterparty ? (
                    <Badge tone="info">Primary counterparty</Badge>
                  ) : null}
                </div>
              </div>

              <dl className="grid gap-x-4 gap-y-1 text-meta sm:grid-cols-2">
                <Row label="Type" value={partyTypeLabels[party.type]} />
                <Row label="Registration" value={party.registrationNumber} />
                <Row label="Tax ID" value={party.taxId} />
                <Row
                  label="Address"
                  value={[party.address, party.city, party.country].filter(Boolean).join(", ")}
                />
                <Row label="Signatory" value={party.signatoryName} />
                <Row label="Title" value={party.signatoryTitle} />
              </dl>

              {canManage || canRemove ? (
                <div className="flex flex-wrap justify-end gap-2">
                  {canManage ? (
                    <Button variant="secondary" size="sm" onClick={() => setEditing(party)}>
                      Edit
                    </Button>
                  ) : null}
                  {canRemove ? (
                    <Button variant="ghost" size="sm" onClick={() => setRemoving(party)}>
                      <Trash2 aria-hidden="true" />
                      Remove
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <PartyDialog
        open={adding || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAdding(false);
            setEditing(null);
          }
        }}
        contractId={contractId}
        party={editing}
        clients={clients}
        onSaved={() => {
          setAdding(false);
          setEditing(null);
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => (open ? undefined : setRemoving(null))}
        title={`Remove ${removing?.name ?? "this party"}?`}
        description="Only a draft contract allows this. Once anybody has reviewed it, the list of parties is part of what they agreed to."
        confirmLabel="Remove party"
        destructive
        pending={pending}
        onConfirm={() => removing && remove(removing)}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="min-w-0 truncate text-fg">{value}</dd>
    </div>
  );
}

/**
 * The party dialog holds a form registered with the unsaved-work coordinator:
 * the X, Escape, the backdrop and Cancel ask before throwing typed details
 * away, and a save has an explicit outcome (AUD-03 §3, §5).
 */
function PartyDialog({
  open,
  onOpenChange,
  contractId,
  party,
  clients,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  party: ContractPartyDTO | null;
  clients: { value: string; label: string }[];
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{party ? `Edit ${party.name}` : "Add a party"}</DialogTitle>
        <DialogDescription>
          These details are a snapshot of what the agreement says. They stay as they are even if the
          client record is renamed later.
        </DialogDescription>
        <PartyForm contractId={contractId} party={party} clients={clients} onSaved={onSaved} />
      </DialogContent>
    </Dialog>
  );
}

function PartyForm({
  contractId,
  party,
  clients,
  onSaved,
}: {
  contractId: string;
  party: ContractPartyDTO | null;
  clients: { value: string; label: string }[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const formRef = React.useRef<HTMLFormElement>(null);
  const save = useEditorSave({
    formRef,
    action: (formData: FormData) => saveContractPartyAction(contractId, party?.id ?? null, formData),
    module: "contracts",
    saveKind: party ? "save" : "create",
    label: party ? party.name : "New party",
    onCommitted: () => {
      toast({ title: party ? "Party updated." : "Party added.", tone: "success" });
      onSaved();
      return true;
    },
  });
  const { pending, fieldErrors: errors } = save;

  return (
    <form ref={formRef} onSubmit={save.onSubmit} className="mt-4 space-y-4">
      <SaveMessages save={save} />
      <fieldset disabled={pending || Boolean(save.saved)} className="m-0 min-w-0 space-y-4 border-0 p-0">
        <div className="grid gap-3 sm:grid-cols-2">
          <DialogField label="Role" name="partyRole" errors={errors}>
            <select
              id="partyRole"
              name="partyRole"
              className={selectClass}
              defaultValue={party?.role ?? "COUNTERPARTY"}
            >
              {PARTY_ROLES.map((role) => (
                <option key={role} value={role}>
                  {partyRoleLabels[role]}
                </option>
              ))}
            </select>
          </DialogField>

          <DialogField label="Party type" name="partyType" errors={errors}>
            <select
              id="partyType"
              name="partyType"
              className={selectClass}
              defaultValue={party?.type ?? "COMPANY"}
            >
              {PARTY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {partyTypeLabels[type]}
                </option>
              ))}
            </select>
          </DialogField>

          <DialogField label="Name" name="name" errors={errors}>
            <Input id="name" name="name" defaultValue={party?.name ?? ""} required maxLength={250} />
          </DialogField>

          <DialogField label="Legal name" name="legalName" errors={errors}>
            <Input
              id="legalName"
              name="legalName"
              defaultValue={party?.legalName ?? ""}
              maxLength={250}
            />
          </DialogField>

          <DialogField label="Registration number" name="registrationNumber" errors={errors}>
            <Input
              id="registrationNumber"
              name="registrationNumber"
              defaultValue={party?.registrationNumber ?? ""}
              maxLength={80}
            />
          </DialogField>

          <DialogField label="Tax ID" name="taxId" errors={errors}>
            <Input id="taxId" name="taxId" defaultValue={party?.taxId ?? ""} maxLength={80} />
          </DialogField>

          <DialogField label="Linked client" name="clientId" errors={errors}>
            <select
              id="clientId"
              name="clientId"
              className={selectClass}
              defaultValue={party?.clientId ?? ""}
            >
              <option value="">Not linked</option>
              {clients.map((client) => (
                <option key={client.value} value={client.value}>
                  {client.label}
                </option>
              ))}
            </select>
          </DialogField>

          <DialogField label="City" name="city" errors={errors}>
            <Input id="city" name="city" defaultValue={party?.city ?? ""} maxLength={120} />
          </DialogField>

          <DialogField label="Address" name="address" errors={errors} className="sm:col-span-2">
            <Input id="address" name="address" defaultValue={party?.address ?? ""} maxLength={500} />
          </DialogField>

          <DialogField label="Country" name="country" errors={errors}>
            <Input id="country" name="country" defaultValue={party?.country ?? ""} maxLength={120} />
          </DialogField>

          <DialogField label="Signatory" name="signatoryName" errors={errors}>
            <Input
              id="signatoryName"
              name="signatoryName"
              defaultValue={party?.signatoryName ?? ""}
              maxLength={200}
            />
          </DialogField>

          <DialogField label="Signatory title" name="signatoryTitle" errors={errors}>
            <Input
              id="signatoryTitle"
              name="signatoryTitle"
              defaultValue={party?.signatoryTitle ?? ""}
              maxLength={200}
            />
          </DialogField>
        </div>

        <label className="flex items-center gap-2 text-table text-fg">
          <input
            type="checkbox"
            name="isPrimaryCounterparty"
            defaultChecked={party?.isPrimaryCounterparty ?? false}
            className="size-4 rounded border-line"
          />
          Primary counterparty — at most one per contract
        </label>

      </fieldset>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <UnsavedIndicator save={save} />
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : party ? "Save party" : "Add party"}
        </Button>
      </div>
    </form>
  );
}

function DialogField({
  label,
  name,
  errors,
  className,
  children,
}: {
  label: string;
  name: string;
  errors: Record<string, string[]>;
  className?: string;
  children: React.ReactNode;
}) {
  const error = errors[name];
  return (
    <div className={className ? `space-y-1.5 ${className}` : "space-y-1.5"}>
      <Label htmlFor={name}>{label}</Label>
      {children}
      {error ? <p className="text-meta text-danger-strong">{error[0]}</p> : null}
    </div>
  );
}
