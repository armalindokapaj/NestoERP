import type {
  InventoryItemCategory,
  InventoryItemStatus,
  InventoryLocationStatus,
  InventoryTransactionStatus,
  StockAdjustmentReason,
  StockMovementType,
  StockReservationStatus,
  WarehouseStatus,
  WarehouseType,
} from "@prisma/client";

import type { StockLevel } from "./inventory.status";

/**
 * Inventory DTOs (PRD #20 §265–§272).
 *
 * Quantities cross as decimal strings, never as JavaScript numbers: a stock
 * figure that a JSON parser has rounded is a stock figure nobody can reconcile
 * (PRD #20 §272, §242).
 *
 * `capabilities` is a UX hint and never a security decision: the service
 * re-checks each one before it acts (PRD #7 §55).
 */

export type MemberRef = { memberId: string; fullName: string; active: boolean };
export type ProjectRef = { id: string; code: string; name: string };
export type WarehouseRef = { id: string; code: string; name: string; type: WarehouseType };
export type LocationRef = { id: string; code: string; name: string | null; warehouseId: string };
export type ItemRef = { id: string; sku: string; name: string; baseUnit: string };
export type ModuleLinkRef = { id: string; label: string; href: string | null };

/* -------------------------------------------------------------------------- */
/* Items and stock                                                             */
/* -------------------------------------------------------------------------- */

export type ItemSummaryDTO = {
  id: string;
  sku: string;
  name: string;
  category: InventoryItemCategory;
  baseUnit: string;
  status: InventoryItemStatus;
  minimumStock: string | null;
  reorderPoint: string | null;
  /** Null when the reader has no balance permission (PRD #20 §20). */
  stock: { onHand: string; reserved: string; available: string } | null;
  level: StockLevel;
  updatedAt: string;
};

export type ItemCapabilities = {
  canEdit: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canViewStock: boolean;
  canViewMovements: boolean;
  canViewDocuments: boolean;
  canViewActivity: boolean;
};

export type ItemDetailDTO = ItemSummaryDTO & {
  description: string | null;
  defaultWarehouse: WarehouseRef | null;
  defaultLocation: LocationRef | null;
  /** Where this item physically is, one row per location holding it. */
  byLocation: StockRowDTO[];
  createdBy: MemberRef | null;
  createdAt: string;
  archivedAt: string | null;
  capabilities: ItemCapabilities;
};

export type StockRowDTO = {
  item: ItemRef;
  warehouse: WarehouseRef;
  location: LocationRef;
  onHand: string;
  reserved: string;
  available: string;
  level: StockLevel;
  updatedAt: string;
};

/* -------------------------------------------------------------------------- */
/* Warehouses and locations                                                    */
/* -------------------------------------------------------------------------- */

export type WarehouseSummaryDTO = {
  id: string;
  code: string;
  name: string;
  warehouseType: WarehouseType;
  status: WarehouseStatus;
  project: ProjectRef | null;
  city: string | null;
  locationCount: number;
  distinctItems: number;
  updatedAt: string;
};

export type WarehouseCapabilities = {
  canEdit: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canManageLocations: boolean;
  canViewStock: boolean;
  canViewMovements: boolean;
  canViewActivity: boolean;
};

export type WarehouseDetailDTO = WarehouseSummaryDTO & {
  description: string | null;
  address: string | null;
  country: string | null;
  locations: LocationDTO[];
  createdBy: MemberRef | null;
  createdAt: string;
  archivedAt: string | null;
  capabilities: WarehouseCapabilities;
};

export type LocationDTO = {
  id: string;
  code: string;
  name: string | null;
  description: string | null;
  status: InventoryLocationStatus;
  isDefault: boolean;
  distinctItems: number;
  capabilities: { canEdit: boolean; canArchive: boolean };
};

/* -------------------------------------------------------------------------- */
/* Movements                                                                   */
/* -------------------------------------------------------------------------- */

export type MovementDTO = {
  id: string;
  movementType: StockMovementType;
  item: ItemRef;
  warehouse: WarehouseRef;
  location: LocationRef;
  project: ProjectRef | null;
  quantity: string;
  /** Carries the direction: negative means it left (PRD #20 §71). */
  signedQuantity: string;
  unit: string;
  occurredAt: string;
  postedBy: MemberRef | null;
  /** Where this came from, and whether the reader may open it (PRD #20 §179). */
  source: ModuleLinkRef | null;
  isReversal: boolean;
  reversedByMovementId: string | null;
  notes: string | null;
};

/* -------------------------------------------------------------------------- */
/* Stock documents                                                             */
/* -------------------------------------------------------------------------- */

export type DocumentLineDTO = {
  id: string;
  item: ItemRef;
  location: LocationRef | null;
  quantity: string;
  unit: string;
  notes: string | null;
  movementId: string | null;
};

export type TransactionCapabilities = {
  canEdit: boolean;
  canPost: boolean;
  canCancel: boolean;
  canReverse: boolean;
  canViewDocuments: boolean;
  canViewActivity: boolean;
};

export type ReceiptSummaryDTO = {
  id: string;
  receiptNumber: string;
  status: InventoryTransactionStatus;
  warehouse: WarehouseRef;
  receiptDate: string;
  lineCount: number;
  /** Set when this came from a Procurement delivery (PRD #20 §84, §89). */
  goodsReceiptLink: ModuleLinkRef | null;
  updatedAt: string;
};

export type ReceiptDetailDTO = ReceiptSummaryDTO & {
  notes: string | null;
  lines: DocumentLineDTO[];
  postedAt: string | null;
  reversedAt: string | null;
  postedBy: MemberRef | null;
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: TransactionCapabilities;
};

export type IssueSummaryDTO = {
  id: string;
  issueNumber: string;
  status: InventoryTransactionStatus;
  warehouse: WarehouseRef;
  project: ProjectRef | null;
  issueDate: string;
  issuedTo: MemberRef | null;
  lineCount: number;
  updatedAt: string;
};

export type IssueDetailDTO = IssueSummaryDTO & {
  notes: string | null;
  lines: DocumentLineDTO[];
  requestedBy: MemberRef | null;
  postedBy: MemberRef | null;
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: TransactionCapabilities;
};

export type TransferSummaryDTO = {
  id: string;
  transferNumber: string;
  status: InventoryTransactionStatus;
  fromWarehouse: WarehouseRef;
  toWarehouse: WarehouseRef;
  transferDate: string;
  lineCount: number;
  updatedAt: string;
};

export type TransferLineDTO = {
  id: string;
  item: ItemRef;
  fromLocation: LocationRef;
  toLocation: LocationRef;
  quantity: string;
  unit: string;
  notes: string | null;
};

export type TransferDetailDTO = TransferSummaryDTO & {
  notes: string | null;
  lines: TransferLineDTO[];
  postedBy: MemberRef | null;
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: TransactionCapabilities;
};

export type AdjustmentSummaryDTO = {
  id: string;
  adjustmentNumber: string;
  status: InventoryTransactionStatus;
  warehouse: WarehouseRef;
  adjustmentDate: string;
  reason: StockAdjustmentReason;
  lineCount: number;
  updatedAt: string;
};

export type AdjustmentLineDTO = {
  id: string;
  item: ItemRef;
  location: LocationRef;
  /** Signed: negative writes stock off (PRD #20 §147). */
  quantityDelta: string;
  unit: string;
  notes: string | null;
};

export type AdjustmentDetailDTO = AdjustmentSummaryDTO & {
  notes: string | null;
  lines: AdjustmentLineDTO[];
  postedBy: MemberRef | null;
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: TransactionCapabilities;
};

export type ReturnSummaryDTO = {
  id: string;
  returnNumber: string;
  status: InventoryTransactionStatus;
  warehouse: WarehouseRef;
  project: ProjectRef;
  returnDate: string;
  lineCount: number;
  updatedAt: string;
};

export type ReturnDetailDTO = ReturnSummaryDTO & {
  notes: string | null;
  lines: DocumentLineDTO[];
  returnedBy: MemberRef | null;
  postedBy: MemberRef | null;
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: TransactionCapabilities;
};

/* -------------------------------------------------------------------------- */
/* Reservations                                                                */
/* -------------------------------------------------------------------------- */

export type ReservationDTO = {
  id: string;
  reservationNumber: string;
  status: StockReservationStatus;
  item: ItemRef;
  warehouse: WarehouseRef;
  location: LocationRef;
  project: ProjectRef | null;
  quantity: string;
  fulfilledQuantity: string;
  remainingQuantity: string;
  requiredDate: string | null;
  expiresAt: string | null;
  expired: boolean;
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: {
    canEdit: boolean;
    canRelease: boolean;
    canCancel: boolean;
  };
};

/* -------------------------------------------------------------------------- */
/* Overview and reports                                                        */
/* -------------------------------------------------------------------------- */

export type InventoryOverviewDTO = {
  visible: {
    items: boolean;
    stock: boolean;
    movements: boolean;
    documents: boolean;
    reservations: boolean;
  };
  activeItems: number;
  warehouses: number;
  itemsHeld: number;
  lowStockItems: number;
  outOfStockItems: number;
  draftDocuments: number;
  movementsThisMonth: number;
  activeReservations: number;
};

export type InventoryAttentionDTO = {
  lowStock: ItemSummaryDTO[];
  draftReceipts: ReceiptSummaryDTO[];
  draftIssues: IssueSummaryDTO[];
  expiringReservations: ReservationDTO[];
};

export type StockByWarehouseRow = {
  warehouse: WarehouseRef;
  distinctItems: number;
  totalOnHand: string;
  totalReserved: string;
};

export type ProjectConsumptionRow = {
  item: ItemRef;
  issued: string;
  returned: string;
  /** Issued less returned: what the project actually consumed (PRD #20 §185). */
  netIssued: string;
};

export type InventoryActivityDTO = {
  id: string;
  action: string;
  message: string | null;
  actor: string | null;
  actorMemberId: string | null;
  createdAt: string;
};
