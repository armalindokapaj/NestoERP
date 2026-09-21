import type {
  BudgetStatus,
  CommitmentStatus,
  ExpenseStatus,
  FinanceApprovalRecordType,
  FinanceApprovalStatus,
  FinanceCostCategory,
  InvoiceStatus,
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
} from "@prisma/client";

import type { ExpenseSettlementStatus, SettlementStatus } from "./invoices/invoice.status";
import type { BudgetRisk } from "./budgets/budget.status";

/**
 * Finance DTOs (PRD #15 §228–§235).
 *
 * Every monetary field is a decimal string, never a number: the moment an
 * amount becomes a JavaScript float it stops being the amount (PRD #15 §229).
 */

export type ProjectRef = { id: string; code: string; name: string };
/**
 * The company a row belongs to. Present only on rows read in the Group
 * workspace, where without it a row from one company reads like any other
 * (Workspace Context §45); a company workspace's rows never carry it.
 */
export type CompanyRef = { id: string; name: string };
/** A row of a group report: what the company's own report says, with the company saying it. */
export type WithCompany<T> = T & { company: CompanyRef };
export type ClientRef = { id: string; name: string };
export type MemberRef = { memberId: string; fullName: string };

export type InvoiceSummaryDTO = {
  id: string;
  invoiceNumber: string;
  client: ClientRef;
  project: ProjectRef | null;
  issueDate: string;
  dueDate: string;
  currency: string;
  totalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  status: InvoiceStatus;
  settlementStatus: SettlementStatus;
  updatedAt: string;
  company?: CompanyRef;
};

export type InvoiceLineDTO = {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  sortOrder: number;
};

export type InvoiceDetailDTO = InvoiceSummaryDTO & {
  subtotal: string;
  taxAmount: string;
  notes: string | null;
  sentAt: string | null;
  archivedAt: string | null;
  lineItems: InvoiceLineDTO[];
  payments: PaymentSummaryDTO[];
  approvals: FinanceApprovalDTO[];
  createdBy: MemberRef | null;
  createdAt: string;
  /** Server-derived UX hints; every mutation re-checks authorisation. */
  capabilities: RecordCapabilities;
};

export type RecordCapabilities = {
  canEdit: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canMarkSent: boolean;
  canRecordPayment: boolean;
  canCancel: boolean;
  canClose: boolean;
  canRevise: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canViewActivity: boolean;
  canViewDocuments: boolean;
};

export type ExpenseSummaryDTO = {
  id: string;
  expenseNumber: string | null;
  description: string;
  category: FinanceCostCategory;
  project: ProjectRef | null;
  payeeName: string | null;
  expenseDate: string;
  currency: string;
  totalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  status: ExpenseStatus;
  settlementStatus: ExpenseSettlementStatus;
  updatedAt: string;
  company?: CompanyRef;
};

export type ExpenseDetailDTO = ExpenseSummaryDTO & {
  netAmount: string;
  taxAmount: string;
  notes: string | null;
  archivedAt: string | null;
  payments: PaymentSummaryDTO[];
  approvals: FinanceApprovalDTO[];
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: RecordCapabilities;
};

export type BudgetSummaryDTO = {
  id: string;
  project: ProjectRef;
  version: number;
  name: string | null;
  currency: string;
  status: BudgetStatus;
  isCurrent: boolean;
  budgetAmount: string;
  actualCost: string;
  openCommitments: string;
  forecastCost: string;
  variance: string;
  /** `null` when there is no approved budget to divide by (PRD #15 §151). */
  utilizationPercent: string | null;
  risk: BudgetRisk | null;
  updatedAt: string;
  company?: CompanyRef;
};

export type BudgetLineDTO = {
  id: string;
  category: FinanceCostCategory;
  description: string;
  plannedAmount: string;
  sortOrder: number;
};

export type BudgetDetailDTO = BudgetSummaryDTO & {
  notes: string | null;
  approvedAt: string | null;
  archivedAt: string | null;
  lineItems: BudgetLineDTO[];
  approvals: FinanceApprovalDTO[];
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: RecordCapabilities;
};

export type CommitmentSummaryDTO = {
  id: string;
  reference: string | null;
  description: string;
  project: ProjectRef | null;
  counterpartyName: string | null;
  category: FinanceCostCategory;
  currency: string;
  amount: string;
  expectedDate: string | null;
  status: CommitmentStatus;
  source: { module: string | null; entityType: string | null; entityId: string | null };
  updatedAt: string;
};

export type CommitmentDetailDTO = CommitmentSummaryDTO & {
  notes: string | null;
  archivedAt: string | null;
  approvals: FinanceApprovalDTO[];
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: RecordCapabilities;
};

export type PaymentSummaryDTO = {
  id: string;
  direction: PaymentDirection;
  paymentDate: string;
  currency: string;
  amount: string;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  status: PaymentStatus;
  voidReason: string | null;
  /** What it settles first: the contract it was recorded against, else its first allocation's invoice or expense. */
  relatedRecord: { type: "INVOICE" | "EXPENSE" | "CONTRACT"; id: string; reference: string } | null;
  /** Its amount less its unreversed allocations (E-05F §34). */
  allocatedAmount: string;
  unallocatedAmount: string;
  allocations: PaymentAllocationDTO[];
  capabilities: { canVoid: boolean };
};

/** One part of a payment and what it settles (E-05F §31). */
export type PaymentAllocationDTO = {
  id: string;
  type: "INVOICE" | "EXPENSE" | "INSTALLMENT";
  targetId: string;
  reference: string;
  invoiceId: string | null;
  amount: string;
  reversed: boolean;
  reversalReason: string | null;
};

export type FinanceApprovalDTO = {
  id: string;
  recordType: FinanceApprovalRecordType;
  recordId: string;
  status: FinanceApprovalStatus;
  record: {
    reference: string;
    amount: string;
    currency: string;
    projectName: string | null;
    counterpartyName: string | null;
  };
  submittedBy: MemberRef;
  submittedAt: string;
  decision: {
    memberId: string;
    fullName: string;
    decidedAt: string;
    note: string | null;
  } | null;
  /** Whether *this* reader may decide it (PRD #15 §19, §143). */
  canDecide: boolean;
};

/** A currency-grouped total. V0.1 never adds two currencies (PRD #15 §36). */
export type CurrencyTotal = { currency: string; amount: string };

export type FinanceOverviewDTO = {
  baseCurrency: string;
  receivables: CurrencyTotal[];
  overdueReceivables: CurrencyTotal[];
  payables: CurrencyTotal[];
  cashIn: CurrencyTotal[];
  cashOut: CurrencyTotal[];
  netCashflow: CurrencyTotal[];
  openCommitments: CurrencyTotal[];
  counts: {
    draftInvoices: number;
    pendingApprovals: number;
    overdueInvoices: number;
    unpaidExpenses: number;
  };
  /** Which panels this reader is allowed to see at all (PRD #15 §22–§27). */
  visible: {
    receivables: boolean;
    payables: boolean;
    cashflow: boolean;
    commitments: boolean;
    approvals: boolean;
    projectBudgets: boolean;
  };
};

/**
 * The Finance overview of the Group workspace (Workspace Context §36, §72).
 *
 * Every company the reader may open Finance in answers as itself — the same
 * overview its own page gives — and the group is those answers side by side.
 * `totals` adds only what can be added: an amount is summed with the same
 * currency in another company, never with another currency (PRD #15 §36), so a
 * group holding EUR and USD lists both. Counts are summed; they are the same
 * kind of thing in every company.
 */
export type GroupFinanceOverviewDTO = {
  scope: "GROUP";
  companies: Array<{ company: CompanyRef; overview: FinanceOverviewDTO }>;
  totals: Pick<
    FinanceOverviewDTO,
    "receivables" | "overdueReceivables" | "payables" | "cashIn" | "cashOut" | "netCashflow" | "openCommitments"
  >;
  counts: FinanceOverviewDTO["counts"];
  /** A panel shows when it is visible in at least one company; a company where it is not contributes nothing to it. */
  visible: FinanceOverviewDTO["visible"];
};

export type ProjectFinanceSummaryDTO = {
  projectId: string;
  currency: string;
  budgetAmount: string;
  actualCost: string;
  openCommitments: string;
  forecastCost: string;
  remaining: string;
  variance: string;
  utilizationPercent: string | null;
  risk: BudgetRisk | null;
  hasApprovedBudget: boolean;
};

export type FinanceActivityDTO = {
  id: string;
  action: string;
  message: string | null;
  actor: string | null;
  actorMemberId: string | null;
  createdAt: string;
};
