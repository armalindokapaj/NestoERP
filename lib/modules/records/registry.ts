import type { Prisma } from "@prisma/client";

import { statusLabel } from "@/lib/utils/status";
import { AccessError } from "@/lib/access/guards";
import { buildProjectLinkedScopeWhere } from "@/lib/access/scope";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { searchClause, skipFor } from "@/lib/modules/shared/list-query";
import { formatCurrency, formatDate, orDash } from "@/lib/utils/format";
import { CORE_SECTIONS } from "./core-sections";
import type { RecordSection } from "./types";

/**
 * The department module sections (PRD #9 §67).
 *
 * Every section is declared here: how its list is queried under the caller's
 * scope, which columns render, which filters are offered, and how a record is
 * approved. Nothing in this file bypasses scope, and every query begins at the
 * current company (PRD #7 §57).
 */

function money(value: Prisma.Decimal | null, currency = "EUR"): string {
  return value === null ? "—" : formatCurrency(Number(value), currency);
}

function auditMeta(record: {
  createdAt: Date;
  updatedAt?: Date;
  approvedAt?: Date | null;
}): { label: string; value: string }[] {
  const meta = [{ label: "Created", value: formatDate(record.createdAt) }];
  if (record.updatedAt) meta.push({ label: "Updated", value: formatDate(record.updatedAt) });
  if (record.approvedAt) meta.push({ label: "Approved", value: formatDate(record.approvedAt) });
  return meta;
}

function statusFilter(values: string[]) {
  return {
    param: "status",
    label: "Status",
    options: values.map((value) => ({ value, label: statusLabel(value) })),
  };
}

/** Only a value the enum actually contains reaches Prisma (PRD #8 §86). */
function enumValue<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  return (allowed as readonly string[]).includes(upper) ? (upper as T) : undefined;
}

/* -------------------------------------------------------------------------- */
/* Legal                                                                       */
/* -------------------------------------------------------------------------- */

const CONTRACT_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "ACTIVE",
  "EXPIRING",
  "EXPIRED",
  "ARCHIVED",
] as const;

const contracts: RecordSection = {
  module: "contracts",
  section: "contracts",
  singular: "Contract",
  plural: "Contracts",
  emptyTitle: "No contracts yet.",
  emptyDescription: "Contracts held by your company will appear here.",
  permission: "legal.contract.view",
  approvePermission: "legal.contract.approve",
  columns: [
    { key: "reference", label: "Reference" },
    { key: "title", label: "Contract", hideBelow: "md" },
    { key: "client", label: "Counterparty", hideBelow: "lg" },
    { key: "status", label: "Status" },
    { key: "end", label: "Ends", hideBelow: "xl" },
    { key: "value", label: "Value", align: "right" },
  ],
  filters: [statusFilter([...CONTRACT_STATUSES])],
  async list(context, args) {
    const where: Prisma.ContractWhereInput = {
      companyId: context.companyId,
      ...(enumValue(args.filters.status, CONTRACT_STATUSES)
        ? { status: enumValue(args.filters.status, CONTRACT_STATUSES) }
        : {}),
      ...(searchClause(args.search, ["reference", "title", "counterparty"]) ?? {}),
    };

    const [rows, total] = await Promise.all([
      prisma.contract.findMany({
        where,
        orderBy: { endDate: "asc" },
        skip: skipFor(args.page, args.limit),
        take: args.limit,
        select: {
          id: true,
          reference: true,
          title: true,
          status: true,
          endDate: true,
          value: true,
          currency: true,
          client: { select: { name: true } },
        },
      }),
      prisma.contract.count({ where }),
    ]);

    return {
      total,
      rows: rows.map((row) => ({
        id: row.id,
        primary: row.reference,
        secondary: row.title,
        status: row.status,
        fields: [
          { key: "reference", label: "Reference", value: row.reference },
          { key: "title", label: "Contract", value: row.title, hideBelow: "md" as const },
          { key: "client", label: "Counterparty", value: orDash(row.client?.name), hideBelow: "lg" as const },
          { key: "status", label: "Status", value: row.status, status: true },
          {
            key: "end",
            label: "Ends",
            value: row.endDate ? formatDate(row.endDate) : "—",
            hideBelow: "xl" as const,
          },
          {
            key: "value",
            label: "Value",
            value: money(row.value, row.currency),
            align: "right" as const,
          },
        ],
      })),
    };
  },
  async get(context, id) {
    const row = await prisma.contract.findFirst({
      where: { companyId: context.companyId, id },
      select: {
        id: true,
        reference: true,
        title: true,
        status: true,
        value: true,
        currency: true,
        startDate: true,
        endDate: true,
        counterparty: true,
        createdAt: true,
        updatedAt: true,
        approvedAt: true,
        client: { select: { name: true } },
        project: { select: { name: true } },
      },
    });

    if (!row) return null;

    return {
      id: row.id,
      title: row.reference,
      subtitle: row.title,
      status: row.status,
      fields: [
        { label: "Counterparty", value: orDash(row.client?.name ?? row.counterparty) },
        { label: "Project", value: orDash(row.project?.name) },
        { label: "Value", value: money(row.value, row.currency) },
        { label: "Starts", value: row.startDate ? formatDate(row.startDate) : "—" },
        { label: "Ends", value: row.endDate ? formatDate(row.endDate) : "—" },
      ],
      meta: auditMeta(row),
      approval: { status: row.status, pending: row.status === "PENDING_APPROVAL" },
    };
  },
  async decide(context, id, decision) {
    await decideRecord(context, {
      module: "contracts",
      entityType: "Contract",
      id,
      decision,
      permission: "legal.contract.approve",
      find: () =>
        prisma.contract.findFirst({
          where: { companyId: context.companyId, id },
          select: { id: true, status: true, reference: true },
        }),
      pendingStatus: "PENDING_APPROVAL",
      apply: (tx, approved) =>
        tx.contract.update({
          where: { id },
          data: {
            status: approved ? "ACTIVE" : "DRAFT",
            approvedBy: approved ? context.userId : null,
            approvedAt: approved ? new Date() : null,
            updatedBy: context.userId,
          },
        }),
      label: (record) => record.reference,
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Procurement                                                                 */
/* -------------------------------------------------------------------------- */

const REQUEST_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "ORDERED",
] as const;

const purchaseRequests: RecordSection = {
  module: "procurement",
  section: "requests",
  singular: "Purchase request",
  plural: "Purchase requests",
  emptyTitle: "No purchase requests.",
  emptyDescription: "Requests raised on your projects will appear here.",
  permission: "procurement.request.view",
  approvePermission: "procurement.request.approve",
  columns: [
    { key: "reference", label: "Reference" },
    { key: "title", label: "Request", hideBelow: "md" },
    { key: "project", label: "Project", hideBelow: "lg" },
    { key: "status", label: "Status" },
    { key: "amount", label: "Amount", align: "right" },
  ],
  filters: [statusFilter([...REQUEST_STATUSES])],
  async list(context, args) {
    const where: Prisma.PurchaseRequestWhereInput = {
      ...buildProjectLinkedScopeWhere(context, "procurement"),
      ...(enumValue(args.filters.status, REQUEST_STATUSES)
        ? { status: enumValue(args.filters.status, REQUEST_STATUSES) }
        : {}),
      ...(searchClause(args.search, ["reference", "title"]) ?? {}),
    };

    const [rows, total] = await Promise.all([
      prisma.purchaseRequest.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: skipFor(args.page, args.limit),
        take: args.limit,
        select: {
          id: true,
          reference: true,
          title: true,
          status: true,
          amount: true,
          currency: true,
          project: { select: { name: true } },
        },
      }),
      prisma.purchaseRequest.count({ where }),
    ]);

    return {
      total,
      rows: rows.map((row) => ({
        id: row.id,
        primary: row.reference,
        secondary: row.title,
        status: row.status,
        fields: [
          { key: "reference", label: "Reference", value: row.reference },
          { key: "title", label: "Request", value: row.title, hideBelow: "md" as const },
          { key: "project", label: "Project", value: orDash(row.project?.name), hideBelow: "lg" as const },
          { key: "status", label: "Status", value: row.status, status: true },
          {
            key: "amount",
            label: "Amount",
            value: money(row.amount, row.currency),
            align: "right" as const,
          },
        ],
      })),
    };
  },
  async get(context, id) {
    const row = await prisma.purchaseRequest.findFirst({
      where: { ...buildProjectLinkedScopeWhere(context, "procurement"), id },
      select: {
        id: true,
        reference: true,
        title: true,
        status: true,
        amount: true,
        currency: true,
        neededBy: true,
        createdAt: true,
        updatedAt: true,
        approvedAt: true,
        project: { select: { name: true } },
        requester: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    });

    if (!row) return null;

    return {
      id: row.id,
      title: row.reference,
      subtitle: row.title,
      status: row.status,
      fields: [
        { label: "Project", value: orDash(row.project?.name) },
        { label: "Amount", value: money(row.amount, row.currency) },
        { label: "Needed by", value: row.neededBy ? formatDate(row.neededBy) : "—" },
        {
          label: "Requested by",
          value: row.requester
            ? `${row.requester.user.firstName} ${row.requester.user.lastName}`
            : "—",
        },
      ],
      meta: auditMeta(row),
      approval: { status: row.status, pending: row.status === "PENDING_APPROVAL" },
    };
  },
  async decide(context, id, decision) {
    await decideRecord(context, {
      module: "procurement",
      entityType: "PurchaseRequest",
      id,
      decision,
      permission: "procurement.request.approve",
      find: () =>
        prisma.purchaseRequest.findFirst({
          where: { ...buildProjectLinkedScopeWhere(context, "procurement"), id },
          select: { id: true, status: true, reference: true },
        }),
      pendingStatus: "PENDING_APPROVAL",
      apply: (tx, approved) =>
        tx.purchaseRequest.update({
          where: { id },
          data: {
            status: approved ? "APPROVED" : "REJECTED",
            approvedBy: context.userId,
            approvedAt: new Date(),
            updatedBy: context.userId,
          },
        }),
      label: (record) => record.reference,
    });
  },
};

const ORDER_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ORDERED", "DELIVERED"] as const;

const purchaseOrders: RecordSection = {
  module: "procurement",
  section: "orders",
  singular: "Purchase order",
  plural: "Purchase orders",
  emptyTitle: "No purchase orders.",
  emptyDescription: "Orders raised against approved requests will appear here.",
  permission: "procurement.order.view",
  approvePermission: "procurement.order.approve",
  columns: [
    { key: "reference", label: "Reference" },
    { key: "supplier", label: "Supplier", hideBelow: "md" },
    { key: "project", label: "Project", hideBelow: "lg" },
    { key: "status", label: "Status" },
    { key: "amount", label: "Amount", align: "right" },
  ],
  filters: [statusFilter([...ORDER_STATUSES])],
  async list(context, args) {
    const where: Prisma.PurchaseOrderWhereInput = {
      ...buildProjectLinkedScopeWhere(context, "procurement"),
      ...(enumValue(args.filters.status, ORDER_STATUSES)
        ? { status: enumValue(args.filters.status, ORDER_STATUSES) }
        : {}),
      ...(searchClause(args.search, ["reference", "supplier"]) ?? {}),
    };

    const [rows, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: skipFor(args.page, args.limit),
        take: args.limit,
        select: {
          id: true,
          reference: true,
          supplier: true,
          status: true,
          amount: true,
          currency: true,
          project: { select: { name: true } },
        },
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    return {
      total,
      rows: rows.map((row) => ({
        id: row.id,
        primary: row.reference,
        secondary: row.supplier,
        status: row.status,
        fields: [
          { key: "reference", label: "Reference", value: row.reference },
          { key: "supplier", label: "Supplier", value: row.supplier, hideBelow: "md" as const },
          { key: "project", label: "Project", value: orDash(row.project?.name), hideBelow: "lg" as const },
          { key: "status", label: "Status", value: row.status, status: true },
          {
            key: "amount",
            label: "Amount",
            value: money(row.amount, row.currency),
            align: "right" as const,
          },
        ],
      })),
    };
  },
  async get(context, id) {
    const row = await prisma.purchaseOrder.findFirst({
      where: { ...buildProjectLinkedScopeWhere(context, "procurement"), id },
      select: {
        id: true,
        reference: true,
        supplier: true,
        status: true,
        amount: true,
        currency: true,
        orderedAt: true,
        expectedAt: true,
        createdAt: true,
        updatedAt: true,
        approvedAt: true,
        project: { select: { name: true } },
      },
    });

    if (!row) return null;

    return {
      id: row.id,
      title: row.reference,
      subtitle: row.supplier,
      status: row.status,
      fields: [
        { label: "Project", value: orDash(row.project?.name) },
        { label: "Amount", value: money(row.amount, row.currency) },
        { label: "Ordered", value: row.orderedAt ? formatDate(row.orderedAt) : "—" },
        { label: "Expected", value: row.expectedAt ? formatDate(row.expectedAt) : "—" },
      ],
      meta: auditMeta(row),
      approval: { status: row.status, pending: row.status === "PENDING_APPROVAL" },
    };
  },
  async decide(context, id, decision) {
    await decideRecord(context, {
      module: "procurement",
      entityType: "PurchaseOrder",
      id,
      decision,
      permission: "procurement.order.approve",
      find: () =>
        prisma.purchaseOrder.findFirst({
          where: { ...buildProjectLinkedScopeWhere(context, "procurement"), id },
          select: { id: true, status: true, reference: true },
        }),
      pendingStatus: "PENDING_APPROVAL",
      apply: (tx, approved) =>
        tx.purchaseOrder.update({
          where: { id },
          data: {
            status: approved ? "APPROVED" : "DRAFT",
            approvedBy: approved ? context.userId : null,
            approvedAt: approved ? new Date() : null,
            updatedBy: context.userId,
          },
        }),
      label: (record) => record.reference,
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Inventory                                                                   */
/* -------------------------------------------------------------------------- */

function inventoryItemSection(section: string, lowStockOnly: boolean): RecordSection {
  return {
    module: "inventory",
    section,
    singular: "Item",
    plural: lowStockOnly ? "Low stock" : "Items",
    emptyTitle: lowStockOnly ? "Every item is above its reorder level." : "No inventory items.",
    emptyDescription: lowStockOnly
      ? "Items at or below their reorder level will appear here."
      : "Materials tracked by your company will appear here.",
    permission: "inventory.item.view",
    columns: [
      { key: "name", label: "Item" },
      { key: "sku", label: "SKU", hideBelow: "lg" },
      { key: "location", label: "Location", hideBelow: "xl" },
      { key: "reorder", label: "Reorder at", align: "right" },
      { key: "quantity", label: "In stock", align: "right" },
    ],
    async list(context, args) {
      const where: Prisma.InventoryItemWhereInput = {
        companyId: context.companyId,
        archivedAt: null,
        ...(searchClause(args.search, ["name", "sku"]) ?? {}),
      };

      // Prisma cannot compare two columns in a filter, so low stock is resolved
      // after a narrow select rather than by loading whole records.
      const all = await prisma.inventoryItem.findMany({
        where,
        orderBy: { name: "asc" },
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
          quantity: true,
          reorderLevel: true,
          location: true,
        },
      });

      const filtered = lowStockOnly
        ? all.filter((item) => item.quantity <= item.reorderLevel)
        : all;

      const start = skipFor(args.page, args.limit);
      const page = filtered.slice(start, start + args.limit);

      return {
        total: filtered.length,
        rows: page.map((row) => ({
          id: row.id,
          primary: row.name,
          secondary: row.sku,
          status: row.quantity === 0 ? "BLOCKED" : row.quantity <= row.reorderLevel ? "PENDING" : "ACTIVE",
          fields: [
            { key: "name", label: "Item", value: row.name },
            { key: "sku", label: "SKU", value: row.sku, hideBelow: "lg" as const },
            {
              key: "location",
              label: "Location",
              value: orDash(row.location),
              hideBelow: "xl" as const,
            },
            {
              key: "reorder",
              label: "Reorder at",
              value: String(row.reorderLevel),
              align: "right" as const,
            },
            {
              key: "quantity",
              label: "In stock",
              value: `${row.quantity} ${row.unit}`,
              align: "right" as const,
            },
          ],
        })),
      };
    },
    async get(context, id) {
      const row = await prisma.inventoryItem.findFirst({
        where: { companyId: context.companyId, id },
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
          quantity: true,
          reorderLevel: true,
          unitCost: true,
          location: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!row) return null;

      return {
        id: row.id,
        title: row.name,
        subtitle: row.sku,
        status: row.quantity <= row.reorderLevel ? "PENDING" : "ACTIVE",
        fields: [
          { label: "In stock", value: `${row.quantity} ${row.unit}` },
          { label: "Reorder level", value: String(row.reorderLevel) },
          { label: "Unit cost", value: money(row.unitCost) },
          { label: "Location", value: orDash(row.location) },
          {
            label: "Stock value",
            value: formatCurrency(row.quantity * Number(row.unitCost ?? 0)),
          },
        ],
        meta: auditMeta(row),
      };
    },
  };
}

const movements: RecordSection = {
  module: "inventory",
  section: "movements",
  singular: "Movement",
  plural: "Movements",
  emptyTitle: "No stock movements.",
  emptyDescription: "Stock in, out and adjustments will appear here.",
  permission: "inventory.movement.view",
  columns: [
    { key: "item", label: "Item" },
    { key: "type", label: "Type" },
    { key: "project", label: "Project", hideBelow: "lg" },
    { key: "date", label: "Recorded", hideBelow: "xl" },
    { key: "quantity", label: "Quantity", align: "right" },
  ],
  filters: [
    {
      param: "type",
      label: "Type",
      options: ["IN", "OUT", "TRANSFER", "ADJUSTMENT"].map((value) => ({
        value,
        label: statusLabel(value),
      })),
    },
  ],
  async list(context, args) {
    const types = ["IN", "OUT", "TRANSFER", "ADJUSTMENT"] as const;
    const where: Prisma.InventoryMovementWhereInput = {
      companyId: context.companyId,
      ...(enumValue(args.filters.type, types) ? { type: enumValue(args.filters.type, types) } : {}),
      ...(args.search ? { item: { name: { contains: args.search, mode: "insensitive" } } } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.inventoryMovement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: skipFor(args.page, args.limit),
        take: args.limit,
        select: {
          id: true,
          type: true,
          quantity: true,
          createdAt: true,
          item: { select: { name: true, unit: true } },
          project: { select: { name: true } },
        },
      }),
      prisma.inventoryMovement.count({ where }),
    ]);

    return {
      total,
      rows: rows.map((row) => ({
        id: row.id,
        primary: row.item.name,
        secondary: statusLabel(row.type),
        fields: [
          { key: "item", label: "Item", value: row.item.name },
          { key: "type", label: "Type", value: statusLabel(row.type) },
          { key: "project", label: "Project", value: orDash(row.project?.name), hideBelow: "lg" as const },
          {
            key: "date",
            label: "Recorded",
            value: formatDate(row.createdAt),
            hideBelow: "xl" as const,
          },
          {
            key: "quantity",
            label: "Quantity",
            value: `${row.quantity} ${row.item.unit}`,
            align: "right" as const,
          },
        ],
      })),
    };
  },
  async get(context, id) {
    const row = await prisma.inventoryMovement.findFirst({
      where: { companyId: context.companyId, id },
      select: {
        id: true,
        type: true,
        quantity: true,
        note: true,
        createdAt: true,
        item: { select: { name: true, sku: true, unit: true } },
        project: { select: { name: true } },
        actor: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    });

    if (!row) return null;

    return {
      id: row.id,
      title: row.item.name,
      subtitle: row.item.sku,
      status: row.type,
      description: row.note,
      fields: [
        { label: "Type", value: statusLabel(row.type) },
        { label: "Quantity", value: `${row.quantity} ${row.item.unit}` },
        { label: "Project", value: orDash(row.project?.name) },
        {
          label: "Recorded by",
          value: row.actor ? `${row.actor.user.firstName} ${row.actor.user.lastName}` : "—",
        },
      ],
      meta: [{ label: "Recorded", value: formatDate(row.createdAt) }],
    };
  },
};

/* -------------------------------------------------------------------------- */
/* QA/QC and HSE                                                               */
/* -------------------------------------------------------------------------- */

const WORK_STATUSES = ["OPEN", "IN_PROGRESS", "CLOSED"] as const;

function qualitySection(section: string, type: "INSPECTION" | "NCR" | "PUNCH_ITEM" | "TEST" | null): RecordSection {
  const label = type ? statusLabel(type) : "Quality record";

  return {
    module: "qaqc",
    section,
    singular: label,
    plural: `${label}s`,
    emptyTitle: `No ${label.toLowerCase()} records.`,
    emptyDescription: "Quality records raised on your projects will appear here.",
    permission: "qaqc.record.view",
    approvePermission: "qaqc.record.close",
    columns: [
      { key: "reference", label: "Reference" },
      { key: "title", label: "Title", hideBelow: "md" },
      { key: "project", label: "Project", hideBelow: "lg" },
      { key: "severity", label: "Severity", hideBelow: "xl" },
      { key: "status", label: "Status" },
    ],
    filters: [statusFilter([...WORK_STATUSES])],
    async list(context, args) {
      const where: Prisma.QualityRecordWhereInput = {
        ...buildProjectLinkedScopeWhere(context, "qaqc"),
        ...(type ? { type } : {}),
        ...(enumValue(args.filters.status, WORK_STATUSES)
          ? { status: enumValue(args.filters.status, WORK_STATUSES) }
          : {}),
        ...(searchClause(args.search, ["reference", "title"]) ?? {}),
      };

      const [rows, total] = await Promise.all([
        prisma.qualityRecord.findMany({
          where,
          orderBy: [{ status: "asc" }, { severity: "desc" }],
          skip: skipFor(args.page, args.limit),
          take: args.limit,
          select: {
            id: true,
            reference: true,
            title: true,
            severity: true,
            status: true,
            project: { select: { name: true } },
          },
        }),
        prisma.qualityRecord.count({ where }),
      ]);

      return {
        total,
        rows: rows.map((row) => ({
          id: row.id,
          primary: row.reference,
          secondary: row.title,
          status: row.status,
          fields: [
            { key: "reference", label: "Reference", value: row.reference },
            { key: "title", label: "Title", value: row.title, hideBelow: "md" as const },
            { key: "project", label: "Project", value: orDash(row.project?.name), hideBelow: "lg" as const },
            {
              key: "severity",
              label: "Severity",
              value: orDash(row.severity && statusLabel(row.severity)),
              hideBelow: "xl" as const,
            },
            { key: "status", label: "Status", value: row.status, status: true },
          ],
        })),
      };
    },
    async get(context, id) {
      const row = await prisma.qualityRecord.findFirst({
        where: { ...buildProjectLinkedScopeWhere(context, "qaqc"), id },
        select: {
          id: true,
          reference: true,
          title: true,
          description: true,
          type: true,
          severity: true,
          status: true,
          dueDate: true,
          closedAt: true,
          createdAt: true,
          updatedAt: true,
          project: { select: { name: true } },
          assignee: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      });

      if (!row) return null;

      return {
        id: row.id,
        title: row.reference,
        subtitle: row.title,
        status: row.status,
        description: row.description,
        fields: [
          { label: "Type", value: statusLabel(row.type) },
          { label: "Project", value: orDash(row.project?.name) },
          { label: "Severity", value: orDash(row.severity && statusLabel(row.severity)) },
          { label: "Due", value: row.dueDate ? formatDate(row.dueDate) : "—" },
          {
            label: "Assigned to",
            value: row.assignee
              ? `${row.assignee.user.firstName} ${row.assignee.user.lastName}`
              : "—",
          },
        ],
        meta: auditMeta(row),
        approval: { status: row.status, pending: row.status !== "CLOSED" },
      };
    },
    async decide(context, id, decision) {
      await decideRecord(context, {
        module: "qaqc",
        entityType: "QualityRecord",
        id,
        decision,
        permission: "qaqc.record.close",
        find: () =>
          prisma.qualityRecord.findFirst({
            where: { ...buildProjectLinkedScopeWhere(context, "qaqc"), id },
            select: { id: true, status: true, reference: true },
          }),
        pendingStatus: null,
        apply: (tx, approved) =>
          tx.qualityRecord.update({
            where: { id },
            data: {
              status: approved ? "CLOSED" : "IN_PROGRESS",
              closedAt: approved ? new Date() : null,
              updatedBy: context.userId,
            },
          }),
        label: (record) => record.reference,
        verbs: { approve: "closed", reject: "reopened" },
      });
    },
  };
}

function hseSection(
  section: string,
  type: "INCIDENT" | "INSPECTION" | "PERMIT" | "CORRECTIVE_ACTION" | null,
): RecordSection {
  const label = type ? statusLabel(type) : "HSE record";

  return {
    module: "hse",
    section,
    singular: label,
    plural: `${label}s`,
    emptyTitle: `No ${label.toLowerCase()} records.`,
    emptyDescription: "HSE records raised on your projects will appear here.",
    permission: "hse.record.view",
    approvePermission: "hse.record.close",
    columns: [
      { key: "reference", label: "Reference" },
      { key: "title", label: "Title", hideBelow: "md" },
      { key: "project", label: "Project", hideBelow: "lg" },
      { key: "severity", label: "Severity", hideBelow: "xl" },
      { key: "status", label: "Status" },
    ],
    filters: [statusFilter([...WORK_STATUSES])],
    async list(context, args) {
      const where: Prisma.HseRecordWhereInput = {
        ...buildProjectLinkedScopeWhere(context, "hse"),
        ...(type ? { type } : {}),
        ...(enumValue(args.filters.status, WORK_STATUSES)
          ? { status: enumValue(args.filters.status, WORK_STATUSES) }
          : {}),
        ...(searchClause(args.search, ["reference", "title"]) ?? {}),
      };

      const [rows, total] = await Promise.all([
        prisma.hseRecord.findMany({
          where,
          orderBy: [{ status: "asc" }, { severity: "desc" }],
          skip: skipFor(args.page, args.limit),
          take: args.limit,
          select: {
            id: true,
            reference: true,
            title: true,
            severity: true,
            status: true,
            project: { select: { name: true } },
          },
        }),
        prisma.hseRecord.count({ where }),
      ]);

      return {
        total,
        rows: rows.map((row) => ({
          id: row.id,
          primary: row.reference,
          secondary: row.title,
          status: row.status,
          fields: [
            { key: "reference", label: "Reference", value: row.reference },
            { key: "title", label: "Title", value: row.title, hideBelow: "md" as const },
            { key: "project", label: "Project", value: orDash(row.project?.name), hideBelow: "lg" as const },
            {
              key: "severity",
              label: "Severity",
              value: orDash(row.severity && statusLabel(row.severity)),
              hideBelow: "xl" as const,
            },
            { key: "status", label: "Status", value: row.status, status: true },
          ],
        })),
      };
    },
    async get(context, id) {
      const row = await prisma.hseRecord.findFirst({
        where: { ...buildProjectLinkedScopeWhere(context, "hse"), id },
        select: {
          id: true,
          reference: true,
          title: true,
          description: true,
          type: true,
          severity: true,
          status: true,
          occurredAt: true,
          closedAt: true,
          createdAt: true,
          updatedAt: true,
          project: { select: { name: true } },
          assignee: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      });

      if (!row) return null;

      return {
        id: row.id,
        title: row.reference,
        subtitle: row.title,
        status: row.status,
        description: row.description,
        fields: [
          { label: "Type", value: statusLabel(row.type) },
          { label: "Project", value: orDash(row.project?.name) },
          { label: "Severity", value: orDash(row.severity && statusLabel(row.severity)) },
          { label: "Occurred", value: row.occurredAt ? formatDate(row.occurredAt) : "—" },
          {
            label: "Assigned to",
            value: row.assignee
              ? `${row.assignee.user.firstName} ${row.assignee.user.lastName}`
              : "—",
          },
        ],
        meta: auditMeta(row),
        approval: { status: row.status, pending: row.status !== "CLOSED" },
      };
    },
    async decide(context, id, decision) {
      await decideRecord(context, {
        module: "hse",
        entityType: "HseRecord",
        id,
        decision,
        permission: "hse.record.close",
        find: () =>
          prisma.hseRecord.findFirst({
            where: { ...buildProjectLinkedScopeWhere(context, "hse"), id },
            select: { id: true, status: true, reference: true },
          }),
        pendingStatus: null,
        apply: (tx, approved) =>
          tx.hseRecord.update({
            where: { id },
            data: {
              status: approved ? "CLOSED" : "IN_PROGRESS",
              closedAt: approved ? new Date() : null,
              updatedBy: context.userId,
            },
          }),
        label: (record) => record.reference,
        verbs: { approve: "closed", reject: "reopened" },
      });
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Support                                                                     */
/* -------------------------------------------------------------------------- */

const supportRequests: RecordSection = {
  module: "support",
  section: "requests",
  singular: "Support request",
  plural: "Support requests",
  emptyTitle: "No support requests.",
  emptyDescription: "Requests raised with the platform team will appear here.",
  permission: "support.request.view",
  columns: [
    { key: "reference", label: "Reference" },
    { key: "subject", label: "Subject", hideBelow: "md" },
    { key: "requester", label: "Raised by", hideBelow: "lg" },
    { key: "status", label: "Status" },
  ],
  filters: [statusFilter(["OPEN", "IN_PROGRESS", "RESOLVED"])],
  async list(context, args) {
    const statuses = ["OPEN", "IN_PROGRESS", "RESOLVED"] as const;
    const where: Prisma.SupportRequestWhereInput = {
      companyId: context.companyId,
      ...(enumValue(args.filters.status, statuses)
        ? { status: enumValue(args.filters.status, statuses) }
        : {}),
      ...(searchClause(args.search, ["reference", "subject"]) ?? {}),
    };

    const [rows, total] = await Promise.all([
      prisma.supportRequest.findMany({
        where,
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        skip: skipFor(args.page, args.limit),
        take: args.limit,
        select: {
          id: true,
          reference: true,
          subject: true,
          status: true,
          requester: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      }),
      prisma.supportRequest.count({ where }),
    ]);

    return {
      total,
      rows: rows.map((row) => ({
        id: row.id,
        primary: row.reference,
        secondary: row.subject,
        status: row.status,
        fields: [
          { key: "reference", label: "Reference", value: row.reference },
          { key: "subject", label: "Subject", value: row.subject, hideBelow: "md" as const },
          {
            key: "requester",
            label: "Raised by",
            value: row.requester
              ? `${row.requester.user.firstName} ${row.requester.user.lastName}`
              : "—",
            hideBelow: "lg" as const,
          },
          { key: "status", label: "Status", value: row.status, status: true },
        ],
      })),
    };
  },
  async get(context, id) {
    const row = await prisma.supportRequest.findFirst({
      where: { companyId: context.companyId, id },
      select: {
        id: true,
        reference: true,
        subject: true,
        body: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        requester: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    });

    if (!row) return null;

    return {
      id: row.id,
      title: row.reference,
      subtitle: row.subject,
      status: row.status,
      description: row.body,
      fields: [
        {
          label: "Raised by",
          value: row.requester
            ? `${row.requester.user.firstName} ${row.requester.user.lastName}`
            : "—",
        },
      ],
      meta: auditMeta(row),
    };
  },
};

/* -------------------------------------------------------------------------- */
/* Approval shell                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The shared approval action (PRD #7 §51, §53).
 *
 * The granular `resource.approve` permission is authoritative — an access level
 * of APPROVE alone is not enough (PRD #5 §86). The decision, the audit fields
 * and the activity entry commit together.
 */
async function decideRecord<T extends { id: string; status: string }>(
  context: UserContext,
  options: {
    module: string;
    entityType: string;
    id: string;
    decision: "APPROVE" | "REJECT";
    permission: Parameters<typeof can>[1];
    find: () => Promise<T | null>;
    /** The status a record must hold to be decided; null means "any but closed". */
    pendingStatus: string | null;
    apply: (tx: Prisma.TransactionClient, approved: boolean) => Promise<unknown>;
    label: (record: T) => string;
    verbs?: { approve: string; reject: string };
  },
): Promise<void> {
  if (!can(context, options.permission)) throw new AccessError("FORBIDDEN");

  const record = await options.find();
  if (!record) throw new AccessError("NOT_FOUND");

  const approved = options.decision === "APPROVE";

  if (options.pendingStatus && record.status !== options.pendingStatus) {
    throw new AccessError("CONFLICT", "This record is no longer awaiting a decision.");
  }
  if (!options.pendingStatus && record.status === "CLOSED" && approved) {
    throw new AccessError("CONFLICT", "This record is already closed.");
  }

  const verbs = options.verbs ?? { approve: "approved", reject: "rejected" };

  await prisma.$transaction(async (tx) => {
    await options.apply(tx, approved);
    await recordActivity(tx, context, {
      module: options.module,
      entityType: options.entityType,
      entityId: record.id,
      action: approved ? "RECORD_APPROVED" : "RECORD_REJECTED",
      message: `${approved ? verbs.approve : verbs.reject} ${options.label(record)}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

const SECTIONS: RecordSection[] = [
  ...CORE_SECTIONS,
  // Finance has its own module now (PRD #15), so its sections are gone from
  // the shell registry: two implementations of "list the invoices" is one too
  // many, and the shell's was the placeholder.
  // HR has its own module now (PRD #16), so its sections are gone from the
  // shell registry — the shell's leave list had no employment record behind it.
  // Sales has its own module now (PRD #17): the shell's "opportunity" was a
  // name, a value and a stage, with no lead in front of it and no proposal
  // behind it.
  contracts,
  { ...contracts, section: "approvals" },
  { ...contracts, section: "archived" },
  purchaseRequests,
  { ...purchaseRequests, section: "approvals" },
  purchaseOrders,
  inventoryItemSection("items", false),
  inventoryItemSection("low-stock", true),
  movements,
  qualitySection("inspections", "INSPECTION"),
  qualitySection("ncrs", "NCR"),
  qualitySection("punch-lists", "PUNCH_ITEM"),
  qualitySection("tests", "TEST"),
  hseSection("incidents", "INCIDENT"),
  hseSection("inspections", "INSPECTION"),
  hseSection("permits", "PERMIT"),
  hseSection("actions", "CORRECTIVE_ACTION"),
  supportRequests,
];

const BY_KEY = new Map(SECTIONS.map((section) => [`${section.module}:${section.section}`, section]));

export function findRecordSection(moduleKey: string, section: string): RecordSection | undefined {
  return BY_KEY.get(`${moduleKey}:${section}`);
}

export function recordSectionsFor(moduleKey: string): RecordSection[] {
  return SECTIONS.filter((section) => section.module === moduleKey);
}
