import type {
  GoodsReceiptStatus,
  ProcurementApprovalRecordType,
  ProcurementApprovalStatus,
  ProcurementCategory,
  ProcurementPriority,
  PurchaseOrderStatus,
  PurchaseRequestStatus,
  RFQStatus,
  RFQSupplierStatus,
  SupplierQuoteStatus,
  SupplierStatus,
  SupplierType,
} from "@prisma/client";

/**
 * Procurement DTOs (PRD #19 §233–§239).
 *
 * Two things are load-bearing:
 *
 *   1. **Money and quantity cross as strings.** Every amount is a decimal
 *      string so no JSON parser rounds a purchase order (PRD #19 §239).
 *   2. **A quote's price is a curtain.** A reader without
 *      `procurement.quote.view` gets `pricing: null` — the figure never leaves
 *      the server (PRD #19 §260).
 *
 * `capabilities` is a UX hint and never a security decision: the service
 * re-checks each one before it acts (PRD #7 §55).
 */

export type MemberRef = { memberId: string; fullName: string; active: boolean };
export type ProjectRef = { id: string; code: string; name: string };
export type SupplierRef = { id: string; name: string; status: SupplierStatus };
export type DepartmentRef = { id: string; name: string };

/** A link to another module, null-href when the reader may not follow it. */
export type ModuleLinkRef = { id: string; label: string; href: string | null };

export type MoneyDTO = { currency: string; amount: string };

/* -------------------------------------------------------------------------- */
/* Suppliers                                                                   */
/* -------------------------------------------------------------------------- */

export type SupplierSummaryDTO = {
  id: string;
  code: string | null;
  name: string;
  legalName: string | null;
  supplierType: SupplierType;
  status: SupplierStatus;
  country: string | null;
  email: string | null;
  phone: string | null;
  paymentTermsDays: number | null;
  defaultCurrency: string | null;
  openOrders: number;
  updatedAt: string;
};

export type SupplierCapabilities = {
  canEdit: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canViewOrders: boolean;
  canViewDocuments: boolean;
  canViewActivity: boolean;
};

export type SupplierDetailDTO = SupplierSummaryDTO & {
  website: string | null;
  taxId: string | null;
  registrationNumber: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  counts: { orders: number; quotes: number; receipts: number };
  createdAt: string;
  archivedAt: string | null;
  capabilities: SupplierCapabilities;
};

/* -------------------------------------------------------------------------- */
/* Purchase requests                                                           */
/* -------------------------------------------------------------------------- */

export type RequestItemDTO = {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  estimatedUnitPrice: string | null;
  estimatedAmount: string;
  category: ProcurementCategory | null;
  specification: string | null;
  sortOrder: number;
};

export type RequestAttentionDTO = {
  overdue: boolean;
  daysToRequired: number | null;
  awaitingDecision: boolean;
  unsourced: boolean;
};

export type RequestSummaryDTO = {
  id: string;
  requestNumber: string;
  title: string;
  status: PurchaseRequestStatus;
  priority: ProcurementPriority;
  project: ProjectRef | null;
  department: DepartmentRef | null;
  requestedBy: MemberRef;
  owner: MemberRef | null;
  requiredDate: string | null;
  currency: string | null;
  estimatedTotal: string;
  itemCount: number;
  attention: RequestAttentionDTO;
  updatedAt: string;
};

export type RequestCapabilities = {
  canEdit: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canCancel: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canCreateRfq: boolean;
  canCreateOrder: boolean;
  canViewDocuments: boolean;
  canViewActivity: boolean;
};

export type RequestDetailDTO = RequestSummaryDTO & {
  description: string | null;
  items: RequestItemDTO[];
  dates: {
    submittedAt: string | null;
    approvedAt: string | null;
    rejectedAt: string | null;
    cancelledAt: string | null;
  };
  rejectionReason: string | null;
  approvedBy: MemberRef | null;
  rejectedBy: MemberRef | null;
  projectLink: ModuleLinkRef | null;
  sourcing: { rfqs: number; orders: number; orderedValue: string | null };
  approvals: ProcurementApprovalDTO[];
  createdBy: MemberRef | null;
  createdAt: string;
  archivedAt: string | null;
  capabilities: RequestCapabilities;
};

/* -------------------------------------------------------------------------- */
/* RFQs and quotes                                                             */
/* -------------------------------------------------------------------------- */

export type RfqItemDTO = {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  specification: string | null;
  sortOrder: number;
};

export type RfqSupplierDTO = {
  id: string;
  supplier: SupplierRef;
  status: RFQSupplierStatus;
  invitedAt: string | null;
  respondedAt: string | null;
  quoteId: string | null;
};

export type RfqSummaryDTO = {
  id: string;
  rfqNumber: string;
  title: string;
  status: RFQStatus;
  currency: string;
  project: ProjectRef | null;
  requestNumber: string | null;
  responseDueDate: string | null;
  overdue: boolean;
  invitedCount: number;
  respondedCount: number;
  updatedAt: string;
};

export type RfqCapabilities = {
  canEdit: boolean;
  canIssue: boolean;
  canClose: boolean;
  canCancel: boolean;
  canManageSuppliers: boolean;
  canViewQuotes: boolean;
  canRecordQuote: boolean;
  canSelectQuote: boolean;
  canViewDocuments: boolean;
  canViewActivity: boolean;
};

export type RfqDetailDTO = RfqSummaryDTO & {
  items: RfqItemDTO[];
  suppliers: RfqSupplierDTO[];
  requestLink: ModuleLinkRef | null;
  projectLink: ModuleLinkRef | null;
  dates: { issuedAt: string | null; closedAt: string | null; cancelledAt: string | null };
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: RfqCapabilities;
};

/** Null without `procurement.quote.view` — the price never leaves the server. */
export type QuotePricingDTO = {
  currency: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
};

export type QuoteItemDTO = {
  id: string;
  rfqItemId: string;
  description: string;
  unit: string;
  quantity: string;
  pricing: { unitPrice: string; taxRate: string; totalAmount: string } | null;
  notes: string | null;
};

export type QuoteDTO = {
  id: string;
  rfqId: string;
  supplier: SupplierRef;
  quoteNumber: string | null;
  quoteDate: string;
  validUntil: string | null;
  expired: boolean;
  status: SupplierQuoteStatus;
  pricing: QuotePricingDTO | null;
  leadTimeDays: number | null;
  deliveryDate: string | null;
  disqualificationReason: string | null;
  notes: string | null;
  items: QuoteItemDTO[];
  capabilities: { canEdit: boolean; canSelect: boolean; canDisqualify: boolean };
  createdAt: string;
  updatedAt: string;
};

/** One row of the comparison grid (PRD #19 §89, §91). */
export type QuoteComparisonRowDTO = {
  quoteId: string;
  supplier: SupplierRef;
  status: SupplierQuoteStatus;
  pricing: QuotePricingDTO | null;
  leadTimeDays: number | null;
  /** 1 is cheapest among the qualified quotes; null when price is hidden. */
  priceRank: number | null;
  leadTimeRank: number | null;
  isLowest: boolean;
  itemTotals: Record<string, string | null>;
};

export type QuoteComparisonDTO = {
  rfq: RfqSummaryDTO;
  items: RfqItemDTO[];
  rows: QuoteComparisonRowDTO[];
  /** Null when the reader cannot see prices at all (PRD #19 §261). */
  canCompare: boolean;
};

/* -------------------------------------------------------------------------- */
/* Purchase orders                                                             */
/* -------------------------------------------------------------------------- */

export type OrderItemDTO = {
  id: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  receivedQuantity: string;
  outstandingQuantity: string;
  sortOrder: number;
};

export type OrderAttentionDTO = {
  overdue: boolean;
  daysToRequired: number | null;
  awaitingDecision: boolean;
  awaitingReceipt: boolean;
  fullyReceived: boolean;
};

export type OrderSummaryDTO = {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  supplier: SupplierRef;
  project: ProjectRef | null;
  orderDate: string;
  requiredDate: string | null;
  currency: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  /** 0–1, by ordered quantity across the lines (PRD #19 §141). */
  receivedFraction: number;
  itemCount: number;
  attention: OrderAttentionDTO;
  updatedAt: string;
};

export type OrderCapabilities = {
  canEdit: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canIssue: boolean;
  canCancel: boolean;
  canClose: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canReceive: boolean;
  canViewReceipts: boolean;
  canViewCommitment: boolean;
  canViewDocuments: boolean;
  canViewActivity: boolean;
};

export type OrderDetailDTO = OrderSummaryDTO & {
  items: OrderItemDTO[];
  notes: string | null;
  modifiedFromQuote: boolean;
  dates: {
    submittedAt: string | null;
    approvedAt: string | null;
    rejectedAt: string | null;
    issuedAt: string | null;
    closedAt: string | null;
    cancelledAt: string | null;
  };
  rejectionReason: string | null;
  approvedBy: MemberRef | null;
  rejectedBy: MemberRef | null;
  requestLink: ModuleLinkRef | null;
  rfqLink: ModuleLinkRef | null;
  contractLink: ModuleLinkRef | null;
  projectLink: ModuleLinkRef | null;
  /** Null without `procurement.commitment.view` (PRD #19 §262). */
  commitment: { id: string; reference: string | null; amount: string; href: string | null } | null;
  receiptCount: number;
  approvals: ProcurementApprovalDTO[];
  createdBy: MemberRef | null;
  createdAt: string;
  archivedAt: string | null;
  capabilities: OrderCapabilities;
};

/* -------------------------------------------------------------------------- */
/* Goods receipts                                                              */
/* -------------------------------------------------------------------------- */

export type ReceiptItemDTO = {
  id: string;
  purchaseOrderItemId: string;
  description: string;
  unit: string;
  receivedQuantity: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  notes: string | null;
};

export type ReceiptDTO = {
  id: string;
  receiptNumber: string;
  purchaseOrderId: string;
  poNumber: string;
  supplier: SupplierRef;
  project: ProjectRef | null;
  receiptDate: string;
  deliveryReference: string | null;
  status: GoodsReceiptStatus;
  receivedBy: MemberRef | null;
  notes: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  items: ReceiptItemDTO[];
  capabilities: { canVoid: boolean; canEdit: boolean };
  createdAt: string;
};

/* -------------------------------------------------------------------------- */
/* Approvals                                                                   */
/* -------------------------------------------------------------------------- */

export type ProcurementApprovalDTO = {
  id: string;
  recordType: ProcurementApprovalRecordType;
  recordId: string;
  recordReference: string;
  recordTitle: string;
  project: ProjectRef | null;
  supplier: SupplierRef | null;
  /** Null without the value permission behind the record type. */
  value: MoneyDTO | null;
  status: ProcurementApprovalStatus;
  submittedBy: MemberRef | null;
  submittedAt: string;
  decidedBy: MemberRef | null;
  decidedAt: string | null;
  decisionNote: string | null;
  capabilities: { canApprove: boolean; canReject: boolean };
};

/* -------------------------------------------------------------------------- */
/* Overview and reports                                                        */
/* -------------------------------------------------------------------------- */

export type CurrencyTotal = { currency: string; count: number; value: string };

export type ProcurementOverviewDTO = {
  visible: {
    requests: boolean;
    orders: boolean;
    approvals: boolean;
    receipts: boolean;
    suppliers: boolean;
  };
  openRequests: number;
  requestsAwaitingApproval: number;
  requestsInSourcing: number;
  openRfqs: number;
  rfqsAwaitingResponse: number;
  ordersAwaitingApproval: number;
  issuedOrders: number;
  ordersAwaitingReceipt: number;
  overdueOrders: number;
  receiptsThisMonth: number;
  activeSuppliers: number;
  /** Grouped by currency and never summed across them (PRD #19 §190). */
  committedValue: CurrencyTotal[] | null;
};

export type ProcurementAttentionDTO = {
  awaitingApproval: RequestSummaryDTO[];
  overdueOrders: OrderSummaryDTO[];
  awaitingReceipt: OrderSummaryDTO[];
  rfqsClosingSoon: RfqSummaryDTO[];
};

export type SpendRow = {
  key: string;
  label: string;
  count: number;
  totals: CurrencyTotal[];
};

export type DeliveryPerformanceRow = {
  supplier: SupplierRef;
  orders: number;
  onTime: number;
  late: number;
  onTimeRate: number | null;
};

export type OutstandingReceiptRow = {
  order: OrderSummaryDTO;
  outstandingLines: number;
};

export type ProcurementActivityDTO = {
  id: string;
  action: string;
  message: string | null;
  actor: string | null;
  createdAt: string;
};
