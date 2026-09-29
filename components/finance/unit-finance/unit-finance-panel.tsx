"use client";

import * as React from "react";
import { compareDecimal, isZeroDecimal, previewDecimal, sumDecimal } from "@/lib/modules/finance/finance.decimal";
import Link from "@/components/navigation/nav-link";
import { usePathname } from "next/navigation";
import { useRouter } from "@/components/navigation/guarded-router";
import { Banknote, CalendarRange, FileText, MoreHorizontal, Plus, Receipt, Trash2 } from "lucide-react";

import { useFinanceTranslations } from "@/components/finance/finance-text";
import { selectClass } from "@/components/forms/record-form";
import { Field, isFailure, structureApi } from "@/components/project-structure/structure-ui";
import { FormDialog, requestOutcome, useDialogRequest, useOpenedWith } from "@/components/sales/unit-sales/unit-sales-dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { PAYMENT_METHODS } from "@/lib/modules/finance/payments/payment.schema";
import { INSTALLMENT_TYPES, type ContractPaymentDTO, type InstallmentDTO, type ScheduleDTO, type UnitFinanceDTO } from "@/lib/modules/finance/units/unit-finance.types";
import { formatDate } from "@/lib/utils/format";
import { PersonLink } from "@/components/people/person-link";
import type { FinanceActor } from "@/lib/modules/finance/units/unit-finance.types";
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

const METHODS = new Set(["BANK_TRANSFER", "CARD", "CASH", "CHECK", "OTHER"]);
const methodLabel = (t: ReturnType<typeof useFinanceTranslations>, code: string) => (METHODS.has(code) ? t(`method.${code}` as "method.CASH") : code);

export function UnitFinancePanel({ finance }: { finance: UnitFinanceDTO }) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useFinanceTranslations();
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
      // Any one-shot query goes without a navigation: the dialog that just saved
      // is still on screen, and a navigation would ask about it (AUD-03 §5).
      if (window.location.search) window.history.replaceState(window.history.state, "", pathname);
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
            {t("panel.title")}
          </h2>
          <FinancialStatusBadge status={summary.financialStatus} />
          {contract ? (
            <span className="flex items-center gap-1.5 text-meta text-fg-subtle">
              {t("panel.contract", { number: contract.number })} <UnitContractStatusBadge status={contract.status} />
            </span>
          ) : null}
        </div>
        {contract ? (
          <>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Figure label={t("panel.contractValue")} testId="finance-contract-value" value={amountLabel(contract.value, currency)} strong />
              <Figure label={t("panel.paid")} testId="finance-paid" value={amountLabel(summary.paidAmount, currency)} />
              <Figure label={t("panel.outstanding")} testId="finance-outstanding" value={amountLabel(summary.outstandingAmount, currency)} strong />
              <Figure label={t("panel.overdue")} testId="finance-overdue" value={amountLabel(summary.overdueAmount, currency)} danger={Number(summary.overdueAmount) > 0} />
            </dl>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="nesto-eyebrow text-fg-subtle">{t("panel.nextPayment")}</p>
                <p className="mt-1 text-body text-fg" data-testid="finance-next-due">
                  {summary.nextDue ? t("panel.nextDue", { amount: amountLabel(summary.nextDue.amount, currency), label: summary.nextDue.label, date: formatDate(summary.nextDue.dueDate) }) : t("panel.nothingDue")}
                </p>
              </div>
              <div>
                <p className="nesto-eyebrow text-fg-subtle">{t("panel.progress")}</p>
                <div className="mt-2 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(summary.progressPercent ?? 0)} aria-label={t("panel.progress")}>
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
                {t("panel.unallocated", { amount: amountLabel(summary.unallocatedAmount, currency) })}
              </p>
            ) : null}
            {summary.sharedWithUnits.length ? (
              <p className="mt-3 text-meta text-fg-subtle">
                {t("panel.shared", { units: summary.sharedWithUnits.map((unit) => unit.unitCode).join(", ") })}
              </p>
            ) : null}
            {caps.canRecordPayment && collecting ? (
              <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4" data-testid="unit-finance-actions">
                <Button onClick={() => setOpen({ kind: "record" })}>
                  <Banknote aria-hidden="true" /> {t("panel.recordPayment")}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-3 text-table text-fg-muted" data-testid="finance-no-contract">
            {finance.schedules.length ? t("panel.notInForce") : t("panel.noContract")}
          </p>
        )}
      </section>

      {live || finance.schedules.length ? (
        <section className="nesto-card p-5" aria-labelledby="payment-schedule" data-testid="payment-schedule">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="payment-schedule" className="text-card font-semibold text-fg">
              {t("panel.schedule")}
            </h2>
            {current ? <ScheduleStatusBadge status={current.status} /> : null}
            {current ? <span className="text-meta text-fg-subtle">v{current.versionNumber}</span> : null}
            {current ? <ByLine actor={current.activatedBy ?? current.createdBy} /> : null}
            <div className="ml-auto flex flex-wrap gap-2">
              {caps.canManageSchedule && live && !draft ? (
                <Button size="sm" variant={current ? "secondary" : "primary"} onClick={() => setOpen({ kind: "schedule", schedule: null, copy: Boolean(current) })}>
                  <CalendarRange aria-hidden="true" /> {current ? t("panel.reviseSchedule") : t("panel.createSchedule")}
                </Button>
              ) : null}
            </div>
          </div>
          {current ? (
            <InstallmentTable schedule={current} currency={currency} canInvoice={caps.canIssueInvoice && live && current.status === "ACTIVE"} onInvoice={(installment) => setOpen({ kind: "invoice", installment })} />
          ) : (
            <p className="mt-3 text-table text-fg-muted">{draft ? t("panel.drafting") : t("panel.noSchedule")}</p>
          )}
          {current?.totalExceptionReason ? <p className="mt-3 text-meta text-fg-muted">{t("panel.exception", { reason: current.totalExceptionReason })}</p> : null}

          {draft ? (
            <div className="mt-5 rounded-md border border-dashed border-line-strong p-4" data-testid="schedule-draft">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-fg">{t("panel.draftVersion", { version: draft.versionNumber })}</p>
                <ScheduleStatusBadge status="DRAFT" />
                <ByLine actor={draft.createdBy} />
                <span className="text-meta text-fg-subtle">
                  {t("panel.total", { amount: amountLabel(draft.total, currency) })}
                  {finance.scheduleTarget ? t("panel.contractNeeds", { amount: amountLabel(finance.scheduleTarget, currency) }) : ""}
                </span>
              </div>
              <InstallmentTable schedule={draft} currency={currency} canInvoice={false} onInvoice={() => undefined} />
              {caps.canManageSchedule ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setOpen({ kind: "activate", schedule: draft })} disabled={!finance.contractStatusAllowsActivation}>
                    {t("panel.activate")}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setOpen({ kind: "schedule", schedule: draft, copy: false })}>
                    {t("panel.editDraft")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setOpen({ kind: "discard", schedule: draft })}>
                    <Trash2 aria-hidden="true" /> {t("panel.discard")}
                  </Button>
                  {!finance.contractStatusAllowsActivation ? <p className="text-meta text-fg-subtle">{t("panel.activateWhenSigned")}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {older.length ? (
            <details className="mt-5">
              <summary className="cursor-pointer text-table font-medium text-fg-muted">{t("panel.earlier", { count: older.length })}</summary>
              <div className="mt-3 space-y-4">
                {older.map((schedule) => (
                  <div key={schedule.id}>
                    <p className="flex items-center gap-2 text-table text-fg">
                      v{schedule.versionNumber} <ScheduleStatusBadge status={schedule.status} />
                      <span className="text-meta text-fg-subtle">
                        {schedule.supersededAt ? t("panel.superseded", { date: formatDate(schedule.supersededAt) }) : schedule.cancelledAt ? t("panel.cancelledOn", { date: formatDate(schedule.cancelledAt) }) : ""}
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
            {t("panel.payments")}
          </h2>
          {finance.payments.length === 0 ? (
            <p className="mt-3 text-table text-fg-muted">{t("panel.noPayments")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {finance.payments.map((payment) => (
                <li key={payment.id} className="py-3 text-table" data-testid="payment-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={payment.status === "VOIDED" ? "font-medium tabular-nums text-fg-subtle line-through" : "font-medium tabular-nums text-fg"}>{amountLabel(payment.amount, payment.currency)}</span>
                    <span className="text-fg-muted">
                      {formatDate(payment.paymentDate)} · {methodLabel(t, payment.method)}
                      {payment.reference ? ` · ${payment.reference}` : ""}
                    </span>
                    <ByLine actor={payment.recordedBy} />
                    {payment.status === "VOIDED" ? <Badge>{t("paymentStatus.VOIDED")}</Badge> : Number(payment.unallocatedAmount) > 0 ? <Badge tone="warning">{t("panel.unallocatedBadge", { amount: amountLabel(payment.unallocatedAmount, payment.currency) })}</Badge> : null}
                    <PaymentMenu payment={payment} caps={caps} onOpen={setOpen} />
                  </div>
                  {payment.allocations.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {payment.allocations.map((allocation) => (
                        <li key={allocation.id} className="flex flex-wrap items-center gap-2 text-meta text-fg-muted">
                          <span className={allocation.reversed ? "line-through" : undefined}>
                            {amountLabel(allocation.amount, payment.currency)} → {allocation.label}
                          </span>
                          {allocation.reversed ? <span>{allocation.reversalReason ? t("panel.reversedReason", { reason: allocation.reversalReason }) : t("panel.reversed")}</span> : null}
                          {!allocation.reversed && payment.status === "RECORDED" && caps.canCorrect ? (
                            <button type="button" className="text-accent hover:underline touch:inline-flex touch:min-h-11 touch:items-center touch:px-2" aria-label={t("panel.reverseTo", { label: allocation.label })} onClick={() => setOpen({ kind: "reverse", allocationId: allocation.id, label: allocation.label })}>
                              {t("panel.reverse")}
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {payment.voidReason ? (
                    <p className="mt-1 flex flex-wrap items-center gap-1 text-meta text-fg-muted">
                      {t("panel.voidedReason", { reason: payment.voidReason })} <ByLine actor={payment.voidedBy} />
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {caps.canSeeInvoices && finance.invoices.length ? (
        <section className="nesto-card p-5" aria-labelledby="unit-invoices" data-testid="unit-invoices">
          <h2 id="unit-invoices" className="text-card font-semibold text-fg">
            {t("panel.invoices")}
          </h2>
          <ul className="mt-3 divide-y divide-line">
            {finance.invoices.map((invoice) => (
              <li key={invoice.id} className="flex flex-wrap items-center gap-2 py-2.5 text-table">
                <Link href={`/finance/invoices/${invoice.id}`} className="font-medium text-fg hover:underline">
                  {invoice.invoiceNumber}
                </Link>
                <Badge>{invoice.status.charAt(0) + invoice.status.slice(1).toLowerCase().replace(/_/g, " ")}</Badge>
                <span className="text-fg-muted">{t("panel.invoiceDue", { label: invoice.installmentLabel ?? "", date: formatDate(invoice.dueDate) })}</span>
                <ByLine actor={invoice.createdBy} />
                <span className="ml-auto tabular-nums text-fg-muted">
                  {t("panel.paidOfTotal", { paid: amountLabel(invoice.paidAmount, currency), total: amountLabel(invoice.totalAmount, currency) })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {caps.canSeeDocuments && finance.payments.length ? (
        <section className="nesto-card p-5" aria-labelledby="finance-documents" data-testid="finance-documents">
          <h2 id="finance-documents" className="text-card font-semibold text-fg">
            {t("panel.proof")}
          </h2>
          {finance.documents.length === 0 ? (
            <p className="mt-3 text-table text-fg-muted">{t("panel.noProof")}{caps.canManageDocuments ? t("panel.attachHint") : ""}</p>
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
                    <ByLine actor={document.uploadedBy} />
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
        <FieldsDialog open onClose={close} title={t("panel.discardTitle", { version: open.schedule.versionNumber })} description={t("panel.discardBody")} confirmLabel={t("panel.discard")} url={`/api/finance/payment-schedules/${open.schedule.id}/discard`} body={{ expectedVersion: open.schedule.version }} fields={[{ name: "reason", label: t("panel.reason"), kind: "textarea" }]} success={t("panel.discarded")} submit={submit} />
      ) : null}
      {open?.kind === "invoice" ? (
        <FieldsDialog
          open
          onClose={close}
          title={t("panel.raiseTitle", { label: open.installment.label })}
          description={t("panel.raiseBody", { amount: amountLabel(open.installment.amount, currency) })}
          confirmLabel={t("panel.raiseInvoice")}
          url={`/api/finance/installments/${open.installment.id}/invoice`}
          fields={[
            { name: "issueDate", label: t("invoiceForm.issueDate"), kind: "date", required: true, initial: today() },
            { name: "dueDate", label: t("invoiceForm.dueDate"), kind: "date", required: true, initial: open.installment.dueDate.slice(0, 10) < today() ? today() : open.installment.dueDate.slice(0, 10) },
          ]}
          success={t("panel.raised")}
          submit={submit}
          testId="issue-invoice-dialog"
        />
      ) : null}
      {open?.kind === "record" && contract ? <PaymentDialog onClose={close} contractId={contract.id} currency={currency} installments={openInstallments} canAllocate={caps.canAllocate} submit={submit} /> : null}
      {open?.kind === "allocate" ? <AllocateDialog onClose={close} payment={open.payment} installments={openInstallments} submit={submit} /> : null}
      {open?.kind === "reverse" ? (
        <FieldsDialog open onClose={close} title={t("panel.reverseTitle")} description={t("panel.reverseBody", { label: open.label })} confirmLabel={t("panel.reverse")} url={`/api/finance/payment-allocations/${open.allocationId}/reverse`} fields={[{ name: "reason", label: t("panel.reason"), kind: "textarea", required: true }]} success={t("panel.reversedDone")} submit={submit} />
      ) : null}
      {open?.kind === "void" ? (
        <FieldsDialog open onClose={close} title={t("panel.voidTitle", { amount: amountLabel(open.payment.amount, open.payment.currency) })} description={t("panel.voidBody")} confirmLabel={t("voidPayment.confirm")} url={`/api/finance/payments/${open.payment.id}/void`} fields={[{ name: "reason", label: t("panel.reason"), kind: "textarea", required: true }]} success={t("panel.voided")} submit={submit} testId="void-payment-dialog" />
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
  const t = useFinanceTranslations();
  const allocate = payment.status === "RECORDED" && caps.canAllocate && Number(payment.unallocatedAmount) > 0;
  const voidable = payment.status === "RECORDED" && caps.canVoidPayment;
  const attach = payment.status === "RECORDED" && caps.canManageDocuments && caps.canSeeDocuments;
  if (!allocate && !voidable && !attach) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("panel.paymentActions", { amount: amountLabel(payment.amount, payment.currency), date: formatDate(payment.paymentDate) })} className="ml-auto">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {allocate ? <DropdownMenuItem onSelect={() => onOpen({ kind: "allocate", payment })}>{t("panel.allocate")}</DropdownMenuItem> : null}
        {attach ? (
          <DropdownMenuItem asChild>
            <Link href={`/documents/new?entityType=payment&entityId=${encodeURIComponent(payment.id)}`}>{t("panel.attachProof")}</Link>
          </DropdownMenuItem>
        ) : null}
        {voidable ? <DropdownMenuItem onSelect={() => onOpen({ kind: "void", payment })}>{t("voidPayment.confirm")}</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InstallmentTable({ schedule, currency, canInvoice, onInvoice }: { schedule: ScheduleDTO; currency: string; canInvoice: boolean; onInvoice: (installment: InstallmentDTO) => void }) {
  const t = useFinanceTranslations();
  const invoice = (row: InstallmentDTO) =>
    row.invoice ? (
      <Link href={`/finance/invoices/${row.invoice.id}`} className="text-accent hover:underline">
        {row.invoice.invoiceNumber}
      </Link>
    ) : canInvoice && row.status !== "PAID" ? (
      <Button size="sm" variant="ghost" onClick={() => onInvoice(row)}>
        <Receipt aria-hidden="true" /> {t("panel.raiseInvoice")}
      </Button>
    ) : null;
  return (
    <>
      <ScrollRegion label={t("panel.installments")} className="mt-3 hidden sm:block">
        <table className="w-full min-w-[40rem] text-table" data-testid="installments">
          <thead>
            <tr className="border-b border-line text-left text-meta text-fg-subtle">
              <th className="py-2 pr-3 font-medium">#</th>
              <th className="py-2 pr-3 font-medium">{t("panel.installment")}</th>
              <th className="py-2 pr-3 font-medium">{t("panel.due")}</th>
              <th className="py-2 pr-3 text-right font-medium">{t("form.amount")}</th>
              <th className="py-2 pr-3 text-right font-medium">{t("panel.paid")}</th>
              <th className="py-2 pr-3 font-medium">{t("columns.status")}</th>
              <th className="py-2 font-medium">{t("kind.invoice")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {schedule.installments.map((row) => (
              <tr key={row.id} data-testid="installment-row">
                <td className="py-2 pr-3 tabular-nums text-fg-subtle">{row.sequence}</td>
                <td className="py-2 pr-3">
                  <span className="font-medium text-fg">{row.label}</span>
                  <span className="block text-meta text-fg-subtle">{t(`installmentType.${row.type}`)}</span>
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
      </ScrollRegion>
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
              {t("panel.duePaid", { date: formatDate(row.dueDate), amount: amountLabel(row.paidAmount, currency) })}
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
  const t = useFinanceTranslations();
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
  // Exact previews (AUD-09 §4, FV-06): a row that is not yet a number counts
  // as nothing here, and the server refuses it with the row's own error.
  const total = sumDecimal(rows.map((row) => previewDecimal(row.amount, 2) ?? "0"), 2);
  const target = finance.scheduleTarget ?? null;
  const offTarget = target !== null && compareDecimal(total, target) !== 0;
  const update = (index: number, patch: Partial<Row>) => setRows((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  // Rows added or removed count as much as a typed amount (AUD-03 §3).
  const changed = useOpenedWith(true, rows);

  /** The draft's one save path, for its button and "Save and continue" alike. */
  function saveDraft(): Promise<unknown> {
    const body = { installments: rows.map((row) => ({ label: row.label, type: row.type, amount: row.amount, dueDate: row.dueDate })), ...(schedule ? { expectedVersion: schedule.version } : {}) };
    return request.send(schedule ? `/api/finance/payment-schedules/${schedule.id}` : `/api/contracts/${finance.summary.contract!.id}/payment-schedules`, body, t("panel.draftSaved"));
  }

  return (
    <FormDialog
      open
      onClose={onClose}
      title={schedule ? t("panel.editDraftTitle", { version: schedule.versionNumber }) : copyFrom ? t("panel.reviseTitle") : t("panel.createTitle")}
      description={copyFrom ? t("panel.reviseBody") : t("panel.createBody")}
      confirmLabel={schedule ? t("panel.saveDraft") : t("panel.saveAsDraft")}
      pending={request.pending}
      error={request.error}
      testId="schedule-dialog"
      wide
      module="finance"
      dirty={changed && !request.done}
      unresolved={request.unresolved}
      save={{ kind: schedule ? "save" : "create", run: async () => requestOutcome(await saveDraft()) }}
      onSubmit={() => void saveDraft().then((failed) => (failed ? null : onClose()))}
    >
      <ol className="space-y-3">
        {rows.map((row, index) => (
          <li key={index} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" data-testid="schedule-row">
            <Field label={t("panel.label")} htmlFor={`row-label-${index}`}>
              <Input id={`row-label-${index}`} value={row.label} maxLength={120} onChange={(event) => update(index, { label: event.target.value })} />
            </Field>
            <Field label={t("panel.type")} htmlFor={`row-type-${index}`}>
              <select id={`row-type-${index}`} className={selectClass} value={row.type} onChange={(event) => update(index, { type: event.target.value })}>
                {INSTALLMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`installmentType.${type}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("form.amount")} htmlFor={`row-amount-${index}`}>
              <Input id={`row-amount-${index}`} inputMode="decimal" value={row.amount} onChange={(event) => update(index, { amount: event.target.value })} />
            </Field>
            <Field label={t("panel.due")} htmlFor={`row-due-${index}`}>
              <Input id={`row-due-${index}`} type="date" value={row.dueDate} onChange={(event) => update(index, { dueDate: event.target.value })} />
            </Field>
            <Button type="button" variant="ghost" size="icon" className="self-end" aria-label={t("panel.removeInstallment", { number: index + 1 })} onClick={() => setRows((current) => current.filter((_, at) => at !== index))} disabled={rows.length === 1}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setRows((current) => [...current, { label: `Installment ${current.length + 1}`, type: "INSTALLMENT", amount: "", dueDate: "" }])}>
          <Plus aria-hidden="true" /> {t("panel.addInstallment")}
        </Button>
        <p className={`text-table tabular-nums ${offTarget ? "text-warning-strong" : "text-fg"}`} data-testid="schedule-total">
          {t("panel.total", { amount: amountLabel(total, currency) })}
          {target !== null ? t("panel.ofNeeded", { amount: amountLabel(target, currency) }) : ""}
        </p>
      </div>
    </FormDialog>
  );
}

/** Activation checks the total; a deliberate difference takes the correction grant and a reason (§24). */
function ActivateDialog({ onClose, finance, schedule, submit }: { onClose: () => void; finance: UnitFinanceDTO; schedule: ScheduleDTO; submit: Submit }) {
  const currency = finance.summary.contract?.currency ?? "EUR";
  const t = useFinanceTranslations();
  const mismatch = finance.scheduleTarget !== null && Number(schedule.total) !== Number(finance.scheduleTarget);
  return (
    <FieldsDialog
      open
      onClose={onClose}
      title={t("panel.activateTitle", { version: schedule.versionNumber })}
      description={
        mismatch
          ? t("panel.activateMismatch", { total: amountLabel(schedule.total, currency), target: amountLabel(finance.scheduleTarget, currency) })
          : t("panel.activateBody")
      }
      confirmLabel={t("panel.activate")}
      url={`/api/finance/payment-schedules/${schedule.id}/activate`}
      body={{ expectedVersion: schedule.version }}
      fields={mismatch && finance.capabilities.canCorrect ? [{ name: "exceptionReason", label: t("panel.whyDiffers"), kind: "textarea", required: true }] : []}
      success={t("panel.activated", { version: schedule.versionNumber })}
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
  const t = useFinanceTranslations();
  if (installments.length === 0) return <p className="text-table text-fg-muted">{t("panel.nothingOwed")}</p>;
  return (
    <fieldset className="space-y-2">
      <legend className="text-meta font-medium text-fg-muted">{t("panel.allocateTo")}</legend>
      {installments.map((row) => (
        <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-2" data-testid="allocation-row">
          <label htmlFor={`allocate-${row.id}`} className="min-w-0 text-table">
            <span className="font-medium text-fg">{row.label}</span>
            <span className="block text-meta text-fg-subtle">
              {t("panel.dueOwed", { date: formatDate(row.dueDate), amount: amountLabel(row.outstandingAmount, currency) })}
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
  const t = useFinanceTranslations();
  const request = useDialogRequest((url, body, success) => submit(url, body, success));
  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState(today());
  const [method, setMethod] = React.useState("BANK_TRANSFER");
  const [reference, setReference] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [allocations, setAllocations] = React.useState<Record<string, string>>({});
  const [edited, setEdited] = React.useState(false);
  const [duplicates, setDuplicates] = React.useState<Array<{ paymentDate: string; amount: string; reference: string | null }> | null>(null);

  const changed = useOpenedWith(true, [amount, date, method, reference, notes, allocations]);
  const allocated = sumDecimal(Object.values(allocations).map((value) => previewDecimal(value, 2) ?? "0"), 2);
  const paid = previewDecimal(amount, 2) ?? "0";
  const left = sumDecimal([paid, allocated.startsWith("-") ? allocated.slice(1) : `-${allocated}`], 2);
  const over = left.startsWith("-") && !isZeroDecimal(left);

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
    void request.send(`/api/contracts/${contractId}/payments`, body, t("panel.recorded")).then((failed) => {
      if (!failed) return onClose();
      if (isFailure(failed) && failed.detailCode === "DUPLICATE_PAYMENT") setDuplicates((failed.details.matches as typeof duplicates) ?? []);
    });
  }

  return (
    <FormDialog open onClose={onClose} title={t("panel.recordTitle")} description={t("panel.recordBody")} confirmLabel={duplicates ? t("panel.recordAnyway") : t("panel.recordPayment")} pending={request.pending} error={duplicates ? null : request.error} testId="record-payment-dialog" wide module="finance" workflow={t("panel.recordPayment")} dirty={changed && !request.done} unresolved={request.unresolved} onSubmit={() => send(Boolean(duplicates))}>
      {duplicates ? (
        <div className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-table text-warning-strong" data-testid="duplicate-payment">
          <p className="font-medium">{t("panel.duplicate")}</p>
          <ul className="mt-1 list-inside list-disc">
            {duplicates.map((row, index) => (
              <li key={index}>
                {t("panel.amountOn", { amount: amountLabel(row.amount, currency), date: formatDate(row.paymentDate) })}
                {row.reference ? ` · ${row.reference}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-1">{t("panel.differentMoney")}</p>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("form.amount")} htmlFor="payment-amount" required error={request.fields.amount}>
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
        <Field label={t("panel.receivedOn")} htmlFor="payment-date" required error={request.fields.paymentDate}>
          <Input id="payment-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label={t("columns.method")} htmlFor="payment-method">
          <select id="payment-method" className={selectClass} value={method} onChange={(event) => setMethod(event.target.value)}>
            {PAYMENT_METHODS.map((code) => (
              <option key={code} value={code}>
                {methodLabel(t, code)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("form.reference")} htmlFor="payment-reference" error={request.fields.reference}>
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
          <p className={`text-right text-table tabular-nums ${over ? "text-danger-strong" : "text-fg-muted"}`} data-testid="payment-unallocated">
            {over ? t("panel.overAllocated", { amount: amountLabel(left.slice(1), currency) }) : t("panel.unallocatedTotal", { amount: amountLabel(left, currency) })}
          </p>
        </>
      ) : null}
      <Field label={t("form.notes")} htmlFor="payment-notes">
        <Input id="payment-notes" value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} />
      </Field>
    </FormDialog>
  );
}

function AllocateDialog({ onClose, payment, installments, submit }: { onClose: () => void; payment: ContractPaymentDTO; installments: InstallmentDTO[]; submit: Submit }) {
  const t = useFinanceTranslations();
  const request = useDialogRequest((url, body, success) => submit(url, body, success));
  const [values, setValues] = React.useState<Record<string, string>>(() => propose(payment.unallocatedAmount, installments));
  const changed = useOpenedWith(true, values);
  return (
    <FormDialog
      open
      onClose={onClose}
      title={t("panel.allocateTitle", { amount: amountLabel(payment.unallocatedAmount, payment.currency) })}
      description={t("panel.allocateBody", { amount: amountLabel(payment.amount, payment.currency), date: formatDate(payment.paymentDate) })}
      confirmLabel={t("panel.allocate")}
      pending={request.pending}
      error={request.error}
      testId="allocate-payment-dialog"
      module="finance"
      dirty={changed && !request.done}
      unresolved={request.unresolved}
      onSubmit={() => {
        const allocations = Object.entries(values).filter(([, value]) => Number(value) > 0).map(([installmentId, amount]) => ({ installmentId, amount }));
        void request.send(`/api/finance/payments/${payment.id}/allocations`, { allocations }, t("panel.allocated")).then((failed) => (failed ? null : onClose()));
      }}
    >
      <AllocationRows installments={installments} values={values} currency={payment.currency} onChange={(id, value) => setValues((current) => ({ ...current, [id]: value }))} />
    </FormDialog>
  );
}

/** Who did it, beside the record (user, 2026-09-29). */
function ByLine({ actor }: { actor: FinanceActor }) {
  const t = useFinanceTranslations();
  if (!actor) return null;
  return (
    <span className="text-meta text-fg-subtle">
      {t("panel.by")} <PersonLink memberId={actor.memberId} name={actor.name} />
    </span>
  );
}
