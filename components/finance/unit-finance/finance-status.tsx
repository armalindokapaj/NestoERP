import { FinanceText } from "@/components/finance/finance-text";
import { Badge } from "@/components/ui/badge";
import { UNIT_CONTRACT_STATUS_LABELS, type ContractStatusKey } from "@/lib/modules/contracts/units/unit-contract.types";
import {
  type InstallmentStatus,
  type PaymentScheduleStatus,
  type UnitFinancialStatus,
} from "@/lib/modules/finance/units/unit-finance.types";

/**
 * Where a unit's contract and collection stand, in words beside every colour
 * (E-05F §9, §22, §40). The financial status is its own badge — never the
 * commercial or the publication status (§40).
 */

type Tone = "default" | "info" | "success" | "warning" | "danger" | "neutral";

const FINANCIAL_TONES: Record<UnitFinancialStatus, Tone> = {
  NO_CONTRACT: "default",
  CONTRACT_PENDING: "neutral",
  PAYMENT_PENDING: "info",
  PARTIALLY_PAID: "info",
  PAID: "warning",
  OVERDUE: "danger",
  FINANCIALLY_COMPLETE: "success",
};

export function FinancialStatusBadge({ status, className }: { status: UnitFinancialStatus; className?: string }) {
  return (
    <Badge tone={FINANCIAL_TONES[status]} className={className} data-testid="financial-status" data-status={status}>
      <FinanceText k={`unitStatus.${status}`} />
    </Badge>
  );
}

const INSTALLMENT_TONES: Record<InstallmentStatus, Tone> = { UPCOMING: "default", DUE: "warning", PARTIALLY_PAID: "info", PAID: "success", OVERDUE: "danger", CANCELLED: "default" };

export function InstallmentStatusBadge({ status }: { status: InstallmentStatus }) {
  return (
    <Badge tone={INSTALLMENT_TONES[status]} data-testid="installment-status" data-status={status}>
      <FinanceText k={`installmentStatus.${status}`} />
    </Badge>
  );
}

const SCHEDULE_TONES: Record<PaymentScheduleStatus, Tone> = { DRAFT: "neutral", ACTIVE: "success", SUPERSEDED: "default", COMPLETED: "success", CANCELLED: "default" };

export function ScheduleStatusBadge({ status }: { status: PaymentScheduleStatus }) {
  return <Badge tone={SCHEDULE_TONES[status]}><FinanceText k={`scheduleStatus.${status}`} /></Badge>;
}

const CONTRACT_TONES: Partial<Record<ContractStatusKey, Tone>> = {
  DRAFT: "neutral",
  IN_REVIEW: "warning",
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  SENT: "info",
  SIGNED: "success",
  ACTIVE: "success",
  COMPLETED: "success",
};

/** A contract's status as the unit page names it: Under review, Ready for signature (§9). */
export function UnitContractStatusBadge({ status }: { status: string }) {
  const key = status as ContractStatusKey;
  return (
    <Badge tone={CONTRACT_TONES[key] ?? "default"} data-testid="contract-status" data-status={status}>
      {UNIT_CONTRACT_STATUS_LABELS[key] ?? status}
    </Badge>
  );
}

/** An amount with its currency, always to the cent: collection is exact (§73). */
export function amountLabel(amount: string | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  const value = Number(amount);
  if (!currency) return value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
