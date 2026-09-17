/**
 * Procurement fixtures (PRD #19 §294–§307).
 *
 * Every state the module has to render is present, because a screen that has
 * never been seen with data in it has never really been built:
 *
 *   suppliers   12, across COMPANY / INDIVIDUAL / PUBLIC_ENTITY and
 *               ACTIVE / INACTIVE / ARCHIVED (§294, §295)
 *   requests    20, covering all nine live statuses, across four projects and
 *               two company-general asks (§296, §297)
 *   RFQs        10, in DRAFT / ISSUED / CLOSED / CANCELLED, with invited
 *               suppliers and priced items (§298)
 *   quotes      24, in RECEIVED / SELECTED / NOT_SELECTED / DISQUALIFIED, so
 *               the comparison screen has something to rank (§299)
 *   orders      16, covering every status including PARTIALLY_RECEIVED (§300)
 *   receipts    18, including partials, a void and rejected quantities (§301)
 *   approvals   pending and decided, on both requests and orders (§302)
 *
 * The seed is idempotent: everything is addressed by a deterministic id and
 * upserted, so re-running it on an existing database converges rather than
 * duplicating.
 */
import { Prisma, type PrismaClient } from "@prisma/client";

import { COMPANY_A, FIXTURE_TENANT, PROJECT_IDS, daysFromNow, type SeedMembers } from "./constants";

type Members = SeedMembers;

const EUR = "EUR";

/** Two decimals for money, four for quantity — the schema's own precision. */
const money = (value: number) => new Prisma.Decimal(value.toFixed(2));
const qty = (value: number) => new Prisma.Decimal(value.toFixed(4));

export async function seedProcurementRecords(prisma: PrismaClient, members: Members) {
  const procurement = members.get("user_procurement")!;
  const pm = members.get("user_pm")!;
  const ceo = members.get("user_ceo")!;
  const owner = members.get("user_owner")!;
  const inventory = members.get("user_inventory")!;

  await seedSuppliers(prisma, procurement);
  await seedRequests(prisma, { procurement, pm, ceo });
  await seedRfqs(prisma, procurement);
  await seedQuotes(prisma, procurement);
  await seedOrders(prisma, { procurement, ceo, owner });
  await seedReceipts(prisma, { procurement, inventory });
  await seedApprovals(prisma, { procurement, pm, ceo, owner });
  await seedCompanyBProcurement(prisma);

  return {
    suppliers: await prisma.supplier.count({ where: { companyId: COMPANY_A } }),
    requests: await prisma.purchaseRequest.count({ where: { companyId: COMPANY_A } }),
    rfqs: await prisma.rFQ.count({ where: { companyId: COMPANY_A } }),
    quotes: await prisma.supplierQuote.count({ where: { companyId: COMPANY_A } }),
    orders: await prisma.purchaseOrder.count({ where: { companyId: COMPANY_A } }),
    receipts: await prisma.goodsReceipt.count({ where: { companyId: COMPANY_A } }),
  };
}

/* -------------------------------------------------------------------------- */
/* Suppliers (PRD #19 §294, §295)                                              */
/* -------------------------------------------------------------------------- */

type SupplierFixture = {
  id: string;
  code: string;
  name: string;
  legalName?: string;
  type: "COMPANY" | "INDIVIDUAL" | "PUBLIC_ENTITY" | "OTHER";
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  country: string;
  terms?: number;
  email?: string;
};

const SUPPLIERS: SupplierFixture[] = [
  { id: "supplier_atlas", code: "SUP-001", name: "Atlas Materials", legalName: "Atlas Materials sh.p.k.", type: "COMPANY", status: "ACTIVE", country: "Albania", terms: 30, email: "orders@atlas-materials.test" },
  { id: "supplier_nordsteel", code: "SUP-002", name: "Nordsteel GmbH", legalName: "Nordsteel Handels GmbH", type: "COMPANY", status: "ACTIVE", country: "Germany", terms: 45, email: "sales@nordsteel.test" },
  { id: "supplier_buildpro", code: "SUP-003", name: "BuildPro Systems", legalName: "BuildPro Systems Ltd", type: "COMPANY", status: "ACTIVE", country: "United Kingdom", terms: 30, email: "hello@buildpro.test" },
  { id: "supplier_delta", code: "SUP-004", name: "Delta Equipment", legalName: "Delta Equipment Rental sh.a.", type: "COMPANY", status: "ACTIVE", country: "Albania", terms: 15, email: "rental@delta-equipment.test" },
  { id: "supplier_alba", code: "SUP-005", name: "Alba Concrete", legalName: "Alba Concrete Works sh.p.k.", type: "COMPANY", status: "ACTIVE", country: "Albania", terms: 30 },
  { id: "supplier_meridian", code: "SUP-006", name: "Meridian Services", legalName: "Meridian Technical Services", type: "COMPANY", status: "ACTIVE", country: "Italy", terms: 60 },
  { id: "supplier_kastrati", code: "SUP-007", name: "E. Kastrati", type: "INDIVIDUAL", status: "ACTIVE", country: "Albania", terms: 14 },
  { id: "supplier_hoxha", code: "SUP-008", name: "A. Hoxha Surveying", type: "INDIVIDUAL", status: "ACTIVE", country: "Albania", terms: 14 },
  { id: "supplier_municipality", code: "SUP-009", name: "Tirana Municipal Utilities", type: "PUBLIC_ENTITY", status: "ACTIVE", country: "Albania", terms: 0 },
  { id: "supplier_portauth", code: "SUP-010", name: "Durrës Port Authority", type: "PUBLIC_ENTITY", status: "ACTIVE", country: "Albania", terms: 0 },
  { id: "supplier_legacy", code: "SUP-011", name: "Legacy Scaffold Hire", type: "COMPANY", status: "INACTIVE", country: "Albania", terms: 30 },
  { id: "supplier_retired", code: "SUP-012", name: "Retired Plant Supplies", type: "COMPANY", status: "ARCHIVED", country: "Albania", terms: 30 },
];

/** Matches the service's own normaliser, so duplicate detection sees the same key. */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function seedSuppliers(prisma: PrismaClient, createdBy: string) {
  for (const supplier of SUPPLIERS) {
    await prisma.supplier.upsert({
      where: { id: supplier.id },
      update: {},
      create: {
        id: supplier.id,
        companyId: COMPANY_A,
        code: supplier.code,
        name: supplier.name,
        legalName: supplier.legalName ?? null,
        supplierType: supplier.type,
        status: supplier.status,
        country: supplier.country,
        email: supplier.email ?? null,
        paymentTermsDays: supplier.terms ?? null,
        defaultCurrency: EUR,
        normalizedName: normalize(supplier.name),
        createdByMemberId: createdBy,
        archivedAt: supplier.status === "ARCHIVED" ? daysFromNow(-90) : null,
        archivedByMemberId: supplier.status === "ARCHIVED" ? createdBy : null,
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Purchase requests (PRD #19 §296, §297)                                      */
/* -------------------------------------------------------------------------- */

type RequestStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "IN_SOURCING"
  | "PARTIALLY_ORDERED"
  | "ORDERED"
  | "COMPLETED"
  | "CANCELLED";

type RequestFixture = {
  id: string;
  number: string;
  title: string;
  status: RequestStatus;
  project: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  requester: "pm" | "procurement";
  items: { description: string; quantity: number; unit: string; price: number; category: "MATERIALS" | "EQUIPMENT" | "SUBCONTRACT" | "SERVICES" | "LOGISTICS" | "OFFICE" | "OTHER" }[];
};

const REQUESTS: RequestFixture[] = [
  { id: "request_001", number: "PR-2026-001", title: "Reinforcement bar — block C", status: "ORDERED", project: PROJECT_IDS.a, priority: "HIGH", requester: "pm",
    items: [{ description: "Rebar B500C 16mm", quantity: 42, unit: "tonne", price: 780, category: "MATERIALS" }, { description: "Rebar B500C 12mm", quantity: 18, unit: "tonne", price: 790, category: "MATERIALS" }] },
  { id: "request_002", number: "PR-2026-002", title: "Ready-mix concrete C30/37", status: "PARTIALLY_ORDERED", project: PROJECT_IDS.a, priority: "HIGH", requester: "pm",
    items: [{ description: "Concrete C30/37 pumped", quantity: 1200, unit: "m3", price: 76, category: "MATERIALS" }] },
  { id: "request_003", number: "PR-2026-003", title: "Scaffolding hire extension", status: "COMPLETED", project: PROJECT_IDS.a, priority: "MEDIUM", requester: "pm",
    items: [{ description: "System scaffold hire, 8 weeks", quantity: 8, unit: "week", price: 1950, category: "EQUIPMENT" }] },
  { id: "request_004", number: "PR-2026-004", title: "Curtain wall package", status: "IN_SOURCING", project: PROJECT_IDS.a, priority: "CRITICAL", requester: "pm",
    items: [{ description: "Unitised curtain wall, supply and install", quantity: 2400, unit: "m2", price: 168, category: "SUBCONTRACT" }] },
  { id: "request_005", number: "PR-2026-005", title: "Basement dewatering pumps", status: "PENDING_APPROVAL", project: PROJECT_IDS.a, priority: "HIGH", requester: "pm",
    items: [{ description: "Submersible pump 15kW", quantity: 4, unit: "each", price: 3800, category: "EQUIPMENT" }, { description: "Discharge hose 100mm", quantity: 120, unit: "m", price: 22, category: "MATERIALS" }] },
  { id: "request_006", number: "PR-2026-006", title: "Site accommodation units", status: "APPROVED", project: PROJECT_IDS.a, priority: "MEDIUM", requester: "procurement",
    items: [{ description: "Site cabin 6m, hire", quantity: 6, unit: "month", price: 420, category: "EQUIPMENT" }] },
  { id: "request_007", number: "PR-2026-007", title: "Riverfront survey equipment", status: "DRAFT", project: PROJECT_IDS.a, priority: "LOW", requester: "pm",
    items: [{ description: "Hydrographic survey, day rate", quantity: 5, unit: "day", price: 1400, category: "SERVICES" }] },
  { id: "request_008", number: "PR-2026-008", title: "Promenade paving samples", status: "REJECTED", project: PROJECT_IDS.a, priority: "LOW", requester: "pm",
    items: [{ description: "Granite paving sample set", quantity: 12, unit: "each", price: 95, category: "MATERIALS" }] },
  { id: "request_009", number: "PR-2026-009", title: "Yard drainage materials", status: "PENDING_APPROVAL", project: PROJECT_IDS.a, priority: "MEDIUM", requester: "pm",
    items: [{ description: "Channel drain 200mm", quantity: 180, unit: "m", price: 48, category: "MATERIALS" }] },
  { id: "request_010", number: "PR-2026-010", title: "Structural steel — phase 2", status: "ORDERED", project: PROJECT_IDS.a, priority: "CRITICAL", requester: "pm",
    items: [{ description: "Fabricated steelwork S355", quantity: 96, unit: "tonne", price: 1850, category: "MATERIALS" }] },
  { id: "request_011", number: "PR-2026-011", title: "Site safety equipment", status: "COMPLETED", project: null, priority: "HIGH", requester: "procurement",
    items: [{ description: "Safety harness kit", quantity: 40, unit: "each", price: 88, category: "OTHER" }, { description: "Hard hat, vented", quantity: 120, unit: "each", price: 14, category: "OTHER" }] },
  { id: "request_012", number: "PR-2026-012", title: "Office IT refresh", status: "CANCELLED", project: null, priority: "LOW", requester: "procurement",
    items: [{ description: "Workstation, mid-spec", quantity: 8, unit: "each", price: 1250, category: "OFFICE" }] },
  { id: "request_013", number: "PR-2026-013", title: "Tower crane hire", status: "ORDERED", project: PROJECT_IDS.a, priority: "CRITICAL", requester: "pm",
    items: [{ description: "Tower crane, monthly hire", quantity: 9, unit: "month", price: 14500, category: "EQUIPMENT" }] },
  { id: "request_014", number: "PR-2026-014", title: "Formwork panels", status: "IN_SOURCING", project: PROJECT_IDS.a, priority: "HIGH", requester: "pm",
    items: [{ description: "Wall formwork panel 2.7m", quantity: 260, unit: "m2", price: 62, category: "EQUIPMENT" }] },
  { id: "request_015", number: "PR-2026-015", title: "Waterproofing membrane", status: "APPROVED", project: PROJECT_IDS.a, priority: "MEDIUM", requester: "pm",
    items: [{ description: "SBS membrane, torch-on", quantity: 1800, unit: "m2", price: 18, category: "MATERIALS" }] },
  { id: "request_016", number: "PR-2026-016", title: "Mechanical plant — chillers", status: "PENDING_APPROVAL", project: PROJECT_IDS.a, priority: "HIGH", requester: "procurement",
    items: [{ description: "Air-cooled chiller 400kW", quantity: 2, unit: "each", price: 68000, category: "EQUIPMENT" }] },
  { id: "request_017", number: "PR-2026-017", title: "Temporary power distribution", status: "PARTIALLY_ORDERED", project: PROJECT_IDS.a, priority: "MEDIUM", requester: "pm",
    items: [{ description: "Distribution board 63A", quantity: 14, unit: "each", price: 340, category: "EQUIPMENT" }] },
  { id: "request_018", number: "PR-2026-018", title: "Geotechnical investigation", status: "COMPLETED", project: PROJECT_IDS.a, priority: "MEDIUM", requester: "pm",
    items: [{ description: "Borehole investigation", quantity: 6, unit: "each", price: 2200, category: "SERVICES" }] },
  { id: "request_019", number: "PR-2026-019", title: "Logistics — site deliveries", status: "DRAFT", project: PROJECT_IDS.a, priority: "LOW", requester: "procurement",
    items: [{ description: "Delivery vehicle, day rate", quantity: 20, unit: "day", price: 310, category: "LOGISTICS" }] },
  { id: "request_020", number: "PR-2026-020", title: "Façade access equipment", status: "REJECTED", project: PROJECT_IDS.a, priority: "MEDIUM", requester: "pm",
    items: [{ description: "Mast climber hire", quantity: 4, unit: "month", price: 5600, category: "EQUIPMENT" }] },
];

const DECIDED: RequestStatus[] = ["APPROVED", "IN_SOURCING", "PARTIALLY_ORDERED", "ORDERED", "COMPLETED"];

async function seedRequests(
  prisma: PrismaClient,
  members: { procurement: string; pm: string; ceo: string },
) {
  let index = 0;
  for (const request of REQUESTS) {
    index += 1;
    const requestedBy = request.requester === "pm" ? members.pm : members.procurement;
    const approved = DECIDED.includes(request.status);
    const rejected = request.status === "REJECTED";
    const submitted = approved || rejected || request.status === "PENDING_APPROVAL";

    const estimated = request.items.reduce((sum, item) => sum + item.quantity * item.price, 0);

    await prisma.purchaseRequest.upsert({
      where: { id: request.id },
      update: {},
      create: {
        id: request.id,
        companyId: COMPANY_A,
        requestNumber: request.number,
        title: request.title,
        projectId: request.project,
        requestedByMemberId: requestedBy,
        ownerMemberId: members.procurement,
        requiredDate: daysFromNow(15 + index * 2),
        priority: request.priority,
        currency: EUR,
        estimatedTotal: money(estimated),
        status: request.status,
        submittedAt: submitted ? daysFromNow(-20 + index) : null,
        approvedAt: approved ? daysFromNow(-16 + index) : null,
        approvedByMemberId: approved ? members.ceo : null,
        rejectedAt: rejected ? daysFromNow(-14 + index) : null,
        rejectedByMemberId: rejected ? members.ceo : null,
        rejectionReason: rejected ? "Not justified against the current budget." : null,
        cancelledAt: request.status === "CANCELLED" ? daysFromNow(-8) : null,
        createdByMemberId: requestedBy,
      },
    });

    let sort = 0;
    for (const item of request.items) {
      sort += 1;
      await prisma.purchaseRequestItem.upsert({
        where: { id: `${request.id}_item_${sort}` },
        update: {},
        create: {
          id: `${request.id}_item_${sort}`,
          purchaseRequestId: request.id,
          description: item.description,
          quantity: qty(item.quantity),
          unit: item.unit,
          estimatedUnitPrice: qty(item.price),
          estimatedAmount: money(item.quantity * item.price),
          category: item.category,
          sortOrder: sort,
        },
      });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* RFQs and quotes (PRD #19 §298, §299)                                        */
/* -------------------------------------------------------------------------- */

type RfqFixture = {
  id: string;
  number: string;
  title: string;
  status: "DRAFT" | "ISSUED" | "CLOSED" | "CANCELLED";
  request: string | null;
  project: string | null;
  suppliers: string[];
  items: { description: string; quantity: number; unit: string }[];
};

const RFQS: RfqFixture[] = [
  { id: "rfq_001", number: "RFQ-2026-001", title: "Curtain wall package", status: "CLOSED", request: "request_004", project: PROJECT_IDS.a,
    suppliers: ["supplier_buildpro", "supplier_nordsteel", "supplier_meridian"],
    items: [{ description: "Unitised curtain wall, supply and install", quantity: 2400, unit: "m2" }] },
  { id: "rfq_002", number: "RFQ-2026-002", title: "Formwork panels", status: "ISSUED", request: "request_014", project: PROJECT_IDS.a,
    suppliers: ["supplier_atlas", "supplier_delta"],
    items: [{ description: "Wall formwork panel 2.7m", quantity: 260, unit: "m2" }] },
  { id: "rfq_003", number: "RFQ-2026-003", title: "Reinforcement supply", status: "CLOSED", request: "request_001", project: PROJECT_IDS.a,
    suppliers: ["supplier_nordsteel", "supplier_atlas", "supplier_alba"],
    items: [{ description: "Rebar B500C 16mm", quantity: 42, unit: "tonne" }] },
  { id: "rfq_004", number: "RFQ-2026-004", title: "Chiller plant", status: "ISSUED", request: "request_016", project: PROJECT_IDS.a,
    suppliers: ["supplier_meridian", "supplier_buildpro"],
    items: [{ description: "Air-cooled chiller 400kW", quantity: 2, unit: "each" }] },
  { id: "rfq_005", number: "RFQ-2026-005", title: "Concrete supply — phase 2", status: "CLOSED", request: "request_002", project: PROJECT_IDS.a,
    suppliers: ["supplier_alba", "supplier_atlas"],
    items: [{ description: "Concrete C30/37 pumped", quantity: 1200, unit: "m3" }] },
  { id: "rfq_006", number: "RFQ-2026-006", title: "Tower crane hire", status: "CLOSED", request: "request_013", project: PROJECT_IDS.a,
    suppliers: ["supplier_delta", "supplier_buildpro"],
    items: [{ description: "Tower crane, monthly hire", quantity: 9, unit: "month" }] },
  { id: "rfq_007", number: "RFQ-2026-007", title: "Waterproofing package", status: "DRAFT", request: "request_015", project: PROJECT_IDS.a,
    suppliers: ["supplier_atlas"],
    items: [{ description: "SBS membrane, torch-on", quantity: 1800, unit: "m2" }] },
  { id: "rfq_008", number: "RFQ-2026-008", title: "Façade access", status: "CANCELLED", request: "request_020", project: PROJECT_IDS.a,
    suppliers: ["supplier_delta", "supplier_legacy"],
    items: [{ description: "Mast climber hire", quantity: 4, unit: "month" }] },
  { id: "rfq_009", number: "RFQ-2026-009", title: "Structural steelwork", status: "CLOSED", request: "request_010", project: PROJECT_IDS.a,
    suppliers: ["supplier_nordsteel", "supplier_buildpro"],
    items: [{ description: "Fabricated steelwork S355", quantity: 96, unit: "tonne" }] },
  { id: "rfq_010", number: "RFQ-2026-010", title: "Site logistics", status: "ISSUED", request: "request_019", project: PROJECT_IDS.a,
    suppliers: ["supplier_kastrati", "supplier_delta"],
    items: [{ description: "Delivery vehicle, day rate", quantity: 20, unit: "day" }] },
];

async function seedRfqs(prisma: PrismaClient, createdBy: string) {
  let index = 0;
  for (const rfq of RFQS) {
    index += 1;
    const issued = rfq.status !== "DRAFT";

    await prisma.rFQ.upsert({
      where: { id: rfq.id },
      update: {},
      create: {
        id: rfq.id,
        companyId: COMPANY_A,
        rfqNumber: rfq.number,
        title: rfq.title,
        purchaseRequestId: rfq.request,
        projectId: rfq.project,
        currency: EUR,
        responseDueDate: daysFromNow(-10 + index * 3),
        status: rfq.status,
        issuedAt: issued ? daysFromNow(-30 + index) : null,
        closedAt: rfq.status === "CLOSED" ? daysFromNow(-12 + index) : null,
        cancelledAt: rfq.status === "CANCELLED" ? daysFromNow(-9) : null,
        createdByMemberId: createdBy,
      },
    });

    let sort = 0;
    for (const item of rfq.items) {
      sort += 1;
      await prisma.rFQItem.upsert({
        where: { id: `${rfq.id}_item_${sort}` },
        update: {},
        create: {
          id: `${rfq.id}_item_${sort}`,
          rfqId: rfq.id,
          description: item.description,
          quantity: qty(item.quantity),
          unit: item.unit,
          sortOrder: sort,
        },
      });
    }

    for (const supplierId of rfq.suppliers) {
      await prisma.rFQSupplier.upsert({
        where: { rfqId_supplierId: { rfqId: rfq.id, supplierId } },
        update: {},
        create: {
          id: `${rfq.id}_${supplierId}`,
          rfqId: rfq.id,
          supplierId,
          status: rfq.status === "CLOSED" ? "RESPONDED" : issued ? "INVITED" : "INVITED",
          invitedAt: issued ? daysFromNow(-30 + index) : null,
          respondedAt: rfq.status === "CLOSED" ? daysFromNow(-15 + index) : null,
        },
      });
    }
  }
}

type QuoteFixture = {
  id: string;
  rfq: string;
  supplier: string;
  status: "RECEIVED" | "SELECTED" | "NOT_SELECTED" | "DISQUALIFIED";
  unitPrice: number;
  leadTimeDays: number;
  reason?: string;
};

/** Priced so each closed RFQ has a clear winner and a runner-up (§91). */
const QUOTES: QuoteFixture[] = [
  { id: "quote_001", rfq: "rfq_001", supplier: "supplier_buildpro", status: "SELECTED", unitPrice: 162, leadTimeDays: 70 },
  { id: "quote_002", rfq: "rfq_001", supplier: "supplier_nordsteel", status: "NOT_SELECTED", unitPrice: 171, leadTimeDays: 56 },
  { id: "quote_003", rfq: "rfq_001", supplier: "supplier_meridian", status: "DISQUALIFIED", unitPrice: 149, leadTimeDays: 140, reason: "Lead time exceeds the programme by ten weeks." },
  { id: "quote_004", rfq: "rfq_002", supplier: "supplier_atlas", status: "RECEIVED", unitPrice: 59, leadTimeDays: 21 },
  { id: "quote_005", rfq: "rfq_002", supplier: "supplier_delta", status: "RECEIVED", unitPrice: 64, leadTimeDays: 14 },
  { id: "quote_006", rfq: "rfq_003", supplier: "supplier_nordsteel", status: "SELECTED", unitPrice: 772, leadTimeDays: 28 },
  { id: "quote_007", rfq: "rfq_003", supplier: "supplier_atlas", status: "NOT_SELECTED", unitPrice: 789, leadTimeDays: 21 },
  { id: "quote_008", rfq: "rfq_003", supplier: "supplier_alba", status: "NOT_SELECTED", unitPrice: 804, leadTimeDays: 18 },
  { id: "quote_009", rfq: "rfq_004", supplier: "supplier_meridian", status: "RECEIVED", unitPrice: 66500, leadTimeDays: 98 },
  { id: "quote_010", rfq: "rfq_004", supplier: "supplier_buildpro", status: "RECEIVED", unitPrice: 71200, leadTimeDays: 77 },
  { id: "quote_011", rfq: "rfq_005", supplier: "supplier_alba", status: "SELECTED", unitPrice: 74, leadTimeDays: 7 },
  { id: "quote_012", rfq: "rfq_005", supplier: "supplier_atlas", status: "NOT_SELECTED", unitPrice: 78, leadTimeDays: 5 },
  { id: "quote_013", rfq: "rfq_006", supplier: "supplier_delta", status: "SELECTED", unitPrice: 14200, leadTimeDays: 30 },
  { id: "quote_014", rfq: "rfq_006", supplier: "supplier_buildpro", status: "NOT_SELECTED", unitPrice: 15100, leadTimeDays: 25 },
  { id: "quote_015", rfq: "rfq_009", supplier: "supplier_nordsteel", status: "SELECTED", unitPrice: 1820, leadTimeDays: 63 },
  { id: "quote_016", rfq: "rfq_009", supplier: "supplier_buildpro", status: "NOT_SELECTED", unitPrice: 1905, leadTimeDays: 49 },
  { id: "quote_017", rfq: "rfq_010", supplier: "supplier_kastrati", status: "RECEIVED", unitPrice: 295, leadTimeDays: 3 },
  { id: "quote_018", rfq: "rfq_010", supplier: "supplier_delta", status: "RECEIVED", unitPrice: 318, leadTimeDays: 2 },
  { id: "quote_019", rfq: "rfq_008", supplier: "supplier_delta", status: "RECEIVED", unitPrice: 5450, leadTimeDays: 35 },
  { id: "quote_020", rfq: "rfq_008", supplier: "supplier_legacy", status: "DISQUALIFIED", unitPrice: 4900, leadTimeDays: 42, reason: "Supplier is no longer active." },
  { id: "quote_021", rfq: "rfq_002", supplier: "supplier_atlas", status: "RECEIVED", unitPrice: 61, leadTimeDays: 19 },
  { id: "quote_022", rfq: "rfq_004", supplier: "supplier_meridian", status: "RECEIVED", unitPrice: 67400, leadTimeDays: 91 },
  { id: "quote_023", rfq: "rfq_005", supplier: "supplier_alba", status: "NOT_SELECTED", unitPrice: 76, leadTimeDays: 9 },
  { id: "quote_024", rfq: "rfq_006", supplier: "supplier_delta", status: "NOT_SELECTED", unitPrice: 14800, leadTimeDays: 28 },
];

const TAX_RATE = 0.2;

async function seedQuotes(prisma: PrismaClient, createdBy: string) {
  let index = 0;
  for (const quote of QUOTES) {
    index += 1;
    const rfq = RFQS.find((row) => row.id === quote.rfq)!;
    const rfqItem = rfq.items[0]!;
    const rfqItemId = `${rfq.id}_item_1`;

    const subtotal = rfqItem.quantity * quote.unitPrice;
    const tax = subtotal * TAX_RATE;

    // A second quote from a supplier already quoting this RFQ is a revision in
    // the demo data; the id keeps them distinct.
    await prisma.supplierQuote.upsert({
      where: { id: quote.id },
      update: {},
      create: {
        id: quote.id,
        companyId: COMPANY_A,
        rfqId: quote.rfq,
        supplierId: quote.supplier,
        quoteNumber: `Q-${index.toString().padStart(4, "0")}`,
        quoteDate: daysFromNow(-20 + index),
        validUntil: daysFromNow(30 + index),
        currency: EUR,
        subtotal: money(subtotal),
        taxAmount: money(tax),
        totalAmount: money(subtotal + tax),
        leadTimeDays: quote.leadTimeDays,
        status: quote.status,
        disqualificationReason: quote.reason ?? null,
        createdByMemberId: createdBy,
      },
    });

    await prisma.supplierQuoteItem.upsert({
      where: { supplierQuoteId_rfqItemId: { supplierQuoteId: quote.id, rfqItemId } },
      update: {},
      create: {
        id: `${quote.id}_item_1`,
        supplierQuoteId: quote.id,
        rfqItemId,
        quantity: qty(rfqItem.quantity),
        unitPrice: qty(quote.unitPrice),
        taxRate: new Prisma.Decimal(TAX_RATE.toFixed(4)),
        subtotal: money(subtotal),
        taxAmount: money(tax),
        totalAmount: money(subtotal + tax),
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Purchase orders (PRD #19 §300)                                              */
/* -------------------------------------------------------------------------- */

type OrderStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "ISSUED"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "CLOSED"
  | "CANCELLED";

type OrderFixture = {
  id: string;
  number: string;
  supplier: string;
  status: OrderStatus;
  project: string | null;
  request: string | null;
  rfq?: string;
  quote?: string;
  contract?: string;
  items: { description: string; quantity: number; unit: string; price: number }[];
};

const ORDERS: OrderFixture[] = [
  { id: "order_001", number: "PO-2026-001", supplier: "supplier_nordsteel", status: "RECEIVED", project: PROJECT_IDS.a, request: "request_001", rfq: "rfq_003", quote: "quote_006",
    items: [{ description: "Rebar B500C 16mm", quantity: 42, unit: "tonne", price: 772 }] },
  { id: "order_002", number: "PO-2026-002", supplier: "supplier_alba", status: "PARTIALLY_RECEIVED", project: PROJECT_IDS.a, request: "request_002", rfq: "rfq_005", quote: "quote_011",
    items: [{ description: "Concrete C30/37 pumped", quantity: 1200, unit: "m3", price: 74 }] },
  { id: "order_003", number: "PO-2026-003", supplier: "supplier_legacy", status: "CLOSED", project: PROJECT_IDS.a, request: "request_003",
    items: [{ description: "System scaffold hire, 8 weeks", quantity: 8, unit: "week", price: 1950 }] },
  { id: "order_004", number: "PO-2026-004", supplier: "supplier_buildpro", status: "ISSUED", project: PROJECT_IDS.a, request: "request_004", rfq: "rfq_001", quote: "quote_001",
    items: [{ description: "Unitised curtain wall, supply and install", quantity: 2400, unit: "m2", price: 162 }] },
  { id: "order_005", number: "PO-2026-005", supplier: "supplier_delta", status: "ISSUED", project: PROJECT_IDS.a, request: "request_013", rfq: "rfq_006", quote: "quote_013",
    items: [{ description: "Tower crane, monthly hire", quantity: 9, unit: "month", price: 14200 }] },
  { id: "order_006", number: "PO-2026-006", supplier: "supplier_delta", status: "RECEIVED", project: PROJECT_IDS.a, request: "request_006",
    items: [{ description: "Site cabin 6m, hire", quantity: 6, unit: "month", price: 420 }] },
  { id: "order_007", number: "PO-2026-007", supplier: "supplier_nordsteel", status: "PARTIALLY_RECEIVED", project: PROJECT_IDS.a, request: "request_010", rfq: "rfq_009", quote: "quote_015",
    items: [{ description: "Fabricated steelwork S355", quantity: 96, unit: "tonne", price: 1820 }] },
  { id: "order_008", number: "PO-2026-008", supplier: "supplier_atlas", status: "RECEIVED", project: null, request: "request_011",
    items: [{ description: "Safety harness kit", quantity: 40, unit: "each", price: 88 }, { description: "Hard hat, vented", quantity: 120, unit: "each", price: 14 }] },
  { id: "order_009", number: "PO-2026-009", supplier: "supplier_atlas", status: "PENDING_APPROVAL", project: PROJECT_IDS.a, request: "request_015",
    items: [{ description: "SBS membrane, torch-on", quantity: 1800, unit: "m2", price: 18 }] },
  { id: "order_010", number: "PO-2026-010", supplier: "supplier_meridian", status: "DRAFT", project: PROJECT_IDS.a, request: "request_016",
    items: [{ description: "Air-cooled chiller 400kW", quantity: 2, unit: "each", price: 66500 }] },
  { id: "order_011", number: "PO-2026-011", supplier: "supplier_kastrati", status: "APPROVED", project: PROJECT_IDS.a, request: null,
    items: [{ description: "Site labour, general", quantity: 30, unit: "day", price: 180 }] },
  { id: "order_012", number: "PO-2026-012", supplier: "supplier_hoxha", status: "CLOSED", project: PROJECT_IDS.a, request: "request_018",
    items: [{ description: "Borehole investigation", quantity: 6, unit: "each", price: 2200 }] },
  { id: "order_013", number: "PO-2026-013", supplier: "supplier_buildpro", status: "REJECTED", project: PROJECT_IDS.a, request: null,
    items: [{ description: "Balustrade package", quantity: 420, unit: "m", price: 145 }] },
  { id: "order_014", number: "PO-2026-014", supplier: "supplier_delta", status: "CANCELLED", project: PROJECT_IDS.a, request: "request_020",
    items: [{ description: "Mast climber hire", quantity: 4, unit: "month", price: 5450 }] },
  { id: "order_015", number: "PO-2026-015", supplier: "supplier_atlas", status: "PARTIALLY_RECEIVED", project: PROJECT_IDS.a, request: "request_017",
    items: [{ description: "Distribution board 63A", quantity: 14, unit: "each", price: 340 }] },
  { id: "order_016", number: "PO-2026-016", supplier: "supplier_municipality", status: "ISSUED", project: PROJECT_IDS.a, request: null,
    items: [{ description: "Utility connection fee", quantity: 1, unit: "each", price: 8400 }] },
];

const ORDER_DECIDED: OrderStatus[] = [
  "APPROVED",
  "ISSUED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CLOSED",
];

async function seedOrders(
  prisma: PrismaClient,
  members: { procurement: string; ceo: string; owner: string },
) {
  let index = 0;
  for (const order of ORDERS) {
    index += 1;
    const approved = ORDER_DECIDED.includes(order.status);
    const rejected = order.status === "REJECTED";
    const issued = ["ISSUED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"].includes(order.status);

    const subtotal = order.items.reduce((sum, item) => sum + item.quantity * item.price, 0);
    const tax = subtotal * TAX_RATE;

    await prisma.purchaseOrder.upsert({
      where: { id: order.id },
      update: {},
      create: {
        id: order.id,
        companyId: COMPANY_A,
        poNumber: order.number,
        supplierId: order.supplier,
        purchaseRequestId: order.request,
        rfqId: order.rfq ?? null,
        supplierQuoteId: order.quote ?? null,
        projectId: order.project,
        contractId: order.contract ?? null,
        orderDate: daysFromNow(-40 + index * 2),
        requiredDate: daysFromNow(10 + index * 3),
        currency: EUR,
        subtotal: money(subtotal),
        taxAmount: money(tax),
        totalAmount: money(subtotal + tax),
        status: order.status,
        submittedAt: approved || rejected || order.status === "PENDING_APPROVAL" ? daysFromNow(-36 + index) : null,
        approvedAt: approved ? daysFromNow(-34 + index) : null,
        approvedByMemberId: approved ? members.ceo : null,
        rejectedAt: rejected ? daysFromNow(-30) : null,
        rejectedByMemberId: rejected ? members.ceo : null,
        rejectionReason: rejected ? "Scope belongs under the main subcontract, not a separate order." : null,
        issuedAt: issued ? daysFromNow(-32 + index) : null,
        closedAt: order.status === "CLOSED" ? daysFromNow(-6) : null,
        cancelledAt: order.status === "CANCELLED" ? daysFromNow(-11) : null,
        createdByMemberId: members.procurement,
      },
    });

    let sort = 0;
    for (const item of order.items) {
      sort += 1;
      const lineSubtotal = item.quantity * item.price;
      const lineTax = lineSubtotal * TAX_RATE;
      // Linked back to the request line it came from, so spend-by-category has
      // a category to group by (PRD #19 §182).
      const sourceRequestItemId =
        order.request &&
        REQUESTS.find((request) => request.id === order.request)?.items[sort - 1] !== undefined
          ? `${order.request}_item_${sort}`
          : null;

      await prisma.purchaseOrderItem.upsert({
        where: { id: `${order.id}_item_${sort}` },
        // Converges on a re-run rather than leaving an older shape in place.
        update: { sourceRequestItemId },
        create: {
          id: `${order.id}_item_${sort}`,
          purchaseOrderId: order.id,
          sourceRequestItemId,
          description: item.description,
          quantity: qty(item.quantity),
          unit: item.unit,
          unitPrice: qty(item.price),
          taxRate: new Prisma.Decimal(TAX_RATE.toFixed(4)),
          subtotal: money(lineSubtotal),
          taxAmount: money(lineTax),
          totalAmount: money(lineSubtotal + lineTax),
          sortOrder: sort,
        },
      });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Goods receipts (PRD #19 §301)                                               */
/* -------------------------------------------------------------------------- */

type ReceiptFixture = {
  id: string;
  number: string;
  order: string;
  /** Fraction of the ordered quantity that arrived on this delivery. */
  fraction: number;
  rejectedFraction?: number;
  status?: "RECORDED" | "VOIDED";
  daysAgo: number;
};

const RECEIPTS: ReceiptFixture[] = [
  { id: "receipt_001", number: "GRN-2026-001", order: "order_001", fraction: 0.5, daysAgo: 26 },
  { id: "receipt_002", number: "GRN-2026-002", order: "order_001", fraction: 0.5, daysAgo: 18 },
  { id: "receipt_003", number: "GRN-2026-003", order: "order_002", fraction: 0.35, daysAgo: 22 },
  { id: "receipt_004", number: "GRN-2026-004", order: "order_002", fraction: 0.25, daysAgo: 12 },
  { id: "receipt_005", number: "GRN-2026-005", order: "order_003", fraction: 1, daysAgo: 40 },
  { id: "receipt_006", number: "GRN-2026-006", order: "order_006", fraction: 1, daysAgo: 30 },
  { id: "receipt_007", number: "GRN-2026-007", order: "order_007", fraction: 0.4, daysAgo: 20 },
  { id: "receipt_008", number: "GRN-2026-008", order: "order_007", fraction: 0.2, rejectedFraction: 0.05, daysAgo: 9 },
  { id: "receipt_009", number: "GRN-2026-009", order: "order_008", fraction: 1, daysAgo: 34 },
  { id: "receipt_010", number: "GRN-2026-010", order: "order_012", fraction: 1, daysAgo: 28 },
  { id: "receipt_011", number: "GRN-2026-011", order: "order_015", fraction: 0.5, daysAgo: 15 },
  { id: "receipt_012", number: "GRN-2026-012", order: "order_015", fraction: 0.2, daysAgo: 7 },
  { id: "receipt_013", number: "GRN-2026-013", order: "order_002", fraction: 0.1, status: "VOIDED", daysAgo: 16 },
  { id: "receipt_014", number: "GRN-2026-014", order: "order_003", fraction: 0.2, status: "VOIDED", daysAgo: 38 },
  { id: "receipt_015", number: "GRN-2026-015", order: "order_001", fraction: 0.1, rejectedFraction: 0.1, daysAgo: 24 },
  { id: "receipt_016", number: "GRN-2026-016", order: "order_006", fraction: 0.2, daysAgo: 33 },
  { id: "receipt_017", number: "GRN-2026-017", order: "order_008", fraction: 0.15, rejectedFraction: 0.05, daysAgo: 31 },
  { id: "receipt_018", number: "GRN-2026-018", order: "order_012", fraction: 0.25, daysAgo: 27 },
];

async function seedReceipts(
  prisma: PrismaClient,
  members: { procurement: string; inventory: string },
) {
  for (const receipt of RECEIPTS) {
    const order = ORDERS.find((row) => row.id === receipt.order)!;
    const voided = receipt.status === "VOIDED";

    await prisma.goodsReceipt.upsert({
      where: { id: receipt.id },
      update: {},
      create: {
        id: receipt.id,
        companyId: COMPANY_A,
        receiptNumber: receipt.number,
        purchaseOrderId: receipt.order,
        projectId: order.project,
        supplierId: order.supplier,
        receiptDate: daysFromNow(-receipt.daysAgo),
        deliveryReference: `DN-${receipt.number.slice(-3)}`,
        status: voided ? "VOIDED" : "RECORDED",
        receivedByMemberId: members.inventory,
        createdByMemberId: members.procurement,
        voidedByMemberId: voided ? members.procurement : null,
        voidedAt: voided ? daysFromNow(-receipt.daysAgo + 1) : null,
        voidReason: voided ? "Recorded against the wrong delivery note." : null,
      },
    });

    let sort = 0;
    for (const item of order.items) {
      sort += 1;
      const received = item.quantity * receipt.fraction;
      const rejected = item.quantity * (receipt.rejectedFraction ?? 0);
      await prisma.goodsReceiptItem.upsert({
        where: { id: `${receipt.id}_item_${sort}` },
        update: {},
        create: {
          id: `${receipt.id}_item_${sort}`,
          goodsReceiptId: receipt.id,
          purchaseOrderItemId: `${receipt.order}_item_${sort}`,
          receivedQuantity: qty(received),
          acceptedQuantity: qty(Math.max(received - rejected, 0)),
          rejectedQuantity: qty(rejected),
          notes: rejected > 0 ? "Damaged on arrival; rejected quantity returned." : null,
        },
      });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Approvals (PRD #19 §302)                                                    */
/* -------------------------------------------------------------------------- */

type ApprovalFixture = {
  id: string;
  type: "PURCHASE_REQUEST" | "PURCHASE_ORDER";
  record: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  submittedDaysAgo: number;
  decidedDaysAgo?: number;
  decidedBy?: "ceo" | "owner";
  note?: string;
};

const APPROVALS: ApprovalFixture[] = [
  { id: "procurement_approval_001", type: "PURCHASE_REQUEST", record: "request_005", status: "PENDING", submittedDaysAgo: 3 },
  { id: "procurement_approval_002", type: "PURCHASE_REQUEST", record: "request_009", status: "PENDING", submittedDaysAgo: 2 },
  { id: "procurement_approval_003", type: "PURCHASE_REQUEST", record: "request_016", status: "PENDING", submittedDaysAgo: 1 },
  { id: "procurement_approval_004", type: "PURCHASE_REQUEST", record: "request_006", status: "APPROVED", submittedDaysAgo: 18, decidedDaysAgo: 15, decidedBy: "ceo", note: "Approved against the site setup budget." },
  { id: "procurement_approval_005", type: "PURCHASE_REQUEST", record: "request_015", status: "APPROVED", submittedDaysAgo: 20, decidedDaysAgo: 17, decidedBy: "owner" },
  { id: "procurement_approval_006", type: "PURCHASE_REQUEST", record: "request_008", status: "REJECTED", submittedDaysAgo: 25, decidedDaysAgo: 22, decidedBy: "ceo", note: "Samples can come from the existing framework supplier." },
  { id: "procurement_approval_007", type: "PURCHASE_REQUEST", record: "request_020", status: "REJECTED", submittedDaysAgo: 28, decidedDaysAgo: 24, decidedBy: "ceo", note: "Use the scaffold already on site." },
  { id: "procurement_approval_008", type: "PURCHASE_ORDER", record: "order_009", status: "PENDING", submittedDaysAgo: 4 },
  { id: "procurement_approval_009", type: "PURCHASE_ORDER", record: "order_011", status: "APPROVED", submittedDaysAgo: 14, decidedDaysAgo: 11, decidedBy: "owner" },
  { id: "procurement_approval_010", type: "PURCHASE_ORDER", record: "order_004", status: "APPROVED", submittedDaysAgo: 34, decidedDaysAgo: 31, decidedBy: "ceo" },
  { id: "procurement_approval_011", type: "PURCHASE_ORDER", record: "order_013", status: "REJECTED", submittedDaysAgo: 30, decidedDaysAgo: 27, decidedBy: "ceo", note: "Scope belongs under the main subcontract." },
];

async function seedApprovals(
  prisma: PrismaClient,
  members: { procurement: string; pm: string; ceo: string; owner: string },
) {
  for (const approval of APPROVALS) {
    await prisma.procurementApproval.upsert({
      where: { id: approval.id },
      update: {},
      create: {
        id: approval.id,
        companyId: COMPANY_A,
        recordType: approval.type,
        recordId: approval.record,
        status: approval.status,
        // Always submitted by Procurement and decided by somebody else: the
        // separation of duties the module enforces is visible in the demo data
        // (PRD #19 §21).
        submittedByMemberId: members.procurement,
        submittedAt: daysFromNow(-approval.submittedDaysAgo),
        decidedByMemberId:
          approval.decidedBy === "owner"
            ? members.owner
            : approval.decidedBy === "ceo"
              ? members.ceo
              : null,
        decidedAt:
          approval.decidedDaysAgo === undefined ? null : daysFromNow(-approval.decidedDaysAgo),
        decisionNote: approval.note ?? null,
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Company B isolation (PRD #19 §307)                                          */
/* -------------------------------------------------------------------------- */

/**
 * One supplier, one request and one order belonging to the other company.
 *
 * They exist so isolation can be tested rather than assumed: every Company A
 * list, search, filter, report and approval queue must be provably unable to
 * reach them. The PO number deliberately repeats one of Company A's, so the
 * per-company uniqueness is exercised too (PRD #19 §99).
 */
async function seedCompanyBProcurement(prisma: PrismaClient) {
  const ownerB = "member_owner_b";

  await prisma.supplier.upsert({
    where: { id: "supplier_b_001" },
    update: {},
    create: {
      id: "supplier_b_001",
      companyId: FIXTURE_TENANT,
      code: "SUP-001",
      name: "Isarwerk Baustoffe",
      legalName: "Isarwerk Baustoffe GmbH",
      supplierType: "COMPANY",
      status: "ACTIVE",
      country: "Germany",
      notes: "Company B record. Must never appear in a Company A result.",
      normalizedName: normalize("Isarwerk Baustoffe"),
      createdByMemberId: ownerB,
    },
  });

  await prisma.purchaseRequest.upsert({
    where: { id: "request_b_001" },
    update: {},
    create: {
      id: "request_b_001",
      companyId: FIXTURE_TENANT,
      requestNumber: "PR-2026-001",
      title: "Company B request. Must never appear in a Company A result.",
      projectId: "project_b_one",
      requestedByMemberId: ownerB,
      priority: "MEDIUM",
      currency: EUR,
      estimatedTotal: money(24000),
      status: "PENDING_APPROVAL",
      submittedAt: daysFromNow(-3),
      createdByMemberId: ownerB,
    },
  });

  await prisma.purchaseRequestItem.upsert({
    where: { id: "request_b_001_item_1" },
    update: {},
    create: {
      id: "request_b_001_item_1",
      purchaseRequestId: "request_b_001",
      description: "Company B line item",
      quantity: qty(100),
      unit: "each",
      estimatedUnitPrice: qty(240),
      estimatedAmount: money(24000),
      category: "MATERIALS",
      sortOrder: 1,
    },
  });

  await prisma.purchaseOrder.upsert({
    where: { id: "order_b_001" },
    update: {},
    create: {
      id: "order_b_001",
      companyId: FIXTURE_TENANT,
      poNumber: "PO-2026-001",
      supplierId: "supplier_b_001",
      purchaseRequestId: "request_b_001",
      projectId: "project_b_one",
      orderDate: daysFromNow(-10),
      currency: EUR,
      subtotal: money(24000),
      taxAmount: money(4800),
      totalAmount: money(28800),
      status: "ISSUED",
      issuedAt: daysFromNow(-9),
      createdByMemberId: ownerB,
    },
  });

  await prisma.purchaseOrderItem.upsert({
    where: { id: "order_b_001_item_1" },
    update: {},
    create: {
      id: "order_b_001_item_1",
      purchaseOrderId: "order_b_001",
      description: "Company B line item",
      quantity: qty(100),
      unit: "each",
      unitPrice: qty(240),
      taxRate: new Prisma.Decimal(TAX_RATE.toFixed(4)),
      subtotal: money(24000),
      taxAmount: money(4800),
      totalAmount: money(28800),
      sortOrder: 1,
    },
  });

  await prisma.procurementApproval.upsert({
    where: { id: "procurement_approval_b_001" },
    update: {},
    create: {
      id: "procurement_approval_b_001",
      companyId: FIXTURE_TENANT,
      recordType: "PURCHASE_REQUEST",
      recordId: "request_b_001",
      status: "PENDING",
      submittedByMemberId: ownerB,
      submittedAt: daysFromNow(-3),
    },
  });
}
