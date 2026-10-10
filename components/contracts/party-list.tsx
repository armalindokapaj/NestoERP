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
import { contractsLabel, useContractsTranslations } from "./contracts-text";
import { FormSelect } from "@/components/ui/form-select";

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
  const t = useContractsTranslations();
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
        toast({ title: t("parties.removed", { name: party.name }), tone: "success" });
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
            {t("parties.add")}
          </Button>
        </div>
      ) : null}

      {parties.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={t("parties.emptyTitle")}
          description={t("parties.emptyDescription")}
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
                  <Badge tone="neutral">{contractsLabel(t, "partyRole", party.role, partyRoleLabels[party.role])}</Badge>
                  {party.isPrimaryCounterparty ? (
                    <Badge tone="info">{t("parties.primary")}</Badge>
                  ) : null}
                </div>
              </div>

              <dl className="grid gap-x-4 gap-y-1 text-meta sm:grid-cols-2">
                <Row label={t("parties.type")} value={contractsLabel(t, "partyType", party.type, partyTypeLabels[party.type])} />
                <Row label={t("parties.registration")} value={party.registrationNumber} />
                <Row label={t("parties.taxId")} value={party.taxId} />
                <Row
                  label={t("parties.address")}
                  value={[party.address, party.city, party.country].filter(Boolean).join(", ")}
                />
                <Row label={t("parties.signatory")} value={party.signatoryName} />
                <Row label={t("parties.title")} value={party.signatoryTitle} />
              </dl>

              {canManage || canRemove ? (
                <div className="flex flex-wrap justify-end gap-2">
                  {canManage ? (
                    <Button variant="secondary" size="sm" onClick={() => setEditing(party)}>
                      {t("common.edit")}
                    </Button>
                  ) : null}
                  {canRemove ? (
                    <Button variant="ghost" size="sm" onClick={() => setRemoving(party)}>
                      <Trash2 aria-hidden="true" />
                      {t("parties.remove")}
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
        title={t("parties.removeTitle", { name: removing?.name ?? t("parties.thisParty") })}
        description={t("parties.removeDescription")}
        confirmLabel={t("parties.removeParty")}
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
      <dd className="min-w-0 text-fg [overflow-wrap:anywhere]">{value}</dd>
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
  const t = useContractsTranslations();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{party ? t("parties.editTitle", { name: party.name }) : t("parties.addTitle")}</DialogTitle>
        <DialogDescription>{t("parties.dialogDescription")}</DialogDescription>
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
  const t = useContractsTranslations();
  const toast = useToast();
  const formRef = React.useRef<HTMLFormElement>(null);
  const save = useEditorSave({
    formRef,
    action: (formData: FormData) => saveContractPartyAction(contractId, party?.id ?? null, formData),
    module: "contracts",
    saveKind: party ? "save" : "create",
    label: party ? party.name : t("parties.newParty"),
    onCommitted: () => {
      toast({ title: party ? t("parties.updated") : t("parties.added"), tone: "success" });
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
          <DialogField label={t("parties.role")} name="partyRole" errors={errors}>
            <FormSelect
              id="partyRole"
              name="partyRole"
              className={selectClass}
              defaultValue={party?.role ?? "COUNTERPARTY"}
            >
              {PARTY_ROLES.map((role) => (
                <option key={role} value={role}>
                  {contractsLabel(t, "partyRole", role, partyRoleLabels[role])}
                </option>
              ))}
            </FormSelect>
          </DialogField>

          <DialogField label={t("parties.partyType")} name="partyType" errors={errors}>
            <FormSelect
              id="partyType"
              name="partyType"
              className={selectClass}
              defaultValue={party?.type ?? "COMPANY"}
            >
              {PARTY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {contractsLabel(t, "partyType", type, partyTypeLabels[type])}
                </option>
              ))}
            </FormSelect>
          </DialogField>

          <DialogField label={t("parties.name")} name="name" errors={errors}>
            <Input id="name" name="name" defaultValue={party?.name ?? ""} required maxLength={250} />
          </DialogField>

          <DialogField label={t("parties.legalName")} name="legalName" errors={errors}>
            <Input
              id="legalName"
              name="legalName"
              defaultValue={party?.legalName ?? ""}
              maxLength={250}
            />
          </DialogField>

          <DialogField label={t("parties.registrationNumber")} name="registrationNumber" errors={errors}>
            <Input
              id="registrationNumber"
              name="registrationNumber"
              defaultValue={party?.registrationNumber ?? ""}
              maxLength={80}
            />
          </DialogField>

          <DialogField label={t("parties.taxId")} name="taxId" errors={errors}>
            <Input id="taxId" name="taxId" defaultValue={party?.taxId ?? ""} maxLength={80} />
          </DialogField>

          <DialogField label={t("parties.linkedClient")} name="clientId" errors={errors}>
            <FormSelect
              id="clientId"
              name="clientId"
              className={selectClass}
              defaultValue={party?.clientId ?? ""}
            >
              <option value="">{t("parties.notLinked")}</option>
              {clients.map((client) => (
                <option key={client.value} value={client.value}>
                  {client.label}
                </option>
              ))}
            </FormSelect>
          </DialogField>

          <DialogField label={t("parties.city")} name="city" errors={errors}>
            <Input id="city" name="city" defaultValue={party?.city ?? ""} maxLength={120} />
          </DialogField>

          <DialogField label={t("parties.address")} name="address" errors={errors} className="sm:col-span-2">
            <Input id="address" name="address" defaultValue={party?.address ?? ""} maxLength={500} />
          </DialogField>

          <DialogField label={t("parties.country")} name="country" errors={errors}>
            <Input id="country" name="country" defaultValue={party?.country ?? ""} maxLength={120} />
          </DialogField>

          <DialogField label={t("parties.signatory")} name="signatoryName" errors={errors}>
            <Input
              id="signatoryName"
              name="signatoryName"
              defaultValue={party?.signatoryName ?? ""}
              maxLength={200}
            />
          </DialogField>

          <DialogField label={t("parties.signatoryTitle")} name="signatoryTitle" errors={errors}>
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
          {t("parties.primaryCheckbox")}
        </label>

      </fieldset>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <UnsavedIndicator save={save} />
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            {t("common.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? t("common.saving") : party ? t("parties.save") : t("parties.add")}
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
