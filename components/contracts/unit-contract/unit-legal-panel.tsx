"use client";

import * as React from "react";
import { compareDecimal, previewDecimal, sumDecimal } from "@/lib/modules/finance/finance.decimal";
import Link from "@/components/navigation/nav-link";
import { usePathname } from "next/navigation";
import { useRouter } from "@/components/navigation/guarded-router";
import { FilePen, FileSignature, Scale, Send, Undo2 } from "lucide-react";

import { amountLabel, UnitContractStatusBadge } from "@/components/finance/unit-finance/finance-status";
import { FieldsDialog, today, type Submit } from "@/components/finance/unit-finance/fields-dialog";
import { DetailGrid } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { Field, structureApi } from "@/components/project-structure/structure-ui";
import { FormDialog, requestOutcome, useDialogRequest, useOpenedWith } from "@/components/sales/unit-sales/unit-sales-dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CONTRACT_REQUEST_STATUS_LABELS, type UnitContractAction, type UnitContractDTO, type UnitLegalDTO } from "@/lib/modules/contracts/units/unit-contract.types";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { contractsLabel, useContractsTranslations, type ContractsKey } from "../contracts-text";

/**
 * A unit's Legal section (E-05F §12, §49, §57, §104): the contract that sells
 * the unit, where it stands under the E-05F names, the moves the reader may make
 * on it, Sales' request for it, and every contract the unit has had. The same
 * unit page every module opens. `?action=create` (from Legal's queue) opens the
 * draft dialog when the reader may draft.
 */

type Open = UnitContractAction | "request" | "create" | "decline" | "withdraw" | { value: string } | null;

/** A contract action's button label (English: "Send for review", "Record signature"…). */
const actionKey = (action: UnitContractAction) => `unitLegal.actions.${action}` as ContractsKey;

export function UnitLegalPanel({ legal, documents, initialAction }: { legal: UnitLegalDTO; documents: React.ReactNode; initialAction?: string | null }) {
  const t = useContractsTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const caps = legal.capabilities;
  const contract = legal.contract;
  const request = legal.openRequest;
  const [open, setOpen] = React.useState<Open>(null);

  React.useEffect(() => {
    if (initialAction === "create" && caps.canCreate && !legal.createBlocked) setOpen("create");
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit: Submit = React.useCallback(
    async (url, body, success, method) => {
      await structureApi(url, { method: method ?? "POST", body });
      toast({ title: success });
      // The one-shot `?action=` goes without a navigation: the dialog that just
      // saved is still on screen, and a navigation would ask about it (AUD-03 §5).
      if (initialAction) window.history.replaceState(window.history.state, "", pathname);
      router.refresh();
    },
    [toast, router, pathname, initialAction],
  );

  const close = () => setOpen(null);
  const base = contract ? `/api/contracts/${contract.id}` : "";
  const name = contract ? contract.number : legal.unitCode;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="space-y-4">
        {contract ? (
          <ContractCard contract={contract} legal={legal} onAction={setOpen} onValue={(unitId) => setOpen({ value: unitId })} />
        ) : (
          <section className="nesto-card p-5" aria-labelledby="unit-legal" data-testid="unit-legal-empty">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="unit-legal" className="text-card font-semibold text-fg">
                {t("unitLegal.contract")}
              </h2>
              {request ? <Badge tone="warning">{t("unitLegal.requested")}</Badge> : <Badge>{t("unitLegal.noContract")}</Badge>}
            </div>
            {request ? (
              <div className="mt-3 space-y-2 text-table" data-testid="contract-request">
                <p className="text-fg">
                  {request.requestedBy ? <PersonLink memberId={request.requestedByMemberId} name={request.requestedBy} /> : t("unitLegal.sales")}
                  {t("unitLegal.askedOn", { date: formatDate(request.requestedAt) })}
                  {request.agreedPrice ? t("unitLegal.atAgreed", { amount: amountLabel(request.agreedPrice, request.currency) }) : ""}.
                </p>
                {request.client ? <p className="text-fg-muted">{t("unitLegal.clientLine", { name: request.client.name })}{request.deal ? t("unitLegal.dealLine", { name: request.deal.name }) : ""}</p> : null}
                {request.notes ? <p className="whitespace-pre-line text-fg-muted">{request.notes}</p> : null}
              </div>
            ) : (
              <p className="mt-3 text-table text-fg-muted">
                {caps.canRequest ? (legal.requestBlocked ?? t("unitLegal.askLegal")) : caps.canCreate ? (legal.createBlocked ?? "") : t("unitLegal.noneDrafted")}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4" data-testid="unit-legal-actions">
              {!request && caps.canRequest && !legal.requestBlocked ? (
                <Button onClick={() => setOpen("request")}>
                  <Send aria-hidden="true" /> {t("unitLegal.requestContract")}
                </Button>
              ) : null}
              {request && caps.canCreate && !legal.createBlocked ? (
                <Button onClick={() => setOpen("create")}>
                  <FilePen aria-hidden="true" /> {t("unitLegal.draftContract")}
                </Button>
              ) : null}
              {request && caps.canReview ? (
                <Button variant="secondary" onClick={() => setOpen("decline")}>
                  {t("unitLegal.declineRequest")}
                </Button>
              ) : null}
              {request && caps.canRequest ? (
                <Button variant="secondary" onClick={() => setOpen("withdraw")}>
                  <Undo2 aria-hidden="true" /> {t("unitLegal.withdrawRequest")}
                </Button>
              ) : null}
              {request && legal.createBlocked && caps.canCreate ? <p className="text-meta text-fg-subtle">{legal.createBlocked}</p> : null}
            </div>
          </section>
        )}

        {documents}

        {legal.history.length ? (
          <section className="nesto-card p-5" aria-labelledby="contract-history">
            <h2 id="contract-history" className="text-card font-semibold text-fg">
              {t("unitLegal.earlier")}
            </h2>
            <ul className="mt-3 divide-y divide-line" data-testid="contract-history">
              {legal.history.map((row) => (
                <li key={row.id} className="py-2.5 text-table">
                  <div className="flex flex-wrap items-center gap-2">
                    {caps.canOpenContract ? (
                      <Link href={`/contracts/${row.id}`} className="font-medium text-fg hover:underline">
                        {row.number}
                      </Link>
                    ) : (
                      <span className="font-medium text-fg">{row.number}</span>
                    )}
                    <UnitContractStatusBadge status={row.status} />
                    <span className="ml-auto tabular-nums text-fg-muted">{amountLabel(row.value, row.currency)}</span>
                  </div>
                  <p className="mt-0.5 text-meta text-fg-subtle">
                    {t("unitLegal.drafted", { date: formatDate(row.createdAt) })}
                    {row.units.find((unit) => unit.unitId === legal.unitId)?.releaseReason ? ` · ${row.units.find((unit) => unit.unitId === legal.unitId)!.releaseReason}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <div className="space-y-4 lg:self-start">
        <section className="nesto-card p-5" aria-labelledby="contract-requests">
          <h2 id="contract-requests" className="text-card font-semibold text-fg">
            {t("unitLegal.requests")}
          </h2>
          {legal.requests.length === 0 ? (
            <p className="mt-3 text-table text-fg-muted">{t("unitLegal.noRequests")}</p>
          ) : (
            <ol className="mt-3 divide-y divide-line" data-testid="contract-request-history">
              {legal.requests.map((row) => (
                <li key={row.id} className="py-2 text-table">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={row.status === "OPEN" ? "warning" : row.status === "FULFILLED" ? "success" : "default"}>{contractsLabel(t, "requestStatus", row.status, CONTRACT_REQUEST_STATUS_LABELS[row.status])}</Badge>
                    <span className="text-meta text-fg-subtle">{formatDateTime(row.requestedAt)}</span>
                  </div>
                  <p className="mt-0.5 text-meta text-fg-muted">
                    {row.requestedBy ? <PersonLink memberId={row.requestedByMemberId} name={row.requestedBy} /> : t("unitLegal.sales")}
                    {row.contract ? ` · ${row.contract.number}` : ""}
                  </p>
                  {row.closeReason ? <p className="text-meta text-fg-muted">{row.closeReason}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* Sales asks (§12) */}
      <FieldsDialog open={open === "request"} onClose={close} title={t("unitLegal.requestTitle", { unit: legal.unitCode })} description={t("unitLegal.requestDescription")} confirmLabel={t("unitLegal.requestContract")} url={`/api/project-units/${legal.unitId}/contract-requests`} fields={[{ name: "notes", label: t("unitLegal.notesForLegal"), kind: "textarea", max: 2000 }]} success={t("unitLegal.requestSent")} submit={submit} testId="request-contract-dialog" />
      {request ? (
        <>
          <FieldsDialog open={open === "decline"} onClose={close} title={t("unitLegal.declineTitle")} description={t("unitLegal.declineDescription")} confirmLabel={t("common.decline")} url={`/api/contracts/requests/${request.id}/decline`} fields={[{ name: "reason", label: t("common.reason"), kind: "textarea", required: true }]} success={t("unitLegal.declined")} submit={submit} testId="decline-request-dialog" />
          <FieldsDialog open={open === "withdraw"} onClose={close} title={t("unitLegal.withdrawTitle")} description={t("unitLegal.withdrawDescription")} confirmLabel={t("unitLegal.withdraw")} url={`/api/contracts/requests/${request.id}/withdraw`} fields={[]} success={t("unitLegal.withdrawn")} submit={submit} />
          <CreateContractDialog open={open === "create"} onClose={close} legal={legal} submit={submit} />
        </>
      ) : null}

      {contract ? (
        <>
          <FieldsDialog open={open === "submit_review"} onClose={close} title={t("unitLegal.reviewTitle", { name })} confirmLabel={t(actionKey("submit_review"))} url={`${base}/submit-review`} fields={[]} success={t("unitLegal.underReview", { name })} submit={submit} />
          <FieldsDialog open={open === "submit_approval"} onClose={close} title={t("unitLegal.approvalTitle", { name })} description={t("unitLegal.approvalDescription")} confirmLabel={t(actionKey("submit_approval"))} url={`${base}/submit-approval`} fields={[]} success={t("unitLegal.waitingApproval", { name })} submit={submit} />
          <FieldsDialog open={open === "return_to_draft"} onClose={close} title={t("unitLegal.returnTitle", { name })} confirmLabel={t(actionKey("return_to_draft"))} url={`${base}/return-draft`} fields={[{ name: "note", label: t("common.note"), kind: "textarea" }]} success={t("unitLegal.draftAgain", { name })} submit={submit} />
          <FieldsDialog open={open === "mark_sent"} onClose={close} title={t("unitLegal.sentTitle", { name })} confirmLabel={t("common.markSent")} url={`${base}/mark-sent`} fields={[]} success={t("unitLegal.outForSignature", { name })} submit={submit} />
          <FieldsDialog
            open={open === "mark_signed"}
            onClose={close}
            title={t("unitLegal.signTitle", { name })}
            description={contract.documentCount === 0 ? t("unitLegal.noSignedDocument") : undefined}
            confirmLabel={t(actionKey("mark_signed"))}
            url={`${base}/mark-signed`}
            fields={[
              { name: "signedDate", label: t("unitLegal.signedOn"), kind: "date", required: true, initial: today() },
              ...(contract.documentCount === 0 ? [{ name: "acknowledgeMissingDocument", label: t("unitLegal.withoutDocument"), kind: "checkbox" as const, hint: t("unitLegal.withoutDocumentHint") }] : []),
            ]}
            success={t("unitLegal.isSigned", { name })}
            submit={submit}
            testId="sign-contract-dialog"
          />
          <FieldsDialog open={open === "activate"} onClose={close} title={t("unitLegal.activateTitle", { name })} description={t("unitLegal.activateDescription")} confirmLabel={t(actionKey("activate"))} url={`${base}/activate`} fields={[{ name: "effectiveDate", label: t("unitLegal.effectiveFrom"), kind: "date", required: true, initial: today() }]} success={t("unitLegal.isActive", { name })} submit={submit} />
          <FieldsDialog open={open === "complete"} onClose={close} title={t("unitLegal.completeTitle", { name })} description={t("unitLegal.completeDescription")} confirmLabel={t(actionKey("complete"))} url={`${base}/complete`} fields={[]} success={t("unitLegal.isCompleted", { name })} submit={submit} />
          <FieldsDialog open={open === "cancel"} onClose={close} title={t("unitLegal.cancelTitle", { name })} description={t("unitLegal.releaseDescription")} confirmLabel={t(actionKey("cancel"))} url={`${base}/cancel`} fields={[{ name: "note", label: t("common.reason"), kind: "textarea", required: true }]} success={t("unitLegal.wasCancelled", { name })} submit={submit} testId="cancel-contract-dialog" />
          <FieldsDialog open={open === "terminate"} onClose={close} title={t("unitLegal.terminateTitle", { name })} description={t("unitLegal.releaseDescription")} confirmLabel={t(actionKey("terminate"))} url={`${base}/terminate`} fields={[{ name: "terminationDate", label: t("unitLegal.terminatedOn"), kind: "date", required: true, initial: today() }, { name: "terminationReason", label: t("common.reason"), kind: "textarea", required: true }]} success={t("unitLegal.wasTerminated", { name })} submit={submit} />
          {typeof open === "object" && open !== null ? <UnitValueDialog onClose={close} contract={contract} unitId={open.value} submit={submit} /> : null}
        </>
      ) : null}
    </div>
  );
}

function ContractCard({ contract, legal, onAction, onValue }: { contract: UnitContractDTO; legal: UnitLegalDTO; onAction: (action: UnitContractAction) => void; onValue: (unitId: string) => void }) {
  const t = useContractsTranslations();
  const caps = legal.capabilities;
  const editable = caps.canUpdate && caps.canSeeValue && (contract.status === "DRAFT" || contract.status === "IN_REVIEW");
  const amendable = caps.canAmend && ["APPROVED", "SENT", "SIGNED", "ACTIVE"].includes(contract.status);
  return (
    <section className="nesto-card p-5" aria-labelledby="unit-contract" data-testid="unit-contract">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="unit-contract" className="text-card font-semibold text-fg">
          {t("unitLegal.contract")}
        </h2>
        <UnitContractStatusBadge status={contract.status} />
        {contract.pendingApproval ? (
          <Link href={`/approvals?record=${encodeURIComponent(`contract:${contract.id}`)}`} className="text-meta text-accent hover:underline">
            {t("unitLegal.waitingApprovals")}
          </Link>
        ) : null}
      </div>
      <DetailGrid
        className="mt-4"
        items={[
          {
            label: t("unitLegal.contract"),
            value: caps.canOpenContract ? (
              <Link href={`/contracts/${contract.id}`} className="font-medium hover:underline" data-testid="contract-number">
                {contract.number}
              </Link>
            ) : (
              <span data-testid="contract-number">{contract.number}</span>
            ),
          },
          { label: t("unitLegal.client"), value: contract.client ? <Link href={`/clients/${contract.client.id}`} className="hover:underline">{contract.client.name}</Link> : t("unitLegal.hidden") },
          { label: t("unitLegal.deal"), value: contract.deal ? <Link href={`/sales/opportunities/${contract.deal.id}`} className="hover:underline">{contract.deal.name}</Link> : t("unitLegal.hidden") },
          ...(caps.canSeeValue ? [{ label: t("unitLegal.contractValue"), value: <span className="tabular-nums" data-testid="contract-value">{amountLabel(contract.value, contract.currency)}</span> }] : []),
          { label: t("unitLegal.signed"), value: contract.signedDate ? formatDate(contract.signedDate) : t("unitLegal.notYet") },
          { label: t("unitLegal.effective"), value: contract.effectiveDate ? formatDate(contract.effectiveDate) : "—" },
          { label: t("unitLegal.owner"), value: contract.owner ? <PersonLink memberId={contract.ownerMemberId} name={contract.owner} /> : "—" },
          ...(contract.createdBy ? [{ label: t("unitLegal.createdBy"), value: <span><PersonLink memberId={contract.createdBy.memberId} name={contract.createdBy.name} /> · {formatDate(contract.createdAt)}</span> }] : []),
          ...(contract.updatedBy ? [{ label: t("unitLegal.updatedBy"), value: <span><PersonLink memberId={contract.updatedBy.memberId} name={contract.updatedBy.name} /> · {formatDate(contract.updatedAt)}</span> }] : []),
          ...(contract.completedAt ? [{ label: t("unitLegal.completed"), value: formatDate(contract.completedAt) }] : []),
        ]}
      />

      <div className="mt-4">
        <p className="nesto-eyebrow text-fg-subtle">{t("unitLegal.unitsOnContract")}</p>
        <ul className="mt-2 divide-y divide-line rounded-md border border-line" data-testid="contract-units">
          {contract.units.map((unit) => (
            <li key={unit.unitId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-table">
              <span className="font-medium text-fg">{unit.unitCode}</span>
              {unit.unitId === legal.unitId ? <Badge>{t("unitLegal.thisUnit")}</Badge> : null}
              {unit.released ? <Badge>{t("unitLegal.released")}</Badge> : null}
              <span className="ml-auto tabular-nums text-fg-muted">{caps.canSeeValue ? amountLabel(unit.value, contract.currency) : ""}</span>
              {editable && !unit.released ? (
                <Button size="sm" variant="ghost" onClick={() => onValue(unit.unitId)}>
                  {t("unitLegal.changeValue")}
                </Button>
              ) : null}
              {unit.valueNote ? <p className="w-full text-meta text-fg-subtle">{unit.valueNote}</p> : null}
            </li>
          ))}
        </ul>
      </div>

      {contract.actions.length || amendable ? (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4" data-testid="unit-contract-actions">
          {contract.actions.map((action) => (
            <Button key={action} variant={action === "cancel" || action === "terminate" || action === "return_to_draft" ? "secondary" : "primary"} onClick={() => onAction(action)}>
              {action === "mark_signed" ? <FileSignature aria-hidden="true" /> : action === "complete" ? <Scale aria-hidden="true" /> : null}
              {t(actionKey(action))}
            </Button>
          ))}
          {amendable ? (
            <Button asChild variant="secondary">
              <Link href={`/contracts/${contract.id}/amendments/new`}>{t("unitLegal.newAmendment")}</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Legal drafts the contract from Sales' request, with other units of the same client and deal (§12, §14, §88-§90). */
function CreateContractDialog({ open, onClose, legal, submit }: { open: boolean; onClose: () => void; legal: UnitLegalDTO; submit: Submit }) {
  const t = useContractsTranslations();
  const request = useDialogRequest((url, body, success) => submit(url, body, success));
  const agreed = legal.defaults.agreedPrice ?? "";
  const [number, setNumber] = React.useState("");
  const [title, setTitle] = React.useState(legal.defaults.title);
  const [chosen, setChosen] = React.useState<Record<string, boolean>>({});
  const [values, setValues] = React.useState<Record<string, { value: string; note: string }>>({});

  React.useEffect(() => {
    if (!open) return;
    setNumber("");
    setTitle(legal.defaults.title);
    setChosen(Object.fromEntries(legal.candidates.map((row) => [row.unitId, row.hasOpenRequest])));
    setValues(Object.fromEntries([[legal.unitId, { value: agreed, note: "" }], ...legal.candidates.map((row) => [row.unitId, { value: row.agreedPrice ?? "", note: "" }])]));
    request.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const changed = useOpenedWith(open, [number, title, chosen, values]);
  const rows = [{ unitId: legal.unitId, unitCode: legal.unitCode, agreedPrice: legal.defaults.agreedPrice, primary: true }, ...legal.candidates.filter((row) => chosen[row.unitId]).map((row) => ({ unitId: row.unitId, unitCode: row.unitCode, agreedPrice: row.agreedPrice, primary: false }))];
  // Exact (AUD-09 §4, FV-06), and a row left empty counts at its agreed price —
  // as the server does — rather than as 0. "1 000,50" is read, not NaN.
  const total = sumDecimal(rows.map((row) => previewDecimal(values[row.unitId]?.value ?? "", 2) ?? row.agreedPrice ?? "0"), 2);

  /** A draft is an ordinary create: its button and "Save and continue" draft it the same way (AUD-03 §3). */
  function draft(): Promise<unknown> {
    const body = {
      ...(legal.defaults.autoNumber ? {} : { contractNumber: number }),
      title,
      additionalUnitIds: rows.filter((row) => !row.primary).map((row) => row.unitId),
      values: rows.filter((row) => values[row.unitId]?.value && values[row.unitId]!.value !== row.agreedPrice).map((row) => ({ unitId: row.unitId, value: values[row.unitId]!.value, valueNote: values[row.unitId]!.note || null })),
    };
    return request.send(`/api/project-units/${legal.unitId}/contracts`, body, t("unitLegal.isDrafted"));
  }

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t("unitLegal.draftTitle", { unit: legal.unitCode })}
      description={t("unitLegal.draftDescription")}
      confirmLabel={t("unitLegal.draftContract")}
      pending={request.pending}
      error={request.error}
      testId="create-contract-dialog"
      wide
      dirty={changed && !request.done}
      unresolved={request.unresolved}
      save={{ kind: "create", run: async () => requestOutcome(await draft()) }}
      onSubmit={() => void draft().then((failed) => (failed ? null : onClose()))}
    >
      {legal.defaults.autoNumber ? (
        <p className="text-meta text-fg-subtle">{t("unitLegal.autoNumber")}</p>
      ) : (
        <Field label={t("unitLegal.contractNumber")} htmlFor="contract-number" required error={request.fields.contractNumber}>
          <Input id="contract-number" value={number} maxLength={80} onChange={(event) => setNumber(event.target.value)} />
        </Field>
      )}
      <Field label={t("unitLegal.title")} htmlFor="contract-title" error={request.fields.title}>
        <Input id="contract-title" value={title} maxLength={250} onChange={(event) => setTitle(event.target.value)} />
      </Field>
      {legal.candidates.length ? (
        <fieldset className="space-y-2">
          <legend className="text-meta font-medium text-fg-muted">{t("unitLegal.alsoSell")}</legend>
          {legal.candidates.map((row) => (
            <label key={row.unitId} className="flex items-center gap-2 text-table" htmlFor={`candidate-${row.unitId}`}>
              <Checkbox id={`candidate-${row.unitId}`} checked={Boolean(chosen[row.unitId])} onCheckedChange={(checked) => setChosen((current) => ({ ...current, [row.unitId]: checked === true }))} />
              <span className="font-medium text-fg">{row.unitCode}</span>
              <span className="text-fg-muted">{row.unitType}</span>
              <span className="ml-auto tabular-nums text-fg-muted">{amountLabel(row.agreedPrice, row.currency)}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="space-y-3">
        {rows.map((row) => {
          const value = values[row.unitId] ?? { value: "", note: "" };
          const typed = previewDecimal(value.value, 2);
          const differs = typed !== null && row.agreedPrice !== null && compareDecimal(typed, row.agreedPrice) !== 0;
          return (
            <div key={row.unitId} className="rounded-md border border-line p-3">
              <Field label={t("unitLegal.unitValue", { unit: row.unitCode })} htmlFor={`value-${row.unitId}`} hint={t("unitLegal.agreedPrice", { amount: amountLabel(row.agreedPrice, legal.defaults.currency) })} error={request.fields.values}>
                <Input id={`value-${row.unitId}`} inputMode="decimal" value={value.value} onChange={(event) => setValues((current) => ({ ...current, [row.unitId]: { ...value, value: event.target.value } }))} />
              </Field>
              {differs ? (
                <Field label={t("unitLegal.whyDiffers")} htmlFor={`note-${row.unitId}`} required className="mt-2">
                  <Textarea id={`note-${row.unitId}`} rows={2} value={value.note} onChange={(event) => setValues((current) => ({ ...current, [row.unitId]: { ...value, note: event.target.value } }))} />
                </Field>
              ) : null}
            </div>
          );
        })}
        <p className="text-right text-table font-medium text-fg" data-testid="contract-total">
          {t("unitLegal.totalPreview", { amount: amountLabel(total, legal.defaults.currency) })}
        </p>
      </div>
    </FormDialog>
  );
}

function UnitValueDialog({ onClose, contract, unitId, submit }: { onClose: () => void; contract: UnitContractDTO; unitId: string; submit: Submit }) {
  const t = useContractsTranslations();
  const unit = contract.units.find((row) => row.unitId === unitId);
  return (
    <FieldsDialog
      open
      onClose={onClose}
      title={t("unitLegal.changeUnitValue", { unit: unit?.unitCode ?? t("unitLegal.theUnit") })}
      description={t("unitLegal.valueDescription")}
      confirmLabel={t("unitLegal.saveValue")}
      url={`/api/contracts/${contract.id}/units/${unitId}`}
      method="PATCH"
      fields={[
        { name: "value", label: t("unitLegal.value"), kind: "text", required: true, initial: unit?.value ?? "" },
        { name: "valueNote", label: t("unitLegal.whyDiffers"), kind: "textarea", initial: unit?.valueNote ?? "" },
      ]}
      success={t("unitLegal.valueChanged")}
      submit={submit}
      saveKind="save"
    />
  );
}
