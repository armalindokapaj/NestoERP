"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Banknote, CalendarRange, FileText, MoreHorizontal, Plus, Receipt, Trash2 } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Field, isFailure, structureApi } from "@/components/project-structure/structure-ui";
import { FormDialog, useDialogRequest } from "@/components/sales/unit-sales/unit-sales-dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { PAYMENT_METHODS } from "@/lib/modules/finance/payments/payment.schema";
import { INSTALLMENT_TYPE_LABELS, INSTALLMENT_TYPES, type ContractPaymentDTO, type InstallmentDTO, type ScheduleDTO, type UnitFinanceDTO } from "@/lib/modules/finance/units/unit-finance.types";
import { formatDate } from "@/lib/utils/format";
import { FieldsDialog, today, type Submit } from "./fields-dialog";
import { amountLabel, FinancialStatusBadge, InstallmentStatusBadge, ScheduleStatusBadge, UnitContractStatusBadge } from "./finance-status";

/**
 * A unit's Finance section (E-05F §39, §50, §59-§63, §104): what the sale's
 * contract is worth, what is paid, outstanding and overdue, the payment schedule
 * and its versions, payments and what each settles, invoices for installments,
 * and proof of payment. The figures are the contract's; a contract selling this
 * unit with its parking shows the same balance on both (§91). Nothing here
 * decides — the server refuses what does not fit and says why.
 */

type Open =
  | { kind: "schedule"; schedule: ScheduleDTO | null; copy: boolean }
  | { kind: "activate"; schedule: ScheduleDTO }
  | { kind: "discard"; schedule: ScheduleDTO }
  | { kind: "invoice"; installment: InstallmentDTO }
  | { kind: "record" }
  | { kind: "allocate"; payment: ContractPaymentDTO }
  | { kind: "reverse"; allocationId: string; label: string }
  | { kind: "void"; payment: ContractPaymentDTO }
  | null;

const METHOD_LABELS: Record<string, string> = { BANK_TRANSFER: "Bank transfer", CARD: "Card", CASH: "Cash", CHECK: "Cheque", OTHER: "Other" };

export function UnitFinancePanel({ finance }: { finance: UnitFinanceDTO }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const caps = finance.capabilities;
  const summary = finance.summary;
  const contract = summary.contract;
  const currency = contract?.currency ?? finance.schedules[0]?.currency ?? "EUR";
  const [open, setOpen] = React.useState<Open>(null);
  const close = () => setOpen(null);

  const submit: Submit = React.useCallback(
    async (url, body, success, method) => {
      await structureApi(url, { method: method ?? "POST", body });
      toast({ title: success });
      router.replace(pathname, { scroll: false });
      router.refresh();
    },
    [toast, router, pathname],
  );

  const current = finance.schedules.find((row) => row.status === "ACTIVE" || row.status === "COMPLETED") ?? null;
  const draft = finance.schedules.find((row) => row.status === "DRAFT") ?? null;
  const older = finance.schedules.filter((row) => row !== current && row !== draft);
  const live = Boolean(contract);
  const collecting = live && ["SIGNED", "ACTIVE", "COMPLETED"].includes(contract!.status);
  const openInstallments = (current?.status === "ACTIVE" ? current.installments : []).filter((row) => Number(row.outstandingAmount) > 0);

  return (
    <div className="space-y-4">
      <section className="nesto-card p-5" aria-labelledby="unit-finance-summary" data-testid="unit-finance-summary">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="unit-finance-summary" className="text-card font-semibold text-fg">
            Finance
          </h2>
          <FinancialStatusBadge status={summary.financialStatus} />
          {contract ? (
            <span className="flex items-center gap-1.5 text-meta text-fg-subtle">
              Contract {contract.number} <UnitContractStatusBadge status={contract.status} />
            </span>
          ) : null}
        </div>
        {contract ? (
          <>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Figure label="Contract value" testId="finance-contract-value" value={amountLabel(contract.value, currency)} strong />
              <Figure label="Paid" testId="finance-paid" value={amountLabel(summary.paidAmount, currency)} />
              <Figure label="Outstanding" testId="finance-outstanding" value={amountLabel(summary.outstandingAmount, currency)} strong />
              <Figure label="Overdue" testId="finance-overdue" value={amountLabel(summary.overdueAmount, currency)} danger={Number(summary.overdueAmount) > 0} />
            </dl>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="nesto-eyebrow text-fg-subtle">Next payment</p>
                <p className="mt-1 text-body text-fg" data-testid="finance-next-due">
                  {summary.nextDue ? `${amountLabel(summary.nextDue.amount, currency)} · ${summary.nextDue.label}, due ${formatDate(summary.nextDue.dueDate)}` : "Nothing due"}
                </p>
              </div>
              <div>
                <p className="nesto-eyebrow text-fg-subtle">Payment progress</p>
                <div className="mt-2 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(summary.progressPercent ?? 0)} aria-label="Payment progress">
                    <div className="h-full rounded-full bg-success" style={{ width: `${Math.min(100, Number(summary.progressPercent ?? 0))}%` }} />
                  </div>
                  <span className="tabular-nums text-table text-fg" data-testid="finance-progress">
                    {summary.progressPercent ?? "0.0"}%
                  </span>
                </div>
              </div>
            </div>
            {Number(summary.unallocatedAmount) > 0 ? (
              <p className="mt-4 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-table text-warning-strong" data-testid="finance-unallocated">
                {amountLabel(summary.unallocatedAmount, currency)} received and not yet allocated to an installment. Finance reviews it.
              </p>
            ) : null}
            {summary.sharedWithUnits.length ? (
              <p className="mt-3 text-meta text-fg-subtle">
                The same contract sells {summary.sharedWithUnits.map((unit) => unit.unitCode).join(", ")}; these figures are the contract&apos;s.
              </p>
            ) : null}
            {caps.canRecordPayment && collecting ? (
              <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4" data-testid="unit-finance-actions">
                <Button onClick={() => setOpen({ kind: "record" })}>
                  <Banknote aria-hidden="true" /> Record payment
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-3 text-table text-fg-muted" data-testid="finance-no-contract">
            {finance.schedules.length ? "This unit's contract is no longer in force. Its schedule and payments are kept below." : "No contract yet. Finance follows the unit once Legal drafts its contract."}
          </p>
        )}
      </section>

      {live || finance.schedules.length ? (
        <section className="nesto-card p-5" aria-labelledby="payment-schedule" data-testid="payment-schedule">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="payment-schedule" className="text-card font-semibold text-fg">
              Payment schedule
            </h2>
            {current ? <ScheduleStatusBadge status={current.status} /> : null}
            {current ? <span className="text-meta text-fg-subtle">v{current.versionNumber}</span> : null}
            <div className="ml-auto flex flex-wrap gap-2">
              {caps.canManageSchedule && live && !draft ? (
                <Button size="sm" variant={current ? "secondary" : "primary"} onClick={() => setOpen({ kind: "schedule", schedule: null, copy: Boolean(current) })}>
                  <CalendarRange aria-hidden="true" /> {current ? "Revise schedule" : "Create schedule"}
                </Button>
              ) : null}
            </div>
          </div>
          {current ? (
            <InstallmentTable schedule={current} currency={currency} canInvoice={caps.canIssueInvoice && live && current.status === "ACTIVE"} onInvoice={(installment) => setOpen({ kind: "invoice", installment })} />
          ) : (
            <p className="mt-3 text-table text-fg-muted">{draft ? "The schedule is being drafted." : "No schedule is in force."}</p>
          )}
          {current?.totalExceptionReason ? <p className="mt-3 text-meta text-fg-muted">Total differs from the contract by decision: {current.totalExceptionReason}</p> : null}

          {draft ? (
            <div className="mt-5 rounded-md border border-dashed border-line-strong p-4" data-testid="schedule-draft">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-fg">Draft v{draft.versionNumber}</p>
                <ScheduleStatusBadge status="DRAFT" />
                <span className="text-meta text-fg-subtle">
                  Total {amountLabel(draft.total, currency)}
                  {finance.scheduleTarget ? ` · the contract needs ${amountLabel(finance.scheduleTarget, currency)}` : ""}
                </span>
              </div>
              <InstallmentTable schedule={draft} currency={currency} canInvoice={false} onInvoice={() => undefined} />
              {caps.canManageSchedule ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setOpen({ kind: "activate", schedule: draft })} disabled={!finance.contractStatusAllowsActivation}>
                    Activate
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setOpen({ kind: "schedule", schedule: draft, copy: false })}>
                    Edit draft
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setOpen({ kind: "discard", schedule: draft })}>
                    <Trash2 aria-hidden="true" /> Discard
                  </Button>
                  {!finance.contractStatusAllowsActivation ? <p className="text-meta text-fg-subtle">A schedule is activated once the contract is signed.</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {older.length ? (
            <details className="mt-5">
              <summary className="cursor-pointer text-table font-medium text-fg-muted">Earlier versions ({older.length})</summary>
              <div className="mt-3 space-y-4">
                {older.map((schedule) => (
                  <div key={schedule.id}>
                    <p className="flex items-center gap-2 text-table text-fg">
                      v{schedule.versionNumber} <ScheduleStatusBadge status={schedule.status} />
                      <span className="text-meta text-fg-subtle">
                        {schedule.supersededAt ? `superseded ${formatDate(schedule.supersededAt)}` : schedule.cancelledAt ? `cancelled ${formatDate(schedule.cancelledAt)}` : ""}
                      </span>
                    </p>
                    <InstallmentTable schedule={schedule} currency={currency} canInvoice={false} onInvoice={() => undefined} />
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </section>
      ) : null}

      {caps.canSeePayments && (live || finance.payments.length) ? (
        <section className="nesto-card p-5" aria-labelledby="unit-payments" data-testid="unit-payments">
          <h2 id="unit-payments" className="text-card font-semibold text-fg">
            Payments
          </h2>
          {finance.payments.length === 0 ? (
            <p className="mt-3 text-table text-fg-muted">No payment has been recorded against this contract.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {finance.payments.map((payment) => (
                <li key={payment.id} className="py-3 text-table" data-testid="payment-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={payment.status === "VOIDED" ? "font-medium tabular-nums text-fg-subtle line-through" : "font-medium tabular-nums text-fg"}>{amountLabel(payment.amount, payment.currency)}</span>
                    <span className="text-fg-muted">
                      {formatDate(payment.paymentDate)} · {METHOD_LABELS[payment.method] ?? payment.method}
                      {payment.reference ? ` · ${payment.reference}` : ""}
                    </span>
                    {payment.status === "VOIDED" ? <Badge>Voided</Badge> : Number(payment.unallocatedAmount) > 0 ? <Badge tone="warning">{amountLabel(payment.unallocatedAmount, payment.currency)} unallocated</Badge> : null}
                    <PaymentMenu payment={payment} caps={caps} onOpen={setOpen} />
                  </div>
                  {payment.allocations.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {payment.allocations.map((allocation) => (
                        <li key={allocation.id} className="flex flex-wrap items-center gap-2 text-meta text-fg-muted">
                          <span className={allocation.reversed ? "line-through" : undefined}>
                            {amountLabel(allocation.amount, payment.currency)} → {allocation.label}
                          </span>
                          {allocation.reversed ? <span>reversed{allocation.reversalReason ? `: ${allocation.reversalReason}` : ""}</span> : null}
                          {!allocation.reversed && payment.status === "RECORDED" && caps.canCorrect ? (
                            <button type="button" className="text-accent hover:underline" onClick={() => setOpen({ kind: "reverse", allocationId: allocation.id, label: allocation.label })}>
                              Reverse
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {payment.voidReason ? <p className="mt-1 text-meta text-fg-muted">Voided: {payment.voidReason}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {caps.canSeeInvoices && finance.invoices.length ? (
        <section className="nesto-card p-5" aria-labelledby="unit-invoices" data-testid="unit-invoices">
          <h2 id="unit-invoices" className="text-card font-semibold text-fg">
            Invoices
          </h2>
          <ul className="mt-3 divide-y divide-line">
            {finance.invoices.map((invoice) => (
              <li key={invoice.id} className="flex flex-wrap items-center gap-2 py-2.5 text-table">
                <Link href={`/finance/invoices/${invoice.id}`} className="font-medium text-fg hover:underline">
                  {invoice.invoiceNumber}
                </Link>
                <Badge>{invoice.status.charAt(0) + invoice.status.slice(1).toLowerCase().replace(/_/g, " ")}</Badge>
                <span className="text-fg-muted">{invoice.installmentLabel ?? ""} · due {formatDate(invoice.dueDate)}</span>
                <span className="ml-auto tabular-nums text-fg-muted">
                  {amountLabel(invoice.paidAmount, currency)} of {amountLabel(invoice.totalAmount, currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {caps.canSeeDocuments && finance.payments.length ? (
        <section className="nesto-card p-5" aria-labelledby="finance-documents" data-testid="finance-documents">
          <h2 id="finance-documents" className="text-card font-semibold text-fg">
            Proof of payment
          </h2>
          {finance.documents.length === 0 ? (
            <p className="mt-3 text-table text-fg-muted">No file is attached to a payment yet.{caps.canManageDocuments ? " Attach one from a payment's menu." : ""}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {finance.documents.map((document) => {
                const payment = finance.payments.find((row) => row.id === document.paymentId);
                return (
                  <li key={document.id} className="flex flex-wrap items-center gap-2 py-2 text-table">
                    <FileText className="size-4 text-fg-subtle" aria-hidden="true" />
                    <Link href={`/documents/${document.id}`} className="font-medium text-fg hover:underline">
                      {document.name}
                    </Link>
                    <span className="text-meta text-fg-subtle">{payment ? `${amountLabel(payment.amount, payment.currency)} · ${formatDate(payment.paymentDate)}` : ""}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {open?.kind === "schedule" ? <ScheduleDialog onClose={close} finance={finance} schedule={open.schedule} copyFrom={open.copy ? current : null} submit={submit} /> : null}
      {open?.kind === "activate" ? <ActivateDialog onClose={close} finance={finance} schedule={open.schedule} submit={submit} /> : null}
      {open?.kind === "discard" ? (
        <FieldsDialog open onClose={close} title={`Discard draft v${open.schedule.versionNumber}?`} description="It is kept as cancelled; nothing in force changes." confirmLabel="Discard" url={`/api/finance/payment-schedules/${open.schedule.id}/discard`} body={{ expectedVersion: open.schedule.version }} fields={[{ name: "reason", label: "Reason", kind: "textarea" }]} success="The draft was discarded." submit={submit} />
      ) : null}
      {open?.kind === "invoice" ? (
        <FieldsDialog
          open
          onClose={close}
          title={`Raise the invoice for ${open.installment.label}`}
          description={`A draft invoice for ${amountLabel(open.installment.amount, currency)}, billing the contract's client. It goes through Finance's approval before it is sent.`}
          confirmLabel="Raise invoice"
          url={`/api/finance/installments/${open.installment.id}/invoice`}
          fields={[
            { name: "issueDate", label: "Issue date", kind: "date", required: true, initial: today() },
            { name: "dueDate", label: "Due date", kind: "date", required: true, initial: open.installment.dueDate.slice(0, 10) < today() ? today() : open.installment.dueDate.slice(0, 10) },
          ]}
          success="The invoice was raised as a draft."
          submit={submit}
          testId="issue-invoice-dialog"
        />
      ) : null}
      {open?.kind === "record" && contract ? <PaymentDialog onClose={close} contractId={contract.id} currency={currency} installments={openInstallments} canAllocate={caps.canAllocate} submit={submit} /> : null}
      {open?.kind === "allocate" ? <AllocateDialog onClose={close} payment={open.payment} installments={openInstallments} submit={submit} /> : null}
      {open?.kind === "reverse" ? (
        <FieldsDialog open onClose={close} title="Reverse this allocation?" description={`The money goes back to being unallocated on its payment; ${open.label} owes it again. The allocation stays in the history.`} confirmLabel="Reverse" url={`/api/finance/payment-allocations/${open.allocationId}/reverse`} fields={[{ name: "reason", label: "Reason", kind: "textarea", required: true }]} success="The allocation was reversed." submit={submit} />
      ) : null}
      {open?.kind === "void" ? (
        <FieldsDialog open onClose={close} title={`Void the payment of ${amountLabel(open.payment.amount, open.payment.currency)}?`} description="It stays on record and stops counting, with everything it was allocated to. Money received again is recorded as a new payment." confirmLabel="Void payment" url={`/api/finance/payments/${open.payment.id}/void`} fields={[{ name: "reason", label: "Reason", kind: "textarea", required: true }]} success="The payment was voided." submit={submit} testId="void-payment-dialog" />
      ) : null}
    </div>
  );
}

function Figure({ label, value, strong, danger, testId }: { label: string; value: string; strong?: boolean; danger?: boolean; testId?: string }) {
  return (
    <div className="min-w-0">
      <dt className="nesto-eyebrow text-fg-subtle">{label}</dt>
      <dd className={`mt-1 tabular-nums ${strong ? "text-page font-semibold" : "text-body"} ${danger ? "text-danger-strong" : "text-fg"}`} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function PaymentMenu({ payment, caps, onOpen }: { payment: ContractPaymentDTO; caps: UnitFinanceDTO["capabilities"]; onOpen: (open: Open) => void }) {
  const allocate = payment.status === "RECORDED" && caps.canAllocate && Number(payment.unallocatedAmount) > 0;
  const voidable = payment.status === "RECORDED" && caps.canVoidPayment;
  const attach = payment.status === "RECORDED" && caps.canManageDocuments && caps.canSeeDocuments;
  if (!allocate && !voidable && !attach) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Payment actions" className="ml-auto">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {allocate ? <DropdownMenuItem onSelect={() => onOpen({ kind: "allocate", payment })}>Allocate</DropdownMenuItem> : null}
        {attach ? (
          <DropdownMenuItem asChild>
            <Link href={`/documents/new?entityType=payment&entityId=${encodeURIComponent(payment.id)}`}>Attach proof</Link>
          </DropdownMenuItem>
        ) : null}
        {voidable ? <DropdownMenuItem onSelect={() => onOpen({ kind: "void", payment })}>Void payment</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InstallmentTable({ schedule, currency, canInvoice, onInvoice }: { schedule: ScheduleDTO; currency: string; canInvoice: boolean; onInvoice: (installment: InstallmentDTO) => void }) {
  const invoice = (row: InstallmentDTO) =>
    row.invoice ? (
      <Link href={`/finance/invoices/${row.invoice.id}`} className="text-accent hover:underline">
        {row.invoice.invoiceNumber}
      </Link>
    ) : canInvoice && row.status !== "PAID" ? (
      <Button size="sm" variant="ghost" onClick={() => onInvoice(row)}>
        <Receipt aria-hidden="true" /> Raise invoice
      </Button>
    ) : null;
  return (
    <>
      <div className="mt-3 hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[40rem] text-table" data-testid="installments">
          <thead>
            <tr className="border-b border-line text-left text-meta text-fg-subtle">
              <th className="py-2 pr-3 font-medium">#</th>
              <th className="py-2 pr-3 font-medium">Installment</th>
              <th className="py-2 pr-3 font-medium">Due</th>
              <th className="py-2 pr-3 text-right font-medium">Amount</th>
              <th className="py-2 pr-3 text-right font-medium">Paid</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 font-medium">Invoice</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {schedule.installments.map((row) => (
              <tr key={row.id} data-testid="installment-row">
                <td className="py-2 pr-3 tabular-nums text-fg-subtle">{row.sequence}</td>
                <td className="py-2 pr-3">
                  <span className="font-medium text-fg">{row.label}</span>
                  <span className="block text-meta text-fg-subtle">{INSTALLMENT_TYPE_LABELS[row.type]}</span>
                </td>
                <td className="py-2 pr-3 text-fg-muted">{formatDate(row.dueDate)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-fg">{amountLabel(row.amount, currency)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-fg-muted">{amountLabel(row.paidAmount, currency)}</td>
                <td className="py-2 pr-3">
                  <InstallmentStatusBadge status={row.status} />
                </td>
                <td className="py-2">{invoice(row) ?? <span className="text-fg-subtle">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* On a phone each installment reads as one block: nothing scrolls out of sight. */}
      <ul className="mt-3 divide-y divide-line sm:hidden" data-testid="installment-cards">
        {schedule.installments.map((row) => (
          <li key={row.id} className="py-2.5 text-table" data-testid="installment-card">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-fg">{row.label}</span>
              <InstallmentStatusBadge status={row.status} />
              <span className="ml-auto tabular-nums text-fg">{amountLabel(row.amount, currency)}</span>
            </div>
            <p className="mt-0.5 text-meta text-fg-subtle">
              Due {formatDate(row.dueDate)} · paid {amountLabel(row.paidAmount, currency)}
            </p>
            {invoice(row) ? <div className="mt-1">{invoice(row)}</div> : null}
          </li>
        ))}
      </ul>
    </>
  );
}

type Row = { label: string; type: string; amount: string; dueDate: string };

/** A draft edited as a whole: rows added, removed and reordered by due date on save (§21, §24). */
function ScheduleDialog({ onClose, finance, schedule, copyFrom, submit }: { onClose: () => void; finance: UnitFinanceDTO; schedule: ScheduleDTO | null; copyFrom: ScheduleDTO | null; submit: Submit }) {
  const request = useDialogRequest((url, body, success) => submit(url, body, success, schedule ? "PATCH" : "POST"));
  const currency = finance.summary.contract?.currency ?? "EUR";
  const initial: Row[] = schedule
    ? schedule.installments.map((row) => ({ label: row.label, type: row.type, amount: row.amount, dueDate: row.dueDate.slice(0, 10) }))
    : copyFrom
      ? copyFrom.installments.filter((row) => Number(row.outstandingAmount) > 0).map((row) => ({ label: row.label, type: row.type, amount: row.outstandingAmount, dueDate: row.dueDate.slice(0, 10) }))
      : [
          { label: "Deposit", type: "DEPOSIT", amount: "", dueDate: today() },
          { label: "Balance", type: "BALANCE", amount: "", dueDate: "" },
        ];
  const [rows, setRows] = React.useState<Row[]>(initial);
  const total = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const target = finance.scheduleTarget ? Number(finance.scheduleTarget) : null;
  const update = (index: number, patch: Partial<Row>) => setRows((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)));

  return (
    <FormDialog
      open
      onClose={onClose}
      title={schedule ? `Edit draft v${schedule.versionNumber}` : copyFrom ? "Revise the payment schedule" : "Create the payment schedule"}
      description={copyFrom ? "A new version replaces the one in force when it is activated. What was paid stays with the old version; this one covers what is left." : "Each installment is owed on its due date. A deposit is an installment of type Deposit."}
      confirmLabel={schedule ? "Save draft" : "Save as draft"}
      pending={request.pending}
      error={request.error}
      testId="schedule-dialog"
      wide
      onSubmit={() => {
        const body = { installments: rows.map((row) => ({ label: row.label, type: row.type, amount: row.amount, dueDate: row.dueDate })), ...(schedule ? { expectedVersion: schedule.version } : {}) };
        void request.send(schedule ? `/api/finance/payment-schedules/${schedule.id}` : `/api/contracts/${finance.summary.contract!.id}/payment-schedules`, body, "The draft schedule was saved.").then((failed) => (failed ? null : onClose()));
      }}
    >
      <ol className="space-y-3">
        {rows.map((row, index) => (
          <li key={index} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" data-testid="schedule-row">
            <Field label="Label" htmlFor={`row-label-${index}`}>
              <Input id={`row-label-${index}`} value={row.label} maxLength={120} onChange={(event) => update(index, { label: event.target.value })} />
            </Field>
            <Field label="Type" htmlFor={`row-type-${index}`}>
              <select id={`row-type-${index}`} className={selectClass} value={row.type} onChange={(event) => update(index, { type: event.target.value })}>
                {INSTALLMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {INSTALLMENT_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount" htmlFor={`row-amount-${index}`}>
              <Input id={`row-amount-${index}`} inputMode="decimal" value={row.amount} onChange={(event) => update(index, { amount: event.target.value })} />
            </Field>
            <Field label="Due" htmlFor={`row-due-${index}`}>
              <Input id={`row-due-${index}`} type="date" value={row.dueDate} onChange={(event) => update(index, { dueDate: event.target.value })} />
            </Field>
            <Button type="button" variant="ghost" size="icon" className="self-end" aria-label={`Remove installment ${index + 1}`} onClick={() => setRows((current) => current.filter((_, at) => at !== index))} disabled={rows.length === 1}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setRows((current) => [...current, { label: `Installment ${current.length + 1}`, type: "INSTALLMENT", amount: "", dueDate: "" }])}>
          <Plus aria-hidden="true" /> Add installment
        </Button>
        <p className={`text-table tabular-nums ${target !== null && Math.abs(total - target) > 0.004 ? "text-warning-strong" : "text-fg"}`} data-testid="schedule-total">
          Total {amountLabel(total.toFixed(2), currency)}
          {target !== null ? ` of ${amountLabel(target.toFixed(2), currency)} needed` : ""}
        </p>
      </div>
    </FormDialog>
  );
}

/** Activation checks the total; a deliberate difference takes the correction grant and a reason (§24). */
function ActivateDialog({ onClose, finance, schedule, submit }: { onClose: () => void; finance: UnitFinanceDTO; schedule: ScheduleDTO; submit: Submit }) {
  const currency = finance.summary.contract?.currency ?? "EUR";
  const mismatch = finance.scheduleTarget !== null && Number(schedule.total) !== Number(finance.scheduleTarget);
  return (
    <FieldsDialog
      open
      onClose={onClose}
      title={`Activate schedule v${schedule.versionNumber}?`}
      description={
        mismatch
          ? `Its installments add up to ${amountLabel(schedule.total, currency)} and the contract still needs ${amountLabel(finance.scheduleTarget, currency)}. Only a deliberate difference, with a reason, can be activated.`
          : "It comes into force now; the schedule it replaces is kept as superseded, with everything paid against it."
      }
      confirmLabel="Activate"
      url={`/api/finance/payment-schedules/${schedule.id}/activate`}
      body={{ expectedVersion: schedule.version }}
      fields={mismatch && finance.capabilities.canCorrect ? [{ name: "exceptionReason", label: "Why the total differs", kind: "textarea", required: true }] : []}
      success={`Schedule v${schedule.versionNumber} is active.`}
      submit={submit}
      testId="activate-schedule-dialog"
    />
  );
}

/** Earliest due first, never more than each installment still owes (§31). */
function propose(amount: string, installments: InstallmentDTO[]): Record<string, string> {
  let left = Math.round((Number(amount) || 0) * 100);
  const result: Record<string, string> = {};
  for (const row of [...installments].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.sequence - b.sequence)) {
    const owed = Math.round(Number(row.outstandingAmount) * 100);
    const take = Math.max(0, Math.min(left, owed));
    result[row.id] = take > 0 ? (take / 100).toFixed(2) : "";
    left -= take;
  }
  return result;
}

function AllocationRows({ installments, values, currency, onChange }: { installments: InstallmentDTO[]; values: Record<string, string>; currency: string; onChange: (id: string, value: string) => void }) {
  if (installments.length === 0) return <p className="text-table text-fg-muted">No installment of the active schedule is still owed. The money stays unallocated.</p>;
  return (
    <fieldset className="space-y-2">
      <legend className="text-meta font-medium text-fg-muted">Allocate to</legend>
      {installments.map((row) => (
        <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-2" data-testid="allocation-row">
          <label htmlFor={`allocate-${row.id}`} className="min-w-0 text-table">
            <span className="font-medium text-fg">{row.label}</span>
            <span className="block text-meta text-fg-subtle">
              due {formatDate(row.dueDate)} · {amountLabel(row.outstandingAmount, currency)} owed
            </span>
          </label>
          <Input id={`allocate-${row.id}`} inputMode="decimal" value={values[row.id] ?? ""} onChange={(event) => onChange(row.id, event.target.value)} />
        </div>
      ))}
    </fieldset>
  );
}

/** Money received against the contract, allocated in the same step (§77); a lookalike is offered back first (§78). */
function PaymentDialog({ onClose, contractId, currency, installments, canAllocate, submit }: { onClose: () => void; contractId: string; currency: string; installments: InstallmentDTO[]; canAllocate: boolean; submit: Submit }) {
  const request = useDialogRequest((url, body, success) => submit(url, body, success));
  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState(today());
  const [method, setMethod] = React.useState("BANK_TRANSFER");
  const [reference, setReference] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [allocations, setAllocations] = React.useState<Record<string, string>>({});
  const [edited, setEdited] = React.useState(false);
  const [duplicates, setDuplicates] = React.useState<Array<{ paymentDate: string; amount: string; reference: string | null }> | null>(null);

  const allocated = Object.values(allocations).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const left = (Number(amount) || 0) - allocated;

  function send(acceptDuplicate: boolean) {
    const body = {
      amount,
      paymentDate: date,
      method,
      reference: reference || null,
      notes: notes || null,
      allocations: canAllocate ? Object.entries(allocations).filter(([, value]) => Number(value) > 0).map(([installmentId, value]) => ({ installmentId, amount: value })) : [],
      ...(acceptDuplicate ? { acceptDuplicate: true } : {}),
    };
    void request.send(`/api/contracts/${contractId}/payments`, body, "The payment was recorded.").then((failed) => {
      if (!failed) return onClose();
      if (isFailure(failed) && failed.detailCode === "DUPLICATE_PAYMENT") setDuplicates((failed.details.matches as typeof duplicates) ?? []);
    });
  }

  return (
    <FormDialog open onClose={onClose} title="Record a payment" description="Money received against this contract. What you do not allocate stays on the payment as unallocated." confirmLabel={duplicates ? "Record anyway" : "Record payment"} pending={request.pending} error={duplicates ? null : request.error} testId="record-payment-dialog" wide onSubmit={() => send(Boolean(duplicates))}>
      {duplicates ? (
        <div className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-table text-warning-strong" data-testid="duplicate-payment">
          <p className="font-medium">A payment like this is already recorded on this contract:</p>
          <ul className="mt-1 list-inside list-disc">
            {duplicates.map((row, index) => (
              <li key={index}>
                {amountLabel(row.amount, currency)} on {formatDate(row.paymentDate)}
                {row.reference ? ` · ${row.reference}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-1">Record it only if it is different money.</p>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount" htmlFor="payment-amount" required error={request.fields.amount}>
          <Input
            id="payment-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setDuplicates(null);
              if (!edited) setAllocations(propose(event.target.value, installments));
            }}
          />
        </Field>
        <Field label="Received on" htmlFor="payment-date" required error={request.fields.paymentDate}>
          <Input id="payment-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="Method" htmlFor="payment-method">
          <select id="payment-method" className={selectClass} value={method} onChange={(event) => setMethod(event.target.value)}>
            {PAYMENT_METHODS.map((code) => (
              <option key={code} value={code}>
                {METHOD_LABELS[code] ?? code}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reference" htmlFor="payment-reference" error={request.fields.reference}>
          <Input id="payment-reference" value={reference} maxLength={200} onChange={(event) => { setReference(event.target.value); setDuplicates(null); }} />
        </Field>
      </div>
      {canAllocate ? (
        <>
          <AllocationRows
            installments={installments}
            values={allocations}
            currency={currency}
            onChange={(id, value) => {
              setEdited(true);
              setAllocations((current) => ({ ...current, [id]: value }));
            }}
          />
          <p className={`text-right text-table tabular-nums ${left < -0.004 ? "text-danger-strong" : "text-fg-muted"}`} data-testid="payment-unallocated">
            {left < -0.004 ? `Allocated ${amountLabel((-left).toFixed(2), currency)} more than the payment` : `Unallocated ${amountLabel(Math.max(0, left).toFixed(2), currency)}`}
          </p>
        </>
      ) : null}
      <Field label="Notes" htmlFor="payment-notes">
        <Input id="payment-notes" value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} />
      </Field>
    </FormDialog>
  );
}

function AllocateDialog({ onClose, payment, installments, submit }: { onClose: () => void; payment: ContractPaymentDTO; installments: InstallmentDTO[]; submit: Submit }) {
  const request = useDialogRequest((url, body, success) => submit(url, body, success));
  const [values, setValues] = React.useState<Record<string, string>>(() => propose(payment.unallocatedAmount, installments));
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Allocate ${amountLabel(payment.unallocatedAmount, payment.currency)}`}
      description={`Still unallocated on the payment of ${amountLabel(payment.amount, payment.currency)} received ${formatDate(payment.paymentDate)}.`}
      confirmLabel="Allocate"
      pending={request.pending}
      error={request.error}
      testId="allocate-payment-dialog"
      onSubmit={() => {
        const allocations = Object.entries(values).filter(([, value]) => Number(value) > 0).map(([installmentId, amount]) => ({ installmentId, amount }));
        void request.send(`/api/finance/payments/${payment.id}/allocations`, { allocations }, "The payment was allocated.").then((failed) => (failed ? null : onClose()));
      }}
    >
      <AllocationRows installments={installments} values={values} currency={payment.currency} onChange={(id, value) => setValues((current) => ({ ...current, [id]: value }))} />
    </FormDialog>
  );
}
