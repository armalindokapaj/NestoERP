/**
 * A working day across ARMAAR's companies (D-01 §44-§63, §100-§105).
 *
 * Every record is the product's own model — nothing here is a demo copy of a
 * module — and every value is synthetic (§77). Tirana Lake carries the deepest
 * story; the other companies each have enough that their pages are not empty:
 *
 *   external companies  one register per company, the same company once however
 *                       many roles it plays: AlbaBuild supplies concrete and
 *                       builds Tirana Lake's frame (§45, §99)
 *   contractors         Tirana Lake's five — concrete, façade, electrical, HVAC,
 *                       finishing — assigned, with work packages and compliance
 *   procurement         request → approval → order → partial and full delivery
 *                       → supplier bill (§48, §49, §101), and a request and an
 *                       order waiting for approval
 *   finance             an approved current budget per project (the portfolio's
 *                       value), expenses approved and pending (§50, §51)
 *   legal               the construction contract with ARLIS - NDERTIM, a supply
 *                       framework, the five subcontracts, employment contracts
 *                       and an amendment waiting for approval (§52)
 *   documents, tasks, meetings, calendar, announcements, HSE, QA/QC (§56-§63)
 *   activity            the recent weeks, on the records it names (§62)
 *
 * The contractor chain past its contract — progress, invoice, verification,
 * payment — is E-11's and is not faked (§102). Stable ids; a rerun adds nothing.
 */
import { Prisma, type PrismaClient } from "@prisma/client";

import { addLocalDays, instantFromLocal, localDate } from "../../../lib/modules/calendar/calendar.time";
import { normalizeContractorName } from "../../../lib/modules/contractors/contractor.names";
import { AGENDA_TEMPLATES } from "../../../lib/modules/meetings/meeting.types";
import { seedStoredDocument } from "../document-objects";
import { memberId } from "./access";
import { branchId, companyId } from "./organization";
import { personOf, userId } from "./people";
import { projectId } from "./projects";
import type { CompanyCode, ProjectCode } from "./public-facts";

const ZONE = "Europe/Tirane";
const EUR = "EUR";
const BCI = "BUILDING_CONSTRUCTION_INVEST" as const;
const TL = projectId("TIRANA_LAKE");
const money = (value: number) => new Prisma.Decimal(value.toFixed(2));
const qty = (value: number) => new Prisma.Decimal(value.toFixed(4));
const normalizeSupplier = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A supplier record of one company: the same external company is a row in each company that buys from it. */
export const supplierId = (key: string, code: CompanyCode) => `armaar_sup_${key}_${code.toLowerCase().slice(0, 8)}`;
export const contractorId = (key: string) => `armaar_ctr_profile_${key}`;

export async function seedArmaarOperations(prisma: PrismaClient) {
  const today = localDate(new Date(), ZONE);
  const day = (offset: number) => new Date(`${addLocalDays(today, offset)}T12:00:00.000Z`);
  const at = (offset: number, hour = 10) => new Date(`${addLocalDays(today, offset)}T${String(hour).padStart(2, "0")}:00:00.000Z`);
  const m = (username: string, code: CompanyCode = BCI) => memberId(username, code);

  const activity: Prisma.ActivityCreateManyInput[] = [];
  const act = (input: { id: string; code?: CompanyCode; module: string; entityType: string; entityId: string; action: string; message: string; by: string; at: Date; projectId?: string }) => {
    const code = input.code ?? BCI;
    activity.push({ id: `armaar_act_${input.id}`, companyId: companyId(code), module: input.module, entityType: input.entityType, entityId: input.entityId, action: input.action, message: input.message, actorMemberId: m(input.by, code), actorUserId: userId(input.by), metadata: input.projectId ? { projectId: input.projectId } : undefined, createdAt: input.at });
  };

  /* External companies: suppliers (§44, §45) ---------------------------------- */
  // Tax numbers begin with X: no Albanian NIPT does, so none can be a real company's.
  const SUPPLIERS: Array<{ key: string; name: string; taxId: string; category: string; companies: CompanyCode[] }> = [
    { key: "albabuild", name: "AlbaBuild sh.p.k.", taxId: "X90000001A", category: "Concrete works and ready-mix", companies: [BCI, "IDEAL_CONSTRUCTION"] },
    { key: "adriatik_steel", name: "Adriatik Steel sh.p.k.", taxId: "X90000002B", category: "Reinforcing steel", companies: [BCI, "ARLIS_NDERTIM"] },
    { key: "tirana_readymix", name: "Tirana Ready-Mix sh.p.k.", taxId: "X90000003C", category: "Ready-mix concrete", companies: [BCI, "ARLIS_NDERTIM"] },
    { key: "vlora_glass", name: "Vlora Glass Systems sh.p.k.", taxId: "X90000004D", category: "Curtain wall and glazing", companies: [BCI] },
    { key: "elektronord", name: "ElektroNord sh.p.k.", taxId: "X90000005E", category: "Electrical supply and installation", companies: [BCI, "ARSOL_ENERGY"] },
    { key: "klimatek", name: "KlimaTek sh.p.k.", taxId: "X90000006F", category: "HVAC equipment and installation", companies: [BCI] },
    { key: "durres_finishing", name: "Durrës Finishing Works sh.p.k.", taxId: "X90000007G", category: "Interior finishing", companies: [BCI] },
    { key: "korca_timber", name: "Korça Timber sh.p.k.", taxId: "X90000008H", category: "Timber and formwork", companies: ["IDEAL_CONSTRUCTION", "ARLIS_NDERTIM"] },
    { key: "solartech", name: "SolarTech Balkans sh.p.k.", taxId: "X90000009J", category: "Photovoltaic modules and inverters", companies: ["ARSOL_ENERGY"] },
  ];
  const buyerOf: Partial<Record<CompanyCode, string>> = { BUILDING_CONSTRUCTION_INVEST: "bci.procurement", ARLIS_NDERTIM: "arlis.procurement", IDEAL_CONSTRUCTION: "ideal.procurement", ARSOL_ENERGY: "arsol.procurement" };
  for (const supplier of SUPPLIERS) {
    for (const [index, code] of supplier.companies.entries()) {
      await prisma.supplier.upsert({
        where: { id: supplierId(supplier.key, code) },
        update: {},
        create: {
          id: supplierId(supplier.key, code),
          companyId: companyId(code),
          code: `SUP-${String(SUPPLIERS.indexOf(supplier) + 1).padStart(3, "0")}`,
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
          createdByMemberId: m(buyerOf[code]!, code),
          createdAt: at(-500 + index * 30),
        },
      });
    }
  }

  /* Tirana Lake's contractors (§46) ------------------------------------------- */
  const CONTRACTORS = [
    { key: "albabuild", trade: "Concrete", discipline: "STRUCTURAL" as const, scope: "Concrete frame, cores and slabs of Towers A and B and the podium.", value: 18_400_000, supplier: "albabuild", manager: "arlis.pm", start: -700, end: 180, package: "WP-TL-01", packageName: "Structural frame — Towers A & B", packageStatus: "ACTIVE" as const },
    { key: "vlora_glass", trade: "Façade", discipline: "FACADE" as const, scope: "Unitised curtain wall to Tower B and glazing to Tower A.", value: 9_200_000, supplier: "vlora_glass", manager: "bci.architect", start: -120, end: 330, package: "WP-TL-02", packageName: "Façade — curtain wall and glazing", packageStatus: "AT_RISK" as const },
    { key: "elektronord", trade: "Electrical", discipline: "ELECTRICAL" as const, scope: "Power distribution, lighting and low-current systems.", value: 6_100_000, supplier: "elektronord", manager: "arlis.mep", start: -90, end: 420, package: "WP-TL-03", packageName: "Electrical installations", packageStatus: "ACTIVE" as const },
    { key: "klimatek", trade: "HVAC", discipline: "MECHANICAL" as const, scope: "Heating, ventilation and air conditioning, all buildings.", value: 5_400_000, supplier: "klimatek", manager: "arlis.mep", start: -60, end: 430, package: "WP-TL-04", packageName: "HVAC installations", packageStatus: "ACTIVE" as const },
    { key: "durres_finishing", trade: "Finishing", discipline: "INTERIORS" as const, scope: "Apartment and common-area finishes, Tower A.", value: 3_900_000, supplier: "durres_finishing", manager: "bci.engineering", start: 40, end: 520, package: "WP-TL-05", packageName: "Interior finishing — Tower A", packageStatus: "PLANNED" as const },
  ];
  for (const [index, contractor] of CONTRACTORS.entries()) {
    const supplier = SUPPLIERS.find((row) => row.key === contractor.supplier)!;
    const id = contractorId(contractor.key);
    if (!(await prisma.contractorProfile.findUnique({ where: { id }, select: { id: true } }))) {
      await prisma.contractorProfile.create({
        data: {
          id,
          companyId: companyId(BCI),
          legalName: supplier.name,
          vatNumber: supplier.taxId,
          email: `projects@${supplier.key.replace(/_/g, "-")}.armaar-demo.test`,
          city: "Tirana",
          countryCode: "AL",
          status: "ACTIVE",
          statusChangedAt: at(contractor.start - 30),
          supplierId: supplierId(supplier.key, BCI),
          primaryContactName: ["Arben Muka", "Elvis Dura", "Gerta Nushi", "Saimir Hoti", "Fatjona Ziu"][index],
          notes: `${contractor.trade} contractor on Tirana Lake.`,
          normalizedName: normalizeContractorName(supplier.name),
          createdByMemberId: m("bci.procurement"),
          createdAt: at(contractor.start - 40),
        },
      });
    }
    const contract = `armaar_contract_sub_${contractor.key}`;
    await prisma.contract.upsert({
      where: { id: contract },
      update: {},
      create: {
        id: contract,
        companyId: companyId(BCI),
        contractNumber: `BCI-SC-2025-${String(index + 1).padStart(3, "0")}`,
        title: `${contractor.trade} subcontract — Tirana Lake`,
        contractType: "SUBCONTRACT",
        projectId: TL,
        ownerMemberId: m("bci.legal"),
        status: contractor.start > 0 ? "SIGNED" : "ACTIVE",
        counterpartyName: supplier.name,
        currency: EUR,
        contractValue: money(contractor.value),
        signedDate: day(Math.min(contractor.start, 0) - 20),
        effectiveDate: contractor.start > 0 ? null : day(contractor.start),
        expiryDate: day(contractor.end + 180),
        governingLaw: "Albanian law",
        jurisdiction: "Tirana",
        summary: contractor.scope,
        createdByMemberId: m("bci.legal"),
        createdAt: at(Math.min(contractor.start, 0) - 30),
      },
    });
    await prisma.projectContractorAssignment.upsert({
      where: { id: `armaar_pca_${contractor.key}` },
      update: {},
      create: { id: `armaar_pca_${contractor.key}`, companyId: companyId(BCI), projectId: TL, contractorId: id, status: contractor.start > 0 ? "PLANNED" : "ACTIVE", scopeSummary: contractor.scope, contractId: contract, internalManagerMemberId: m(contractor.manager), startDate: day(contractor.start), endDate: day(contractor.end), createdByMemberId: m("bci.pm"), createdAt: at(Math.min(contractor.start, 0) - 25) },
    });
    await prisma.workPackage.upsert({
      where: { id: `armaar_wp_${contractor.key}` },
      update: {},
      create: {
        id: `armaar_wp_${contractor.key}`,
        companyId: companyId(BCI),
        projectId: TL,
        contractorId: id,
        projectContractorAssignmentId: `armaar_pca_${contractor.key}`,
        code: contractor.package,
        name: contractor.packageName,
        description: contractor.scope,
        discipline: contractor.discipline,
        status: contractor.packageStatus,
        contractId: contract,
        responsibleMemberId: m(contractor.manager),
        plannedStartDate: day(contractor.start),
        plannedFinishDate: day(contractor.end),
        forecastStartDate: day(contractor.start),
        forecastFinishDate: day(contractor.packageStatus === "AT_RISK" ? contractor.end + 35 : contractor.end),
        actualStartDate: contractor.start < 0 ? day(contractor.start + 3) : null,
        value: money(contractor.value),
        currency: EUR,
        createdByMemberId: m("bci.pm"),
        createdAt: at(Math.min(contractor.start, 0) - 25),
      },
    });
    const insurance = `armaar_cci_${contractor.key}_insurance`;
    await prisma.contractorComplianceItem.upsert({
      where: { id: insurance },
      update: {},
      create: {
        id: insurance,
        companyId: companyId(BCI),
        contractorId: id,
        type: "INSURANCE",
        title: "Contractor's all-risk insurance",
        status: index === 1 ? "EXPIRING" : index === 4 ? "MISSING" : "VALID",
        issuedAt: index === 4 ? null : day(-300),
        expiresAt: index === 4 ? null : day(index === 1 ? 12 : 65 + index * 30),
        issuer: index === 4 ? null : "Demo Insurance Co.",
        notes: index === 4 ? "Requested before mobilisation." : null,
        createdByMemberId: m("bci.legal"),
        createdAt: at(-300),
      },
    });
  }

  /* Procurement: request to delivery (§48, §49, §101) ------------------------- */
  const buyer = m("bci.procurement");
  const pm = m("bci.pm");
  const requests = [
    { id: "armaar_pr_tl_001", number: "PR-2026-0041", title: "Rebar B500C — Tower A levels 9 to 12", status: "ORDERED" as const, total: 486_000, category: "MATERIALS" as const, item: "Reinforcing steel B500C, 12–32 mm", quantity: 540, unit: "t", price: 900, submitted: -48 },
    { id: "armaar_pr_tl_002", number: "PR-2026-0044", title: "Ready-mix C35/45 — podium slab", status: "COMPLETED" as const, total: 158_400, category: "MATERIALS" as const, item: "Ready-mix concrete C35/45, pumped", quantity: 1_760, unit: "m³", price: 90, submitted: -40 },
    { id: "armaar_pr_tl_003", number: "PR-2026-0052", title: "Curtain wall brackets — Tower B levels 1 to 6", status: "PENDING_APPROVAL" as const, total: 74_500, category: "MATERIALS" as const, item: "Stainless steel curtain wall brackets", quantity: 1_490, unit: "each", price: 50, submitted: -2 },
    { id: "armaar_pr_tl_004", number: "PR-2026-0055", title: "Site safety equipment — winter season", status: "DRAFT" as const, total: 12_800, category: "EQUIPMENT" as const, item: "Harnesses, lanyards and edge protection", quantity: 160, unit: "set", price: 80, submitted: null },
    { id: "armaar_pr_tl_005", number: "PR-2026-0049", title: "Main switchgear — Tower B", status: "ORDERED" as const, total: 212_000, category: "EQUIPMENT" as const, item: "LV main switchboard and busbar trunking", quantity: 1, unit: "lot", price: 212_000, submitted: -16 },
  ];
  for (const request of requests) {
    // Who approved it and when, as the product records an approval on the request itself.
    const decided = request.status === "DRAFT" || request.status === "PENDING_APPROVAL" ? null : { approvedAt: at(request.submitted! + 1), approvedByMemberId: m("bci.director") };
    await prisma.purchaseRequest.upsert({
      where: { id: request.id },
      // The number in the product's own series shape (PR-2026-0041), so the next one it allocates follows it;
      // the status and approval the product would show for the orders raised from it.
      update: { requestNumber: request.number, status: request.status, ...decided },
      create: {
        id: request.id,
        companyId: companyId(BCI),
        requestNumber: request.number,
        title: request.title,
        projectId: TL,
        requestedByMemberId: pm,
        priority: request.id.endsWith("003") ? "HIGH" : "MEDIUM",
        currency: EUR,
        estimatedTotal: money(request.total),
        status: request.status,
        submittedAt: request.submitted === null ? null : at(request.submitted),
        ...decided,
        createdByMemberId: pm,
        createdAt: at((request.submitted ?? -1) - 2),
      },
    });
    await prisma.purchaseRequestItem.upsert({
      where: { id: `${request.id}_item_1` },
      update: {},
      create: { id: `${request.id}_item_1`, purchaseRequestId: request.id, description: request.item, quantity: qty(request.quantity), unit: request.unit, estimatedUnitPrice: qty(request.price), estimatedAmount: money(request.total), category: request.category, sortOrder: 1 },
    });
    if (request.status !== "DRAFT") {
      const pending = request.status === "PENDING_APPROVAL";
      await prisma.procurementApproval.upsert({
        where: { id: `${request.id}_approval` },
        update: {},
        create: { id: `${request.id}_approval`, companyId: companyId(BCI), recordType: "PURCHASE_REQUEST", recordId: request.id, status: pending ? "PENDING" : "APPROVED", submittedByMemberId: pm, submittedAt: at(request.submitted!), decidedByMemberId: pending ? null : m("bci.director"), decidedAt: pending ? null : at(request.submitted! + 1), decisionNote: pending ? null : "Within the Tirana Lake budget." },
      });
    }
  }
  act({ id: "pr_brackets", module: "procurement", entityType: "PurchaseRequest", entityId: "armaar_pr_tl_003", action: "PURCHASE_REQUEST_SUBMITTED", message: "submitted PR-2026-0052 for approval", by: "bci.pm", at: at(-2, 9), projectId: TL });

  const TAX = 0.2;
  const orders = [
    { id: "armaar_po_tl_001", number: "PO-2026-0031", request: "armaar_pr_tl_001", supplier: "adriatik_steel", status: "PARTIALLY_RECEIVED" as const, quantity: 540, unit: "t", price: 885, item: "Reinforcing steel B500C, 12–32 mm", ordered: -44, received: [{ id: "armaar_grn_tl_001", number: "GRN-2026-0058", fraction: 0.45, days: -20 }] },
    { id: "armaar_po_tl_002", number: "PO-2026-0034", request: "armaar_pr_tl_002", supplier: "tirana_readymix", status: "RECEIVED" as const, quantity: 1_760, unit: "m³", price: 88, item: "Ready-mix concrete C35/45, pumped", ordered: -36, received: [{ id: "armaar_grn_tl_002", number: "GRN-2026-0061", fraction: 0.6, days: -25 }, { id: "armaar_grn_tl_003", number: "GRN-2026-0066", fraction: 0.4, days: -12 }] },
    { id: "armaar_po_tl_003", number: "PO-2026-0039", request: "armaar_pr_tl_005", supplier: "elektronord", status: "PENDING_APPROVAL" as const, quantity: 1, unit: "lot", price: 208_500, item: "LV main switchboard and busbar trunking", ordered: -4, received: [] },
  ];
  for (const order of orders) {
    const subtotal = order.quantity * order.price;
    await prisma.purchaseOrder.upsert({
      where: { id: order.id },
      update: { poNumber: order.number, approvedByMemberId: order.status === "PENDING_APPROVAL" ? null : m("bci.director") },
      create: {
        id: order.id,
        companyId: companyId(BCI),
        poNumber: order.number,
        supplierId: supplierId(order.supplier, BCI),
        purchaseRequestId: order.request,
        projectId: TL,
        orderDate: day(order.ordered),
        requiredDate: day(order.ordered + 21),
        currency: EUR,
        subtotal: money(subtotal),
        taxAmount: money(subtotal * TAX),
        totalAmount: money(subtotal * (1 + TAX)),
        status: order.status,
        submittedAt: at(order.ordered),
        approvedAt: order.status === "PENDING_APPROVAL" ? null : at(order.ordered + 1),
        approvedByMemberId: order.status === "PENDING_APPROVAL" ? null : m("bci.director"),
        issuedAt: order.status === "PENDING_APPROVAL" ? null : at(order.ordered + 1),
        createdByMemberId: buyer,
        createdAt: at(order.ordered),
      },
    });
    // The line names the request line it orders, which is how the product knows the request is covered.
    await prisma.purchaseOrderItem.upsert({
      where: { id: `${order.id}_item_1` },
      update: { sourceRequestItemId: `${order.request}_item_1` },
      create: { id: `${order.id}_item_1`, purchaseOrderId: order.id, sourceRequestItemId: `${order.request}_item_1`, description: order.item, quantity: qty(order.quantity), unit: order.unit, unitPrice: qty(order.price), taxRate: new Prisma.Decimal(TAX.toFixed(4)), subtotal: money(subtotal), taxAmount: money(subtotal * TAX), totalAmount: money(subtotal * (1 + TAX)), sortOrder: 1 },
    });
    await prisma.procurementApproval.upsert({
      where: { id: `${order.id}_approval` },
      update: {},
      create: {
        id: `${order.id}_approval`,
        companyId: companyId(BCI),
        recordType: "PURCHASE_ORDER",
        recordId: order.id,
        status: order.status === "PENDING_APPROVAL" ? "PENDING" : "APPROVED",
        submittedByMemberId: buyer,
        submittedAt: at(order.ordered),
        decidedByMemberId: order.status === "PENDING_APPROVAL" ? null : m("bci.director"),
        decidedAt: order.status === "PENDING_APPROVAL" ? null : at(order.ordered + 1),
      },
    });
    for (const receipt of order.received) {
      await prisma.goodsReceipt.upsert({
        where: { id: receipt.id },
        update: { receiptNumber: receipt.number },
        create: { id: receipt.id, companyId: companyId(BCI), receiptNumber: receipt.number, purchaseOrderId: order.id, projectId: TL, supplierId: supplierId(order.supplier, BCI), receiptDate: day(receipt.days), deliveryReference: `DN-${receipt.number.slice(-3)}`, status: "RECORDED", receivedByMemberId: m("arlis.inventory"), createdByMemberId: buyer, createdAt: at(receipt.days, 15) },
      });
      const received = order.quantity * receipt.fraction;
      await prisma.goodsReceiptItem.upsert({
        where: { id: `${receipt.id}_item_1` },
        update: {},
        create: { id: `${receipt.id}_item_1`, goodsReceiptId: receipt.id, purchaseOrderItemId: `${order.id}_item_1`, receivedQuantity: qty(received), acceptedQuantity: qty(received), rejectedQuantity: qty(0) },
      });
    }
  }
  act({ id: "po_rebar_issued", module: "procurement", entityType: "PurchaseOrder", entityId: "armaar_po_tl_001", action: "PURCHASE_ORDER_APPROVED", message: "approved PO-2026-0031 for Adriatik Steel", by: "bci.director", at: at(-43), projectId: TL });
  act({ id: "po_switchgear", module: "procurement", entityType: "PurchaseOrder", entityId: "armaar_po_tl_003", action: "PURCHASE_ORDER_SUBMITTED", message: "submitted PO-2026-0039 for approval", by: "bci.procurement", at: at(-4, 11), projectId: TL });
  act({ id: "grn_concrete", module: "procurement", entityType: "GoodsReceipt", entityId: "armaar_grn_tl_003", action: "GOODS_RECEIPT_RECORDED", message: "recorded the final ready-mix delivery against PO-2026-0034", by: "bci.procurement", at: at(-12, 15), projectId: TL });

  /* Finance: budgets and expenses (§29, §50, §51) ----------------------------- */
  const BUDGETS: Array<{ project: ProjectCode; company: CompanyCode; total: number; finance: string }> = [
    { project: "TIRANA_LAKE", company: BCI, total: 68_000_000, finance: "bci.finance" },
    { project: "UNITED_TOWERS", company: "UNICO_CONSTRUCTION", total: 32_500_000, finance: "unico.finance" },
    { project: "SQUARE_21", company: "ARLIS_NDERTIM", total: 14_200_000, finance: "arlis.finance" },
    { project: "GRAN_MELIA", company: "SARANDA_MARINA_INVEST", total: 21_800_000, finance: "smi.finance" },
    { project: "CLEARWATER_BEACH", company: "SARANDA_MARINA_INVEST", total: 12_400_000, finance: "smi.finance" },
    { project: "POGRADEC_MARINA", company: "KF_POGRADECI", total: 9_600_000, finance: "kfp.director" },
    { project: "EYES_OF_TIRANA", company: "IDEAL_CONSTRUCTION", total: 7_400_000, finance: "ideal.finance" },
    { project: "PHARMACY_10", company: "ARLIS_NDERTIM", total: 2_100_000, finance: "arlis.finance" },
    { project: "FARKA_RESIDENCE", company: "ARLIS_NDERTIM", total: 5_200_000, finance: "arlis.finance" },
    { project: "CORNER", company: "ARLIS_NDERTIM", total: 4_800_000, finance: "arlis.finance" },
    { project: "THE_COURTYARD", company: "ARLIS_NDERTIM", total: 6_300_000, finance: "arlis.finance" },
  ];
  const SPLIT: Array<[Prisma.ProjectBudgetLineItemCreateWithoutBudgetInput["category"], string, number]> = [
    ["SUBCONTRACTOR", "Main and trade subcontracts", 0.58],
    ["MATERIALS", "Materials bought directly", 0.22],
    ["SERVICES", "Design, supervision and permits", 0.1],
    ["EQUIPMENT", "Plant and equipment", 0.05],
    ["ADMINISTRATION", "Site management and overheads", 0.05],
  ];
  for (const budget of BUDGETS) {
    const director = personOf(`${budget.company === BCI ? "bci" : budget.company === "SARANDA_MARINA_INVEST" ? "smi" : budget.company === "KF_POGRADECI" ? "kfp" : budget.company === "UNICO_CONSTRUCTION" ? "unico" : budget.company === "IDEAL_CONSTRUCTION" ? "ideal" : "arlis"}.director`)!;
    const id = `armaar_budget_${budget.project.toLowerCase()}`;
    await prisma.projectBudget.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: companyId(budget.company),
        projectId: projectId(budget.project),
        version: 1,
        name: "Approved budget",
        currency: EUR,
        status: "APPROVED",
        isCurrent: true,
        totalAmount: money(budget.total),
        createdByMemberId: m(budget.finance, budget.company),
        approvedByMemberId: m(director.username, budget.company),
        approvedAt: at(-200),
        lineItems: { create: SPLIT.map(([category, description, share], index) => ({ category, description, plannedAmount: money(budget.total * share), sortOrder: index })) },
      },
    });
  }
  const expenses = [
    { id: "armaar_exp_tl_001", number: "EXP-2026-118", description: "Ready-mix C35/45 — podium slab (PO-2026-0034)", payee: "Tirana Ready-Mix sh.p.k.", net: 154_880, status: "APPROVED" as const, days: -10, category: "MATERIALS" as const },
    { id: "armaar_exp_tl_002", number: "EXP-2026-121", description: "Rebar B500C, first delivery (PO-2026-0031)", payee: "Adriatik Steel sh.p.k.", net: 215_055, status: "PENDING_APPROVAL" as const, days: -3, category: "MATERIALS" as const },
    { id: "armaar_exp_tl_003", number: "EXP-2026-104", description: "Tower crane hire — August", payee: "AlbaBuild sh.p.k.", net: 38_500, status: "APPROVED" as const, days: -30, category: "EQUIPMENT" as const },
  ];
  for (const expense of expenses) {
    await prisma.expense.upsert({
      where: { id: expense.id },
      update: {},
      create: { id: expense.id, companyId: companyId(BCI), expenseNumber: expense.number, projectId: TL, expenseDate: day(expense.days), category: expense.category, description: expense.description, payeeName: expense.payee, currency: EUR, netAmount: money(expense.net), taxAmount: money(expense.net * TAX), totalAmount: money(expense.net * (1 + TAX)), status: expense.status, createdByMemberId: m("bci.finance-specialist"), createdAt: at(expense.days) },
    });
    if (expense.status === "PENDING_APPROVAL") {
      await prisma.financeApproval.upsert({
        where: { id: `${expense.id}_approval` },
        update: {},
        create: { id: `${expense.id}_approval`, companyId: companyId(BCI), recordType: "EXPENSE", recordId: expense.id, status: "PENDING", submittedByMemberId: m("bci.finance-specialist"), submittedAt: at(expense.days) },
      });
    }
  }
  act({ id: "expense_rebar", module: "finance", entityType: "Expense", entityId: "armaar_exp_tl_002", action: "EXPENSE_SUBMITTED", message: "submitted EXP-2026-121 for approval", by: "bci.finance-specialist", at: at(-3, 14), projectId: TL });

  /* Legal (§52) ----------------------------------------------------------------- */
  const legal = m("bci.legal");
  const contracts = [
    { id: "armaar_contract_construction_tl", number: "BCI-CC-2024-001", title: "Construction contract — Tirana Lake Phase 1", type: "SUBCONTRACT" as const, counterparty: "ARLIS - NDERTIM", value: 52_000_000, status: "ACTIVE" as const, signed: -760, summary: "Main construction of Towers A and B and the podium, within the group." },
    { id: "armaar_contract_framework_steel", number: "BCI-FW-2025-003", title: "Reinforcing steel supply framework", type: "FRAMEWORK" as const, counterparty: "Adriatik Steel sh.p.k.", value: 2_400_000, status: "ACTIVE" as const, signed: -210, summary: "Call-off prices for rebar across the group's Tirana projects." },
    { id: "armaar_contract_employment_pm", number: "BCI-EMP-2023-014", title: "Employment contract — Project Manager, Tirana Lake", type: "EMPLOYMENT_RELATED" as const, counterparty: "Ergys Lamaj", value: undefined, status: "ACTIVE" as const, signed: -1300, summary: "Indefinite term. Synthetic demo record." },
    { id: "armaar_contract_employment_sales", number: "BCI-EMP-2025-031", title: "Employment contract — Sales Agent", type: "EMPLOYMENT_RELATED" as const, counterparty: "Eros Shehaj", value: undefined, status: "ACTIVE" as const, signed: -420, summary: "Fixed term, two years. Synthetic demo record." },
  ];
  for (const contract of contracts) {
    await prisma.contract.upsert({
      where: { id: contract.id },
      update: {},
      create: {
        id: contract.id,
        companyId: companyId(BCI),
        contractNumber: contract.number,
        title: contract.title,
        contractType: contract.type,
        projectId: contract.type === "EMPLOYMENT_RELATED" ? null : TL,
        ownerMemberId: legal,
        status: contract.status,
        counterpartyName: contract.counterparty,
        currency: contract.value === undefined ? null : EUR,
        contractValue: contract.value === undefined ? null : money(contract.value),
        signedDate: day(contract.signed),
        effectiveDate: day(contract.signed + 1),
        governingLaw: "Albanian law",
        jurisdiction: "Tirana",
        summary: contract.summary,
        createdByMemberId: legal,
        createdAt: at(contract.signed - 14),
      },
    });
  }
  await prisma.contractAmendment.upsert({
    where: { id: "armaar_amendment_facade_001" },
    update: {},
    create: { id: "armaar_amendment_facade_001", companyId: companyId(BCI), contractId: "armaar_contract_sub_vlora_glass", amendmentNumber: "AMD-001", title: "Tower B glazing specification change", summary: "Triple glazing to the upper six floors of Tower B; +€310,000 and 21 days.", status: "PENDING_APPROVAL", createdByMemberId: legal, createdAt: at(-5) },
  });
  await prisma.contractApproval.upsert({
    where: { id: "armaar_amendment_facade_001_approval" },
    update: {},
    create: { id: "armaar_amendment_facade_001_approval", companyId: companyId(BCI), recordType: "AMENDMENT", recordId: "armaar_amendment_facade_001", status: "PENDING", submittedByMemberId: legal, submittedAt: at(-5, 11) },
  });
  act({ id: "amendment_facade", module: "contracts", entityType: "ContractAmendment", entityId: "armaar_amendment_facade_001", action: "CONTRACT_AMENDMENT_SUBMITTED", message: "submitted amendment AMD-001 to the façade subcontract for approval", by: "bci.legal", at: at(-5, 11), projectId: TL });
  act({ id: "contract_finishing", module: "contracts", entityType: "Contract", entityId: "armaar_contract_sub_durres_finishing", action: "CONTRACT_SIGNED", message: "recorded the finishing subcontract BCI-SC-2025-005 as signed", by: "bci.legal", at: at(-20, 16), projectId: TL });

  /* Documents (§56, §57) --------------------------------------------------------- */
  const DOCUMENTS: Array<[string, string, CompanyCode]> = [
    ["Tower A — general arrangement, levels 1–12.pdf", "bci.architect", BCI],
    ["Tower A — sections A-A and B-B.pdf", "bci.architect", BCI],
    ["Tower B — typical office floor plan.pdf", "unico.architect", BCI],
    ["Podium — retail frontage elevations.pdf", "bci.architect", BCI],
    ["Structural drawings — Tower A cores.pdf", "arlis.civil", BCI],
    ["Structural calculations — podium transfer slab.pdf", "arlis.civil", BCI],
    ["MEP — Tower A risers and plant rooms.pdf", "arlis.mep", BCI],
    ["MEP — electrical single-line diagram.pdf", "arlis.mep", BCI],
    ["Site report — week 36.pdf", "arlis.site-engineer", BCI],
    ["Site report — week 37.pdf", "arlis.site-engineer", BCI],
    ["Inspection report — Tower A level 10 slab.pdf", "arlis.qaqc-engineer", BCI],
    ["HSE monthly report — August.pdf", "arlis.hse-officer", BCI],
    ["Coordination meeting minutes — week 37.pdf", "bci.pm", BCI],
    ["Purchase order PO-2026-0031.pdf", "bci.procurement", BCI],
    ["Construction contract — signed.pdf", "bci.legal", BCI],
    ["Tirana Lake — price list, phase 1.xlsx", "bci.sales", BCI],
    ["Tirana Lake — sales brochure.pdf", "bci.sales", BCI],
    ["Building permit — Tirana Lake phase 1.pdf", "bci.pm-lead", BCI],
    ["Façade mock-up approval.pdf", "bci.architect", BCI],
    ["Concrete test results — September.pdf", "arlis.qaqc-engineer", BCI],
    ["Budget report — Q3.xlsx", "bci.finance", BCI],
    ["Handover plan — phase 1.pdf", "bci.pm", BCI],
  ];
  for (const [index, [name, username, code]] of DOCUMENTS.entries()) {
    const id = `armaar_doc_tl_${String(index + 1).padStart(2, "0")}`;
    await seedStoredDocument(prisma, { id, companyId: companyId(code), name, projectId: TL, entityType: "project", entityId: TL, uploadedByMemberId: m(username, code), createdBy: userId(username) });
    await prisma.document.update({ where: { id }, data: { createdAt: at(-60 + index * 2) } });
  }
  act({ id: "doc_site_report", module: "documents", entityType: "Document", entityId: "armaar_doc_tl_10", action: "DOCUMENT_UPLOADED", message: "uploaded “Site report — week 37.pdf”", by: "arlis.site-engineer", at: at(-1, 17), projectId: TL });

  /* Tasks (§58) ------------------------------------------------------------------ */
  const TASKS: Array<{ title: string; project: ProjectCode; company: CompanyCode; assignee: string; creator: string; status: "TODO" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED"; priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; due: number }> = [
    { title: "Review façade drawing revision C", project: "TIRANA_LAKE", company: BCI, assignee: "bci.architect", creator: "bci.pm", status: "IN_PROGRESS", priority: "HIGH", due: 3 },
    { title: "Approve supplier submittal — curtain wall brackets", project: "TIRANA_LAKE", company: BCI, assignee: "bci.engineering", creator: "bci.pm", status: "TODO", priority: "HIGH", due: 5 },
    { title: "Resolve RFI-009 — Tower A core wall openings at level 9", project: "TIRANA_LAKE", company: BCI, assignee: "arlis.civil", creator: "arlis.pm", status: "IN_PROGRESS", priority: "CRITICAL", due: 1 },
    { title: "Verify contractor progress — structural frame, September", project: "TIRANA_LAKE", company: BCI, assignee: "bci.engineering", creator: "bci.pm", status: "TODO", priority: "MEDIUM", due: 8 },
    { title: "Prepare client contract — A-503", project: "TIRANA_LAKE", company: BCI, assignee: "bci.legal", creator: "bci.sales", status: "TODO", priority: "MEDIUM", due: 6 },
    { title: "Update unit sales status after the weekend viewings", project: "TIRANA_LAKE", company: BCI, assignee: "bci.sales-agent", creator: "bci.sales", status: "COMPLETED", priority: "LOW", due: -2 },
    { title: "Close NCR-2026-0014 — slab edge cover", project: "TIRANA_LAKE", company: BCI, assignee: "arlis.qaqc-engineer", creator: "arlis.pm", status: "BLOCKED", priority: "HIGH", due: -3 },
    { title: "Book crane for the Tower B curtain wall lift", project: "TIRANA_LAKE", company: BCI, assignee: "arlis.site-supervisor", creator: "arlis.pm", status: "TODO", priority: "HIGH", due: 4 },
    { title: "Issue MEP coordination model v14", project: "TIRANA_LAKE", company: BCI, assignee: "arlis.mep", creator: "bci.pm", status: "IN_PROGRESS", priority: "MEDIUM", due: 9 },
    { title: "Toolbox talk — working at height on the façade", project: "TIRANA_LAKE", company: BCI, assignee: "arlis.hse-officer", creator: "arlis.hse", status: "COMPLETED", priority: "MEDIUM", due: -5 },
    { title: "Reconcile rebar deliveries with PO-2026-0031", project: "TIRANA_LAKE", company: BCI, assignee: "arlis.inventory", creator: "bci.procurement", status: "IN_PROGRESS", priority: "MEDIUM", due: 2 },
    { title: "Chase contractor's all-risk insurance — finishing works", project: "TIRANA_LAKE", company: BCI, assignee: "bci.legal", creator: "bci.pm", status: "TODO", priority: "HIGH", due: -1 },
    { title: "Show apartment furniture sign-off", project: "TIRANA_LAKE", company: BCI, assignee: "bci.sales", creator: "bci.pm-lead", status: "IN_PROGRESS", priority: "MEDIUM", due: 10 },
    { title: "Q3 cost report for the board", project: "TIRANA_LAKE", company: BCI, assignee: "bci.finance", creator: "bci.director", status: "TODO", priority: "HIGH", due: 12 },
    { title: "Tower design brief for the upper floors", project: "UNITED_TOWERS", company: "UNICO_CONSTRUCTION", assignee: "unico.architecture", creator: "unico.coordinator", status: "IN_PROGRESS", priority: "MEDIUM", due: 14 },
    { title: "Hotel operator term sheet review", project: "UNITED_TOWERS", company: "UNICO_CONSTRUCTION", assignee: "unico.coordinator", creator: "unico.director", status: "TODO", priority: "HIGH", due: 7 },
    { title: "Final account — Square 21 main contract", project: "SQUARE_21", company: "ARLIS_NDERTIM", assignee: "arlis.accountant", creator: "arlis.finance", status: "IN_PROGRESS", priority: "MEDIUM", due: 20 },
    { title: "Defects liability walk-round — Block 2", project: "SQUARE_21", company: "ARLIS_NDERTIM", assignee: "arlis.pm-lead", creator: "arlis.director", status: "TODO", priority: "LOW", due: 15 },
    { title: "Villas structural package tender", project: "GRAN_MELIA", company: "SARANDA_MARINA_INVEST", assignee: "smi.pm", creator: "smi.director", status: "IN_PROGRESS", priority: "HIGH", due: 6 },
    { title: "Hotel FF&E budget alignment", project: "GRAN_MELIA", company: "SARANDA_MARINA_INVEST", assignee: "smi.finance", creator: "smi.pm", status: "TODO", priority: "MEDIUM", due: 11 },
    { title: "Beach club concept review", project: "CLEARWATER_BEACH", company: "SARANDA_MARINA_INVEST", assignee: "smi.architect", creator: "smi.pm", status: "TODO", priority: "LOW", due: 25 },
    { title: "Breakwater survey — second pass", project: "POGRADEC_MARINA", company: "KF_POGRADECI", assignee: "kfp.pm", creator: "kfp.director", status: "IN_PROGRESS", priority: "MEDIUM", due: 9 },
    { title: "Concept design pack for permit submission", project: "EYES_OF_TIRANA", company: "IDEAL_CONSTRUCTION", assignee: "unico.architect", creator: "unico.coordinator", status: "IN_PROGRESS", priority: "HIGH", due: 18 },
    { title: "Façade study — option B", project: "EYES_OF_TIRANA", company: "IDEAL_CONSTRUCTION", assignee: "unico.designer", creator: "unico.architecture", status: "TODO", priority: "MEDIUM", due: 22 },
    { title: "Block C slab pour sequence", project: "FARKA_RESIDENCE", company: "ARLIS_NDERTIM", assignee: "arlis.structural", creator: "arlis.pm-lead", status: "IN_PROGRESS", priority: "HIGH", due: 3 },
    { title: "Scaffold inspection — Block B", project: "FARKA_RESIDENCE", company: "ARLIS_NDERTIM", assignee: "arlis.hse", creator: "arlis.pm-lead", status: "TODO", priority: "HIGH", due: 1 },
    { title: "Finishes snagging — courtyard block 2", project: "THE_COURTYARD", company: "ARLIS_NDERTIM", assignee: "arlis.qaqc", creator: "arlis.pm-lead", status: "IN_PROGRESS", priority: "MEDIUM", due: 5 },
    { title: "Landscape subcontract award", project: "THE_COURTYARD", company: "ARLIS_NDERTIM", assignee: "arlis.procurement", creator: "arlis.pm-lead", status: "TODO", priority: "MEDIUM", due: 13 },
  ];
  for (const [index, task] of TASKS.entries()) {
    const id = `armaar_task_${String(index + 1).padStart(3, "0")}`;
    await prisma.task.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: companyId(task.company),
        projectId: projectId(task.project),
        title: task.title,
        assigneeMemberId: m(task.assignee, task.company),
        createdByMemberId: m(task.creator, task.company),
        status: task.status,
        priority: task.priority,
        startDate: day(Math.min(task.due - 10, -1)),
        dueDate: day(task.due),
        completedAt: task.status === "COMPLETED" ? at(task.due - 1) : null,
        createdBy: userId(task.creator),
        createdAt: at(Math.min(task.due - 12, -2)),
      },
    });
    if (index < 5) act({ id: `task_${index + 1}`, code: task.company, module: "tasks", entityType: "Task", entityId: id, action: "TASK_ASSIGNED", message: `assigned “${task.title}”`, by: task.creator, at: at(-1 - index, 9 + index), projectId: projectId(task.project) });
  }

  /* Meetings (§60) ---------------------------------------------------------------- */
  const template = (key: string) => AGENDA_TEMPLATES.find((row) => row.key === key)!.items;
  const MEETINGS: Array<{ id: string; company: CompanyCode; project: ProjectCode | null; organizer: string; title: string; type: "COORDINATION" | "PROCUREMENT" | "DESIGN_REVIEW" | "FINANCE" | "HSE" | "CLIENT" | "MANAGEMENT"; day: number; from: string; to: string; seats: string[]; agenda: string; held: boolean }> = [
    { id: "armaar_mtg_tl_coord_past", company: BCI, project: "TIRANA_LAKE", organizer: "bci.pm", title: "Weekly project coordination — Tirana Lake", type: "COORDINATION", day: -6, from: "09:00", to: "10:30", seats: ["arlis.pm", "bci.architect", "bci.engineering", "arlis.mep", "arlis.hse", "bci.procurement"], agenda: "project-coordination", held: true },
    { id: "armaar_mtg_tl_coord_next", company: BCI, project: "TIRANA_LAKE", organizer: "bci.pm", title: "Weekly project coordination — Tirana Lake", type: "COORDINATION", day: 1, from: "09:00", to: "10:30", seats: ["arlis.pm", "bci.architect", "bci.engineering", "arlis.mep", "arlis.hse", "bci.procurement"], agenda: "project-coordination", held: false },
    { id: "armaar_mtg_tl_procurement", company: BCI, project: "TIRANA_LAKE", organizer: "bci.procurement", title: "Procurement review — façade and MEP packages", type: "PROCUREMENT", day: 2, from: "11:00", to: "12:00", seats: ["bci.pm", "arlis.buyer", "bci.finance"], agenda: "general", held: false },
    { id: "armaar_mtg_tl_design", company: BCI, project: "TIRANA_LAKE", organizer: "bci.architect", title: "Design coordination — Tower B envelope", type: "DESIGN_REVIEW", day: 3, from: "14:00", to: "15:30", seats: ["unico.architect", "bci.engineering", "arlis.mep"], agenda: "design-review", held: false },
    { id: "armaar_mtg_bci_finance", company: BCI, project: null, organizer: "bci.finance", title: "Finance review — Q3 cash flow", type: "FINANCE", day: 4, from: "10:00", to: "11:00", seats: ["bci.director", "bci.finance-specialist"], agenda: "management", held: false },
    { id: "armaar_mtg_tl_hse", company: BCI, project: "TIRANA_LAKE", organizer: "arlis.hse", title: "HSE meeting — façade works and lifting", type: "HSE", day: -3, from: "08:00", to: "08:45", seats: ["arlis.hse-officer", "arlis.site-supervisor", "arlis.pm"], agenda: "hse", held: true },
    { id: "armaar_mtg_bci_sales", company: BCI, project: "TIRANA_LAKE", organizer: "bci.sales", title: "Sales review — phase 1 inventory", type: "MANAGEMENT", day: 2, from: "16:00", to: "17:00", seats: ["bci.sales-agent", "bci.sales-agent2", "bci.director"], agenda: "general", held: false },
    { id: "armaar_mtg_gm_design", company: "SARANDA_MARINA_INVEST", project: "GRAN_MELIA", organizer: "smi.pm", title: "Gran Melia — villas design review", type: "DESIGN_REVIEW", day: 5, from: "10:00", to: "11:30", seats: ["smi.architect", "smi.director"], agenda: "design-review", held: false },
    { id: "armaar_mtg_frk_site", company: "ARLIS_NDERTIM", project: "FARKA_RESIDENCE", organizer: "arlis.pm-lead", title: "Farka Residence — site meeting", type: "COORDINATION", day: -2, from: "08:30", to: "09:30", seats: ["arlis.structural", "arlis.hse", "arlis.qaqc"], agenda: "site-meeting", held: true },
    { id: "armaar_mtg_arlis_management", company: "ARLIS_NDERTIM", project: null, organizer: "arlis.director", title: "ARLIS - NDERTIM management meeting", type: "MANAGEMENT", day: 6, from: "09:00", to: "10:00", seats: ["arlis.finance", "arlis.pm-lead", "arlis.engineering", "arlis.hse"], agenda: "management", held: false },
  ];
  for (const meeting of MEETINGS) {
    const date = addLocalDays(today, meeting.day);
    const startsAt = instantFromLocal(date, meeting.from, ZONE);
    const endsAt = instantFromLocal(date, meeting.to, ZONE);
    const organizer = m(meeting.organizer, meeting.company);
    const data = {
      companyId: companyId(meeting.company),
      projectId: meeting.project ? projectId(meeting.project) : null,
      createdByMemberId: organizer,
      organizerMemberId: organizer,
      title: meeting.title,
      meetingType: meeting.type,
      status: meeting.held ? ("COMPLETED" as const) : ("SCHEDULED" as const),
      startsAt,
      endsAt,
      timezone: ZONE,
      locationType: "IN_PERSON" as const,
      locationText: meeting.project === "TIRANA_LAKE" ? "Tirana Lake — site office" : "Head office, meeting room 2",
      visibility: meeting.project ? ("PROJECT" as const) : ("PARTICIPANTS" as const),
      startedAt: meeting.held ? startsAt : null,
      completedAt: meeting.held ? endsAt : null,
      minutesStatus: meeting.held ? ("FINAL" as const) : ("DRAFT" as const),
      minutesFinalizedAt: meeting.held ? new Date(endsAt.getTime() + 3_600_000) : null,
      minutesFinalizedByMemberId: meeting.held ? organizer : null,
    };
    await prisma.meeting.upsert({ where: { id: meeting.id }, update: {}, create: { id: meeting.id, ...data } });
    for (const [index, username] of [meeting.organizer, ...meeting.seats].entries()) {
      const member = m(username, meeting.company);
      const person = personOf(username)!;
      await prisma.meetingParticipant.upsert({
        where: { meetingId_memberId: { meetingId: meeting.id, memberId: member } },
        update: {},
        create: { meetingId: meeting.id, memberId: member, companyId: companyId(meeting.company), role: index === 0 ? "ORGANIZER" : "ATTENDEE", response: "ACCEPTED", attendance: meeting.held ? "PRESENT" : "UNKNOWN", displayName: `${person.firstName} ${person.lastName}`, invitedAt: at(meeting.day - 7), respondedAt: at(meeting.day - 6) },
      });
    }
    if ((await prisma.meetingAgendaItem.count({ where: { meetingId: meeting.id } })) === 0) {
      await prisma.meetingAgendaItem.createMany({ data: template(meeting.agenda).map((item, index) => ({ companyId: companyId(meeting.company), meetingId: meeting.id, sortOrder: index, title: item.title, plannedMinutes: item.plannedMinutes ?? null, status: meeting.held ? ("DISCUSSED" as const) : ("PENDING" as const) })) });
    }
  }
  // The last coordination meeting's minutes, decisions and actions (§60).
  const held = "armaar_mtg_tl_coord_past";
  const secretary = m("bci.pm");
  await prisma.meetingMinutesSection.upsert({ where: { id: `${held}_summary` }, update: {}, create: { id: `${held}_summary`, companyId: companyId(BCI), meetingId: held, sortOrder: 0, title: "Summary", body: "Tower A level 11 slab poured on programme. Tower B curtain wall mock-up passed its water test; the bracket order waits for approval. MEP first fix on Tower A levels 1–4 is two weeks behind: extra crews from Monday.", createdByMemberId: secretary } });
  await prisma.meetingDecision.upsert({ where: { id: `${held}_decision_1` }, update: {}, create: { id: `${held}_decision_1`, companyId: companyId(BCI), meetingId: held, decisionNumber: 1, title: "Add a second MEP crew to Tower A until first fix is back on programme.", decidedAt: instantFromLocal(addLocalDays(today, -6), "10:10", ZONE), recordedByMemberId: secretary } });
  const actions = [
    { id: `${held}_action_1`, title: "Confirm the second MEP crew with ElektroNord", ownerMemberId: m("arlis.mep"), dueAt: day(2), status: "IN_PROGRESS" as const },
    { id: `${held}_action_2`, title: "Chase approval of PR-2026-0052 (curtain wall brackets)", ownerMemberId: m("bci.procurement"), dueAt: day(-1), status: "OPEN" as const },
    { id: `${held}_action_3`, title: "Circulate the level 11 pour report", ownerMemberId: m("arlis.site-engineer"), dueAt: day(-4), status: "DONE" as const, completedAt: at(-4) },
  ];
  for (const action of actions) await prisma.meetingActionItem.upsert({ where: { id: action.id }, update: {}, create: { ...action, companyId: companyId(BCI), meetingId: held, createdByMemberId: secretary } });
  act({ id: "meeting_minutes", module: "meetings", entityType: "Meeting", entityId: held, action: "MEETING_MINUTES_FINALIZED", message: "finalised the minutes of the Tirana Lake coordination meeting", by: "bci.pm", at: at(-6, 12), projectId: TL });

  /* Calendar (§61) ---------------------------------------------------------------- */
  const allDay = (offset: number) => ({ startsAt: new Date(`${addLocalDays(today, offset)}T00:00:00.000Z`), endsAt: new Date(`${addLocalDays(today, offset + 1)}T00:00:00.000Z`), allDay: true, timezone: ZONE });
  const timed = (offset: number, from: string, to: string) => ({ startsAt: instantFromLocal(addLocalDays(today, offset), from, ZONE), endsAt: instantFromLocal(addLocalDays(today, offset), to, ZONE), allDay: false, timezone: ZONE });
  const EVENTS = [
    { id: "armaar_cal_show_apartment", company: BCI, by: "bci.director", title: "Tirana Lake — show apartment opening", eventType: "COMPANY_EVENT" as const, visibility: "COMPANY" as const, projectId: TL, ...timed(9, "17:00", "20:00"), location: "Tower A, level 5" },
    { id: "armaar_cal_budget_deadline", company: BCI, by: "bci.finance", title: "Q4 budget submissions due", eventType: "INTERNAL_DEADLINE" as const, visibility: "COMPANY" as const, projectId: null, ...allDay(14), location: null },
    { id: "armaar_cal_hse_training", company: "ARLIS_NDERTIM" as CompanyCode, by: "arlis.hse", title: "Working at height refresher", eventType: "TRAINING" as const, visibility: "COMPANY" as const, projectId: null, ...timed(5, "08:00", "10:00"), location: "Tirana Lake — site office" },
    { id: "armaar_cal_holiday", company: BCI, by: "bci.director", title: "Independence Day — offices closed", eventType: "COMPANY_HOLIDAY" as const, visibility: "COMPANY" as const, projectId: null, ...allDay(20), location: null },
  ];
  for (const event of EVENTS) {
    const { company, by, ...rest } = event;
    await prisma.calendarEvent.upsert({ where: { id: event.id }, update: {}, create: { ...rest, companyId: companyId(company), createdByMemberId: m(by, company) } });
  }

  /* Announcements (§63) ------------------------------------------------------------ */
  for (const code of [BCI, "ARLIS_NDERTIM"] as CompanyCode[]) await prisma.productivitySettings.upsert({ where: { companyId: companyId(code) }, update: {}, create: { companyId: companyId(code) } });
  const ANNOUNCEMENTS = [
    { id: "armaar_ann_group_welcome", company: BCI, by: "armaar.owner", title: "One group, one operating system", body: "From this month every company of the group works in NESTO: projects, people, documents, money and approvals in one place.\n\nQuestions go to Group IT.", audienceType: "COMPANY" as const, pinned: true, priority: "NORMAL" as const, days: -8 },
    { id: "armaar_ann_arlis_safety", company: "ARLIS_NDERTIM" as CompanyCode, by: "arlis.director", title: "Site safety stand-down on Monday", body: "Every site stops at 08:00 on Monday for a thirty-minute safety briefing. Attendance is recorded.", audienceType: "COMPANY" as const, pinned: false, priority: "IMPORTANT" as const, days: -2 },
    { id: "armaar_ann_bci_sales", company: BCI, by: "bci.sales", title: "Phase 1 price list — upper floors revised", body: "Floors 5 to 10 of Tower A are repriced from today. Reservations already made keep their agreed price.", audienceType: "DEPARTMENT" as const, departmentId: branchId(BCI, "sales"), pinned: false, priority: "NORMAL" as const, days: -1 },
    { id: "armaar_ann_tl_lift", company: BCI, by: "bci.pm", title: "Curtain wall lifts on Tower B this week", body: "The tower crane lifts curtain wall units onto Tower B from Wednesday.\n\n> The zone below the lift path is closed while the crane is working.", audienceType: "PROJECT" as const, projectId: TL, pinned: false, priority: "IMPORTANT" as const, days: 0 },
  ];
  for (const announcement of ANNOUNCEMENTS) {
    const author = m(announcement.by, announcement.company);
    await prisma.announcement.upsert({
      where: { id: announcement.id },
      update: {},
      create: { id: announcement.id, companyId: companyId(announcement.company), status: "PUBLISHED", title: announcement.title, body: announcement.body, priority: announcement.priority, audienceType: announcement.audienceType, departmentId: "departmentId" in announcement ? announcement.departmentId : null, projectId: "projectId" in announcement ? announcement.projectId : null, authorMemberId: author, publishedByMemberId: author, publishedAt: at(announcement.days, 8), pinned: announcement.pinned },
    });
  }
  act({ id: "announcement_lift", module: "announcements", entityType: "Announcement", entityId: "armaar_ann_tl_lift", action: "ANNOUNCEMENT_PUBLISHED", message: "published “Curtain wall lifts on Tower B this week”", by: "bci.pm", at: at(0, 8), projectId: TL });

  /* HSE and QA/QC (§20) ---------------------------------------------------------------- */
  await prisma.hseHazard.upsert({
    where: { id: "armaar_hse_hz_001" },
    update: {},
    create: { id: "armaar_hse_hz_001", companyId: companyId(BCI), projectId: TL, hazardNumber: "HZ-2026-0031", title: "Unprotected slab edge — Tower A level 11", description: "Edge protection removed for the formwork strike and not replaced.", hazardCategory: "WORK_AT_HEIGHT", likelihood: 3, severityScore: 5, riskScore: 15, riskLevel: "HIGH", status: "OPEN", observedAt: at(-1, 9), reportedByMemberId: m("arlis.hse-officer"), immediateControl: "Area barricaded; access restricted to the formwork crew.", createdByMemberId: m("arlis.hse-officer") },
  });
  await prisma.hseIncident.upsert({
    where: { id: "armaar_hse_inc_001" },
    update: {},
    create: { id: "armaar_hse_inc_001", companyId: companyId(BCI), projectId: TL, incidentNumber: "INC-2026-0007", incidentType: "NEAR_MISS", title: "Dropped tie bar from Tower B level 4", description: "A tie bar fell into the exclusion zone during the curtain wall lift. Nobody was below.", occurredAt: at(-4, 11), reportedAt: at(-4, 12), severity: "MEDIUM", status: "OPEN", reportedByMemberId: m("arlis.site-supervisor"), createdByMemberId: m("arlis.hse-officer") },
  });
  act({ id: "hse_hazard", module: "hse", entityType: "HseHazard", entityId: "armaar_hse_hz_001", action: "HSE_HAZARD_REPORTED", message: "reported a work-at-height hazard on Tower A level 11", by: "arlis.hse-officer", at: at(-1, 9), projectId: TL });
  await prisma.qualityInspection.upsert({
    where: { id: "armaar_qa_ins_001" },
    update: {},
    create: { id: "armaar_qa_ins_001", companyId: companyId(BCI), projectId: TL, inspectionNumber: "INS-2026-0112", inspectionType: "GENERAL", assignedInspectorMemberId: m("arlis.qaqc-engineer"), status: "CLOSED", result: "PASS", summary: "Tower A level 10 slab: reinforcement, cover and embedded items as drawn.", createdByMemberId: m("arlis.qaqc-engineer") },
  });
  await prisma.nonConformanceReport.upsert({
    where: { id: "armaar_qa_ncr_001" },
    update: { ncrNumber: "NCR-2026-0014" },
    create: { id: "armaar_qa_ncr_001", companyId: companyId(BCI), projectId: TL, ncrNumber: "NCR-2026-0014", title: "Insufficient cover at the slab edge, Tower A level 9", description: "Cover measured at 18 mm against 30 mm specified on grid line 4.", category: "OTHER", severity: "MEDIUM", status: "OPEN", createdByMemberId: m("arlis.qaqc-engineer") },
  });

  /* People joining (§62: "employee added") ------------------------------------------------ */
  act({ id: "employee_added", module: "hr", entityType: "EmployeeProfile", entityId: "employee_armaar_bci_sales_agent2", action: "HR_EMPLOYEE_CREATED", message: "added Eros Shehaj as Sales Agent", by: "bci.hr", at: at(-9, 10) });
  act({ id: "milestone_reached", module: "projects", entityType: "ProjectMilestone", entityId: "armaar_ms_tirana_lake_08", action: "MILESTONE_COMPLETED", message: "completed Tower B Topped Out", by: "bci.pm", at: at(-14, 16), projectId: TL });

  await prisma.activity.createMany({ data: activity, skipDuplicates: true });

  return { suppliers: SUPPLIERS.reduce((sum, row) => sum + row.companies.length, 0), contractors: CONTRACTORS.length, tasks: TASKS.length, meetings: MEETINGS.length, documents: DOCUMENTS.length };
}
