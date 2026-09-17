/**
 * Collecting a unit's sale (E-05F). Client-safe: constants, labels and the shapes
 * the API answers with. Money is always a two-decimal string, never a float (§73).
 */

export const UNIT_FINANCIAL_STATUSES = ["NO_CONTRACT", "CONTRACT_PENDING", "PAYMENT_PENDING", "PARTIALLY_PAID", "PAID", "OVERDUE", "FINANCIALLY_COMPLETE"] as const;
export type UnitFinancialStatus = (typeof UNIT_FINANCIAL_STATUSES)[number];

export const UNIT_FINANCIAL_STATUS_LABELS: Record<UnitFinancialStatus, string> = {
  NO_CONTRACT: "No contract",
  CONTRACT_PENDING: "Contract pending",
  PAYMENT_PENDING: "Payment pending",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  FINANCIALLY_COMPLETE: "Financially complete",
};

export const INSTALLMENT_STATUSES = ["UPCOMING", "DUE", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];

export const INSTALLMENT_STATUS_LABELS: Record<InstallmentStatus, string> = {
  UPCOMING: "Upcoming",
  DUE: "Due",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
};

export const INSTALLMENT_TYPES = ["DEPOSIT", "INSTALLMENT", "BALANCE", "OTHER"] as const;
export type InstallmentType = (typeof INSTALLMENT_TYPES)[number];

export const INSTALLMENT_TYPE_LABELS: Record<InstallmentType, string> = {
  DEPOSIT: "Deposit",
  INSTALLMENT: "Installment",
  BALANCE: "Balance",
  OTHER: "Other",
};

export const PAYMENT_SCHEDULE_STATUSES = ["DRAFT", "ACTIVE", "SUPERSEDED", "COMPLETED", "CANCELLED"] as const;
export type PaymentScheduleStatus = (typeof PAYMENT_SCHEDULE_STATUSES)[number];

export const PAYMENT_SCHEDULE_STATUS_LABELS: Record<PaymentScheduleStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  SUPERSEDED: "Superseded",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** How far ahead an installment counts as due, and is announced (§95). */
export const DUE_SOON_DAYS = 7;
export const MAX_INSTALLMENTS = 120;
export const FINANCE_REASON_MAX = 1_000;

export type Money = { amount: string; currency: string };

export type UnitFinanceCapabilities = {
  canView: boolean;
  canManageSchedule: boolean;
  canIssueInvoice: boolean;
  canRecordPayment: boolean;
  canAllocate: boolean;
  canManageDocuments: boolean;
  canCorrect: boolean;
  /** Payments and invoices are shown only with Finance's own grants (§100). */
  canSeePayments: boolean;
  canSeeInvoices: boolean;
  canVoidPayment: boolean;
  /** Proof of payment files, for readers of Finance's documents (§51, §102). */
  canSeeDocuments: boolean;
};

export type NextDueDTO = { installmentId: string; label: string; amount: string; dueDate: string };

/** The contract-level figures a unit shows (§35-§41, §64-§66). */
export type FinanceSummaryDTO = {
  unitId: string;
  contract: { id: string; number: string; status: string; value: string; currency: string } | null;
  paidAmount: string;
  outstandingAmount: string;
  overdueAmount: string;
  unallocatedAmount: string;
  nextDue: NextDueDTO | null;
  financialStatus: UnitFinancialStatus;
  /** Paid over contract value, one decimal; null without a value (§39). */
  progressPercent: string | null;
  /** Other units the same contract sells: the figures are the contract's, not split per unit (§91). */
  sharedWithUnits: Array<{ id: string; unitCode: string }>;
};

export type InstallmentDTO = {
  id: string;
  sequence: number;
  label: string;
  type: InstallmentType;
  amount: string;
  currency: string;
  dueDate: string;
  notes: string | null;
  paidAmount: string;
  outstandingAmount: string;
  status: InstallmentStatus;
  invoice: { id: string; invoiceNumber: string; status: string } | null;
};

export type ScheduleDTO = {
  id: string;
  versionNumber: number;
  status: PaymentScheduleStatus;
  currency: string;
  notes: string | null;
  total: string;
  totalExceptionReason: string | null;
  activatedAt: string | null;
  supersededAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  version: number;
  installments: InstallmentDTO[];
};

export type ContractPaymentDTO = {
  id: string;
  paymentDate: string;
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  notes: string | null;
  status: "RECORDED" | "VOIDED";
  voidReason: string | null;
  allocatedAmount: string;
  unallocatedAmount: string;
  replacesPaymentId: string | null;
  allocations: Array<{ id: string; installmentId: string | null; label: string; amount: string; reversed: boolean; reversalReason: string | null }>;
};

export type UnitFinanceDTO = {
  unitId: string;
  projectId: string;
  unitCode: string;
  summary: FinanceSummaryDTO;
  /** What an active schedule's installments must add up to now: the value less what earlier schedules collected (§24, §84). */
  scheduleTarget: string | null;
  contractStatusAllowsActivation: boolean;
  schedules: ScheduleDTO[];
  payments: ContractPaymentDTO[];
  invoices: Array<{ id: string; invoiceNumber: string; status: string; totalAmount: string; paidAmount: string; outstandingAmount: string; dueDate: string; installmentLabel: string | null }>;
  /** Canonical documents filed against the contract's payments — never copies (§51, §53). */
  documents: Array<{ id: string; name: string; paymentId: string; createdAt: string }>;
  capabilities: UnitFinanceCapabilities;
};

export type FinanceInventoryRowDTO = {
  id: string;
  unitCode: string;
  unitType: string;
  building: string;
  floor: string;
  client: { id: string; name: string } | null;
  contract: { id: string; number: string; status: string } | null;
  currency: string | null;
  contractValue: string | null;
  paidAmount: string | null;
  outstandingAmount: string | null;
  overdueAmount: string | null;
  nextDue: { amount: string; dueDate: string } | null;
  financialStatus: UnitFinancialStatus;
};

export type FinanceInventoryDTO = {
  items: FinanceInventoryRowDTO[];
  page: number;
  pageSize: number;
  total: number;
  counts: Record<UnitFinancialStatus, number> & { ALL: number };
  /** Derived per contract, never per unit, so a contract selling three units counts once (§92). */
  totals: Array<{ currency: string; contracted: string; collected: string; outstanding: string; overdue: string }>;
  canSeeClients: boolean;
};
