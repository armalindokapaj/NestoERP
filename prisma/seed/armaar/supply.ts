/**
 * ARMAAR's supply chain, deepened (D-02 §22, §23, §64, §73).
 *
 * D-01 bought Tirana Lake's rebar, concrete and switchgear. D-02 adds the
 * suppliers a developer of this size buys from — tiles, sanitary ware, doors,
 * lifts, waterproofing, PPE, cement, cable — and the requests and orders of the
 * other working companies, so every state of the product's buying workflow is
 * on screen somewhere: a draft, a request waiting, one sent back, an order
 * waiting, approved, issued, part-delivered, delivered and closed.
 *
 * Each order the product would have approved has the Finance commitment that
 * approving it opens, filed under the order with its integration link — D-01's
 * orders too, which were seeded without one (PRD #19 §116, PRD #48 §143). The
 * commitment of a closed order is closed.
 *
 * Numbers are in the product's own series shape (`PR-2026-0056`), so the next
 * number the product allocates follows them. Tax numbers begin with X: no
 * Albanian NIPT does. Every value is synthetic (§5). Stable ids; a rerun adds
 * nothing.
 */
import { Prisma, type PrismaClient, type ProcurementCategory, type PurchaseOrderStatus, type PurchaseRequestStatus } from "@prisma/client";

import { buildIdempotencyKey, IntegrationType } from "../../../lib/core/integrations/integration.registry";
import { addLocalDays, localDate } from "../../../lib/modules/calendar/calendar.time";
import { memberId } from "./access";
import { supplierId } from "./operations";
import { companyId } from "./organization";
import { projectId } from "./projects";
import type { CompanyCode, ProjectCode } from "./public-facts";
import { ARMAAR_GROUP_ID } from "./records";

const ZONE = "Europe/Tirane";
const EUR = "EUR";
const TAX = 0.2;
const BCI = "BUILDING_CONSTRUCTION_INVEST" as const;
const ALN = "ARLIS_NDERTIM" as const;
const IDEAL = "IDEAL_CONSTRUCTION" as const;
const SMI = "SARANDA_MARINA_INVEST" as const;
const ARSOL = "ARSOL_ENERGY" as const;
const money = (value: number) => new Prisma.Decimal(value.toFixed(2));
const qty = (value: number) => new Prisma.Decimal(value.toFixed(4));
const normalizeSupplier = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Who buys, and who approves, in each company. */
const BUYER: Partial<Record<CompanyCode, string>> = { [BCI]: "bci.procurement", [ALN]: "arlis.procurement", [IDEAL]: "ideal.procurement", [ARSOL]: "arsol.procurement", [SMI]: "armaar.procurement" };
const APPROVER: Partial<Record<CompanyCode, string>> = { [BCI]: "bci.director", [ALN]: "arlis.director", [IDEAL]: "ideal.director", [ARSOL]: "arsol.director", [SMI]: "smi.director" };

/** Continues D-01's register: SUP-001 to SUP-009 are its nine. */
const SUPPLIERS: Array<{ key: string; name: string; taxId: string; category: string; companies: CompanyCode[] }> = [
  { key: "hidroizol", name: "HidroIzol Albania sh.p.k.", taxId: "X90000010K", category: "Waterproofing membranes and works", companies: [BCI] },
  { key: "aquatek", name: "AquaTek Instalime sh.p.k.", taxId: "X90000011L", category: "Plumbing and drainage", companies: [BCI, ALN] },
  { key: "liftech", name: "Liftech Balkans sh.p.k.", taxId: "X90000012M", category: "Lifts and escalators", companies: [BCI, SMI] },
  { key: "adria_tiles", name: "Adria Tiles & Stone sh.p.k.", taxId: "X90000013N", category: "Ceramic tiles and natural stone", companies: [BCI, ALN] },
  { key: "sanitaria", name: "Sanitaria Pro sh.p.k.", taxId: "X90000014P", category: "Sanitary fixtures and fittings", companies: [BCI] },
  { key: "porta_nova", name: "Porta Nova sh.p.k.", taxId: "X90000015Q", category: "Doors and ironmongery", companies: [BCI] },
  { key: "mobilia", name: "Mobilia Contract sh.p.k.", taxId: "X90000016R", category: "Furniture, fixtures and equipment", companies: [BCI] },
  { key: "safework", name: "SafeWork Albania sh.p.k.", taxId: "X90000017S", category: "PPE and site safety equipment", companies: [ALN, IDEAL] },
  { key: "fushe_cement", name: "Fushë-Kruja Cement Trading sh.p.k.", taxId: "X90000018T", category: "Cement and binders", companies: [ALN] },
  { key: "balkan_cable", name: "Balkan Cable & Wire sh.p.k.", taxId: "X90000019U", category: "Power and solar cable", companies: [ARSOL] },
  { key: "geotest", name: "GeoTest Albania sh.p.k.", taxId: "X90000020V", category: "Geotechnical investigation and testing", companies: [BCI] },
];

type Chain = {
  key: string;
  company: CompanyCode;
  project: ProjectCode | null;
  supplier: string;
  request: { number: string; title: string; status: PurchaseRequestStatus; submitted: number | null; priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; requester: string; rejected?: string };
  item: { description: string; category: ProcurementCategory; quantity: number; unit: string; estimate: number };
  order?: { number: string; status: PurchaseOrderStatus; placed: number; leadDays: number; price: number };
  receipts?: Array<{ number: string; share: number; day: number }>;
};

/**
 * The chains, company by company. Where a request has an order its status is
 * what the product derives from the order (ORDERED, or COMPLETED once the
 * order is received or closed).
 */
const CHAINS: Chain[] = [
  /* BUILDING CONSTRUCTION INVEST — Tirana Lake and United Towers ------------ */
  {
    key: "tl_tiles", company: BCI, project: "TIRANA_LAKE", supplier: "adria_tiles",
    request: { number: "PR-2026-0056", title: "Porcelain tiles — Tower A apartments, levels 1 to 6", status: "ORDERED", submitted: -30, requester: "bci.pm" },
    item: { description: "Porcelain floor tiles 60×60, rectified, grade 1", category: "MATERIALS", quantity: 4_200, unit: "m²", estimate: 24 },
    order: { number: "PO-2026-0040", status: "ISSUED", placed: -26, leadDays: 35, price: 22.5 },
  },
  {
    key: "tl_sanitary", company: BCI, project: "TIRANA_LAKE", supplier: "sanitaria",
    request: { number: "PR-2026-0058", title: "Sanitary fixtures — Tower A apartments", status: "PENDING_APPROVAL", submitted: -3, requester: "bci.pm" },
    item: { description: "WC, basin and shower sets with fittings", category: "MATERIALS", quantity: 96, unit: "set", estimate: 640 },
  },
  {
    key: "tl_membrane", company: BCI, project: "TIRANA_LAKE", supplier: "hidroizol",
    request: { number: "PR-2026-0061", title: "Waterproofing membrane — podium roof", status: "COMPLETED", submitted: -75, requester: "bci.engineering" },
    item: { description: "Bituminous membrane, two layers, with PIR insulation", category: "MATERIALS", quantity: 3_100, unit: "m²", estimate: 38 },
    order: { number: "PO-2026-0042", status: "RECEIVED", placed: -70, leadDays: 20, price: 36 },
    receipts: [{ number: "GRN-2026-0068", share: 1, day: -52 }],
  },
  {
    key: "tl_ahu", company: BCI, project: "TIRANA_LAKE", supplier: "klimatek",
    request: { number: "PR-2026-0063", title: "Air handling units — Tower B plant room", status: "ORDERED", submitted: -38, priority: "HIGH", requester: "arlis.mep" },
    item: { description: "AHU 12,000 m³/h with heat recovery", category: "EQUIPMENT", quantity: 6, unit: "each", estimate: 42_000 },
    order: { number: "PO-2026-0044", status: "PARTIALLY_RECEIVED", placed: -33, leadDays: 30, price: 40_500 },
    receipts: [{ number: "GRN-2026-0071", share: 0.5, day: -6 }],
  },
  {
    key: "tl_glass", company: BCI, project: "TIRANA_LAKE", supplier: "vlora_glass",
    request: { number: "PR-2026-0064", title: "Balcony glass balustrades — Tower A", status: "REJECTED", submitted: -14, requester: "bci.architect", rejected: "Re-quote in laminated safety glass to EN 12600; this quote was for toughened glass only." },
    item: { description: "Glass balustrade panels with stainless handrail", category: "MATERIALS", quantity: 410, unit: "m", estimate: 290 },
  },
  {
    key: "tl_furniture", company: BCI, project: "TIRANA_LAKE", supplier: "mobilia",
    request: { number: "PR-2026-0066", title: "Show apartment furniture — Tower A level 5", status: "COMPLETED", submitted: -24, requester: "bci.sales" },
    item: { description: "Show apartment furniture and accessories, turnkey", category: "MATERIALS", quantity: 1, unit: "lot", estimate: 38_000 },
    order: { number: "PO-2026-0046", status: "RECEIVED", placed: -21, leadDays: 14, price: 36_800 },
    receipts: [{ number: "GRN-2026-0070", share: 1, day: -8 }],
  },
  {
    key: "ut_geotech", company: BCI, project: "UNITED_TOWERS", supplier: "geotest",
    request: { number: "PR-2026-0065", title: "Geotechnical investigation — United Towers plot", status: "ORDERED", submitted: -20, requester: "bci.pm-lead" },
    item: { description: "Boreholes to 40 m with laboratory testing and report", category: "SERVICES", quantity: 1, unit: "lot", estimate: 68_000 },
    order: { number: "PO-2026-0045", status: "APPROVED", placed: -15, leadDays: 45, price: 64_500 },
  },

  /* ARLIS - NDERTIM — The Courtyard ------------------------------------------ */
  {
    key: "tc_cement", company: ALN, project: "THE_COURTYARD", supplier: "fushe_cement",
    request: { number: "PR-2026-0012", title: "Cement CEM II/A-M 42.5 — Courtyard block 3", status: "COMPLETED", submitted: -40, requester: "arlis.pm-lead" },
    item: { description: "Cement CEM II/A-M 42.5, bagged", category: "MATERIALS", quantity: 180, unit: "t", estimate: 118 },
    order: { number: "PO-2026-0009", status: "RECEIVED", placed: -37, leadDays: 7, price: 112 },
    receipts: [{ number: "GRN-2026-0011", share: 1, day: -30 }],
  },
  {
    key: "tc_ppe", company: ALN, project: "THE_COURTYARD", supplier: "safework",
    request: { number: "PR-2026-0010", title: "PPE restock — hard hats, harnesses and gloves", status: "COMPLETED", submitted: -60, requester: "arlis.hse" },
    item: { description: "PPE kit: hard hat, harness, lanyard, gloves, hi-vis", category: "EQUIPMENT", quantity: 120, unit: "set", estimate: 85 },
    order: { number: "PO-2026-0008", status: "CLOSED", placed: -58, leadDays: 5, price: 79 },
    receipts: [{ number: "GRN-2026-0009", share: 1, day: -52 }],
  },
  {
    key: "tc_fittings", company: ALN, project: "THE_COURTYARD", supplier: "aquatek",
    request: { number: "PR-2026-0016", title: "Plumbing fittings — Courtyard block 2", status: "PENDING_APPROVAL", submitted: -1, requester: "arlis.pm-lead" },
    item: { description: "PPR pipes and fittings, 20–63 mm", category: "MATERIALS", quantity: 1, unit: "lot", estimate: 14_800 },
  },

  /* IDEAL Construction — Farka Residence ------------------------------------- */
  {
    key: "fr_formwork", company: IDEAL, project: "FARKA_RESIDENCE", supplier: "korca_timber",
    request: { number: "PR-2026-0021", title: "Formwork plywood and props — Block C", status: "ORDERED", submitted: -28, requester: "ideal.pm" },
    item: { description: "Film-faced plywood 18 mm and steel props", category: "MATERIALS", quantity: 1, unit: "lot", estimate: 27_500 },
    order: { number: "PO-2026-0017", status: "PARTIALLY_RECEIVED", placed: -25, leadDays: 10, price: 26_400 },
    receipts: [{ number: "GRN-2026-0019", share: 0.7, day: -14 }],
  },

  /* Saranda Marina Invest — Gran Melia --------------------------------------- */
  {
    key: "gm_lifts", company: SMI, project: "GRAN_MELIA", supplier: "liftech",
    request: { number: "PR-2026-0004", title: "Lift package — hotel block", status: "ORDERED", submitted: -18, requester: "smi.pm" },
    item: { description: "Passenger lifts 1,000 kg, six stops, machine-room-less", category: "EQUIPMENT", quantity: 4, unit: "each", estimate: 58_000 },
    order: { number: "PO-2026-0003", status: "PENDING_APPROVAL", placed: -3, leadDays: 90, price: 56_500 },
  },

  /* ARSOL ENERGY — the rooftop programme, no project ------------------------- */
  {
    key: "as_modules", company: ARSOL, project: null, supplier: "solartech",
    request: { number: "PR-2026-0007", title: "PV modules 550 Wp — rooftop programme, batch 2", status: "ORDERED", submitted: -22, requester: "arsol.pm" },
    item: { description: "Monocrystalline PV modules 550 Wp", category: "EQUIPMENT", quantity: 1_800, unit: "each", estimate: 118 },
    order: { number: "PO-2026-0006", status: "ISSUED", placed: -18, leadDays: 40, price: 112 },
  },
];

const APPROVED_ORDER: PurchaseOrderStatus[] = ["APPROVED", "ISSUED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"];

export async function seedArmaarSupply(prisma: PrismaClient) {
  const today = localDate(new Date(), ZONE);
  const day = (offset: number) => new Date(`${addLocalDays(today, offset)}T12:00:00.000Z`);
  const at = (offset: number, hour = 10) => new Date(`${addLocalDays(today, offset)}T${String(hour).padStart(2, "0")}:00:00.000Z`);

  /* Suppliers (§23) ------------------------------------------------------------ */
  for (const [index, supplier] of SUPPLIERS.entries()) {
    for (const [position, code] of supplier.companies.entries()) {
      const id = supplierId(supplier.key, code);
      await prisma.supplier.upsert({
        where: { id },
        update: {},
        create: {
          id,
          companyId: companyId(code),
          code: `SUP-${String(index + 10).padStart(3, "0")}`,
          name: supplier.name,
          legalName: supplier.name,
          supplierType: "COMPANY",
          taxId: supplier.taxId,
          email: `orders@${supplier.key.replace(/_/g, "-")}.armaar-demo.test`,
          city: "Tirana",
          country: "Albania",
          status: "ACTIVE",
          paymentTermsDays: 30,
          defaultCurrency: EUR,
          notes: supplier.category,
          normalizedName: normalizeSupplier(supplier.name),
          createdByMemberId: memberId(BUYER[code]!, code),
          createdAt: at(-420 + index * 20 + position * 5),
        },
      });
    }
  }

  /* Request → approval → order → delivery (§22, §64) --------------------------- */
  for (const chain of CHAINS) {
    const company = companyId(chain.company);
    const project = chain.project ? projectId(chain.project) : null;
    const requester = memberId(chain.request.requester, chain.company);
    const buyer = memberId(BUYER[chain.company]!, chain.company);
    const approver = memberId(APPROVER[chain.company]!, chain.company);
    const requestId = `armaar_pr_${chain.key}`;
    const requestItemId = `${requestId}_item_1`;
    const submitted = chain.request.submitted;
    const status = chain.request.status;
    const decidedAt = submitted === null ? null : at(submitted + 1, 11);
    const approved = !["DRAFT", "PENDING_APPROVAL", "REJECTED", "CANCELLED"].includes(status);

    await prisma.purchaseRequest.upsert({
      where: { id: requestId },
      update: {},
      create: {
        id: requestId,
        companyId: company,
        requestNumber: chain.request.number,
        title: chain.request.title,
        projectId: project,
        requestedByMemberId: requester,
        requiredDate: submitted === null ? null : day(submitted + 30),
        priority: chain.request.priority ?? "MEDIUM",
        currency: EUR,
        estimatedTotal: money(chain.item.quantity * chain.item.estimate),
        status,
        submittedAt: submitted === null ? null : at(submitted, 9),
        approvedAt: approved ? decidedAt : null,
        approvedByMemberId: approved ? approver : null,
        rejectedAt: status === "REJECTED" ? decidedAt : null,
        rejectedByMemberId: status === "REJECTED" ? approver : null,
        rejectionReason: chain.request.rejected ?? null,
        createdByMemberId: requester,
        createdAt: at((submitted ?? -1) - 2),
      },
    });
    await prisma.purchaseRequestItem.upsert({
      where: { id: requestItemId },
      update: {},
      create: { id: requestItemId, purchaseRequestId: requestId, description: chain.item.description, quantity: qty(chain.item.quantity), unit: chain.item.unit, estimatedUnitPrice: qty(chain.item.estimate), estimatedAmount: money(chain.item.quantity * chain.item.estimate), category: chain.item.category, sortOrder: 1 },
    });
    if (submitted !== null) {
      const decision = status === "PENDING_APPROVAL" ? "PENDING" : status === "REJECTED" ? "REJECTED" : "APPROVED";
      await prisma.procurementApproval.upsert({
        where: { id: `${requestId}_approval` },
        update: {},
        create: {
          id: `${requestId}_approval`,
          companyId: company,
          recordType: "PURCHASE_REQUEST",
          recordId: requestId,
          status: decision,
          submittedByMemberId: requester,
          submittedAt: at(submitted, 9),
          decidedByMemberId: decision === "PENDING" ? null : approver,
          decidedAt: decision === "PENDING" ? null : decidedAt,
          decisionNote: decision === "REJECTED" ? chain.request.rejected! : decision === "APPROVED" ? "Within budget." : null,
        },
      });
    }

    const order = chain.order;
    if (!order) continue;
    const orderId = `armaar_po_${chain.key}`;
    const subtotal = chain.item.quantity * order.price;
    const orderApproved = APPROVED_ORDER.includes(order.status);
    const issued = orderApproved && order.status !== "APPROVED";
    await prisma.purchaseOrder.upsert({
      where: { id: orderId },
      update: {},
      create: {
        id: orderId,
        companyId: company,
        poNumber: order.number,
        supplierId: supplierId(chain.supplier, chain.company),
        purchaseRequestId: requestId,
        projectId: project,
        orderDate: day(order.placed),
        requiredDate: day(order.placed + order.leadDays),
        currency: EUR,
        subtotal: money(subtotal),
        taxAmount: money(subtotal * TAX),
        totalAmount: money(subtotal * (1 + TAX)),
        status: order.status,
        submittedAt: at(order.placed, 10),
        approvedAt: orderApproved ? at(order.placed + 1, 11) : null,
        approvedByMemberId: orderApproved ? approver : null,
        issuedAt: issued ? at(order.placed + 1, 15) : null,
        closedAt: order.status === "CLOSED" ? at((chain.receipts?.at(-1)?.day ?? order.placed) + 2, 16) : null,
        createdByMemberId: buyer,
        createdAt: at(order.placed, 9),
      },
    });
    await prisma.purchaseOrderItem.upsert({
      where: { id: `${orderId}_item_1` },
      update: {},
      create: { id: `${orderId}_item_1`, purchaseOrderId: orderId, sourceRequestItemId: requestItemId, description: chain.item.description, quantity: qty(chain.item.quantity), unit: chain.item.unit, unitPrice: qty(order.price), taxRate: new Prisma.Decimal(TAX.toFixed(4)), subtotal: money(subtotal), taxAmount: money(subtotal * TAX), totalAmount: money(subtotal * (1 + TAX)), sortOrder: 1 },
    });
    await prisma.procurementApproval.upsert({
      where: { id: `${orderId}_approval` },
      update: {},
      create: {
        id: `${orderId}_approval`,
        companyId: company,
        recordType: "PURCHASE_ORDER",
        recordId: orderId,
        status: orderApproved ? "APPROVED" : "PENDING",
        submittedByMemberId: buyer,
        submittedAt: at(order.placed, 10),
        decidedByMemberId: orderApproved ? approver : null,
        decidedAt: orderApproved ? at(order.placed + 1, 11) : null,
      },
    });
    for (const receipt of chain.receipts ?? []) {
      const receiptId = `armaar_grn_${chain.key}_${receipt.number.slice(-4)}`;
      const received = chain.item.quantity * receipt.share;
      await prisma.goodsReceipt.upsert({
        where: { id: receiptId },
        update: {},
        create: { id: receiptId, companyId: company, receiptNumber: receipt.number, purchaseOrderId: orderId, projectId: project, supplierId: supplierId(chain.supplier, chain.company), receiptDate: day(receipt.day), deliveryReference: `DN-${receipt.number.slice(-4)}`, status: "RECORDED", receivedByMemberId: memberId(chain.company === BCI ? "arlis.inventory" : BUYER[chain.company]!, chain.company), createdByMemberId: buyer, createdAt: at(receipt.day, 15) },
      });
      await prisma.goodsReceiptItem.upsert({
        where: { id: `${receiptId}_item_1` },
        update: {},
        create: { id: `${receiptId}_item_1`, goodsReceiptId: receiptId, purchaseOrderItemId: `${orderId}_item_1`, receivedQuantity: qty(received), acceptedQuantity: qty(received), rejectedQuantity: qty(0) },
      });
    }
  }

  const commitments = await seedOrderCommitments(prisma);
  return {
    suppliers: await prisma.supplier.count({ where: { company: { parentGroupId: ARMAAR_GROUP_ID } } }),
    requests: await prisma.purchaseRequest.count({ where: { company: { parentGroupId: ARMAAR_GROUP_ID } } }),
    orders: await prisma.purchaseOrder.count({ where: { company: { parentGroupId: ARMAAR_GROUP_ID } } }),
    receipts: await prisma.goodsReceipt.count({ where: { company: { parentGroupId: ARMAAR_GROUP_ID } } }),
    commitments,
  };
}

/**
 * The commitment approving an order opens (PRD #19 §116-§121; `syncCommitment`
 * in the order service): one per order, keyed on the order, APPROVED — CLOSED
 * once the order is — with the order pointing at it and the integration link
 * that answers where it came from. Every approved ARMAAR order, whichever seed
 * wrote it.
 */
async function seedOrderCommitments(prisma: PrismaClient): Promise<number> {
  const orders = await prisma.purchaseOrder.findMany({
    where: { company: { parentGroupId: ARMAAR_GROUP_ID }, status: { in: APPROVED_ORDER } },
    select: { id: true, companyId: true, poNumber: true, projectId: true, currency: true, totalAmount: true, requiredDate: true, status: true, approvedAt: true, approvedByMemberId: true, createdByMemberId: true, financeCommitmentId: true, supplier: { select: { name: true } } },
  });
  for (const order of orders) {
    const source = { companyId: order.companyId, sourceModule: "procurement", sourceEntityType: "purchase_order", sourceEntityId: order.id };
    const approver = order.approvedByMemberId ?? order.createdByMemberId;
    const commitment = await prisma.commitment.upsert({
      where: { companyId_sourceModule_sourceEntityType_sourceEntityId: source },
      update: {},
      create: {
        id: `armaar_cmt_${order.id.replace(/^armaar_/, "")}`,
        ...source,
        projectId: order.projectId,
        reference: order.poNumber,
        description: `Purchase order ${order.poNumber}`,
        counterpartyName: order.supplier.name,
        category: "MATERIALS",
        currency: order.currency,
        amount: order.totalAmount,
        expectedDate: order.requiredDate,
        status: order.status === "CLOSED" ? "CLOSED" : "APPROVED",
        createdByMemberId: approver,
        createdAt: order.approvedAt ?? undefined,
      },
      select: { id: true },
    });
    if (order.financeCommitmentId !== commitment.id) await prisma.purchaseOrder.update({ where: { id: order.id }, data: { financeCommitmentId: commitment.id } });
    const type = IntegrationType.PROCUREMENT_PO_FINANCE_COMMITMENT;
    const idempotencyKey = buildIdempotencyKey(order.companyId, type, order.id);
    await prisma.integrationLink.upsert({
      where: { companyId_integrationType_idempotencyKey: { companyId: order.companyId, integrationType: type, idempotencyKey } },
      update: {},
      create: { companyId: order.companyId, integrationType: type, mode: "SYNCHRONIZE", sourceModule: "procurement", sourceEntityType: "purchase_order", sourceEntityId: order.id, targetModule: "finance", targetEntityType: "commitment", targetEntityId: commitment.id, idempotencyKey, createdByMemberId: approver, createdAt: order.approvedAt ?? undefined },
    });
  }
  return orders.length;
}
