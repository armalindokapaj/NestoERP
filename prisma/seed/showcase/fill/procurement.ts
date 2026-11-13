/**
 * Buying for the sites: each company's suppliers (two of them the group's own,
 * Arvela Betoni for concrete and Arvela Pajisje for cranes), its
 * subcontractors with their papers, the supply agreements and subcontracts
 * (with their variations), and every project's purchasing at every stage —
 * a draft request, one waiting for approval, an RFQ with quotes in, orders
 * issued and part-delivered, others received and closed — with the finance
 * commitment each approved order opens.
 */
import type { ContractStatus, PrismaClient, ProcurementCategory, PurchaseOrderStatus, PurchaseRequestStatus } from "@prisma/client";

import { normalizeContractorName } from "../../../../lib/modules/contractors/contractor.names";
import { normalizeSupplierName } from "../../../../lib/modules/procurement/suppliers/supplier.service";
import { at, businessDay, castOf, dec, EUR, Numbers, random, round2, type Cast, type Clock } from "./kit";

const VAT = 0.2;

type Item = { description: string; unit: string; price: number; quantity: number; category: ProcurementCategory };
type PackageKey = keyof typeof PACKAGES;

/** What sites buy, at Albanian prices, for a project of about 30,000 m²; quantities scale with the project. */
const PACKAGES = {
  rebar: { title: "Reinforcement steel B500C", supplier: "steel", items: [{ description: "Rebar Ø12 B500C", unit: "t", price: 715, quantity: 85, category: "MATERIALS" }, { description: "Rebar Ø16 B500C", unit: "t", price: 705, quantity: 120, category: "MATERIALS" }, { description: "Rebar Ø20 B500C", unit: "t", price: 700, quantity: 60, category: "MATERIALS" }, { description: "Tie wire 1.2 mm", unit: "kg", price: 1.9, quantity: 1800, category: "MATERIALS" }] },
  concrete: { title: "Ready-mix concrete", supplier: "concrete", items: [{ description: "Concrete C30/37, delivered", unit: "m³", price: 78, quantity: 1400, category: "MATERIALS" }, { description: "Concrete C35/45, delivered", unit: "m³", price: 86, quantity: 600, category: "MATERIALS" }, { description: "Concrete pump with operator", unit: "h", price: 95, quantity: 160, category: "EQUIPMENT" }] },
  formwork: { title: "Formwork plywood and props", supplier: "formwork", items: [{ description: "Film-faced plywood 18 mm", unit: "sheet", price: 38, quantity: 900, category: "MATERIALS" }, { description: "Steel props 3.5 m, rental", unit: "pcs·month", price: 2.4, quantity: 4200, category: "EQUIPMENT" }, { description: "Timber beams H20", unit: "m", price: 6.8, quantity: 2400, category: "MATERIALS" }] },
  crane: { title: "Tower crane rental", supplier: "crane", items: [{ description: "Tower crane 8 t, rental", unit: "month", price: 6800, quantity: 10, category: "EQUIPMENT" }, { description: "Crane operator", unit: "month", price: 2200, quantity: 10, category: "SERVICES" }, { description: "Erection and dismantling", unit: "lot", price: 9500, quantity: 1, category: "SERVICES" }] },
  blocks: { title: "Clay blocks and mortar", supplier: "blocks", items: [{ description: "Hollow clay block 25 cm", unit: "pcs", price: 0.62, quantity: 140000, category: "MATERIALS" }, { description: "Masonry mortar M10", unit: "bag", price: 4.2, quantity: 6000, category: "MATERIALS" }] },
  waterproofing: { title: "Waterproofing membranes", supplier: "waterproofing", items: [{ description: "Bituminous membrane SBS 4 mm", unit: "m²", price: 7.8, quantity: 6500, category: "MATERIALS" }, { description: "Bituminous primer", unit: "l", price: 3.5, quantity: 1200, category: "MATERIALS" }, { description: "Drainage board", unit: "m²", price: 4.6, quantity: 2800, category: "MATERIALS" }] },
  windows: { title: "Aluminium windows and doors", supplier: "windows", items: [{ description: "Thermal-break window, double glazed", unit: "pcs", price: 620, quantity: 380, category: "MATERIALS" }, { description: "Sliding balcony door", unit: "pcs", price: 1150, quantity: 140, category: "MATERIALS" }, { description: "Installation", unit: "pcs", price: 85, quantity: 520, category: "SUBCONTRACT" }] },
  electrical: { title: "Electrical cables and boards", supplier: "electrical", items: [{ description: "Cable NYM 3×2.5 mm²", unit: "m", price: 1.15, quantity: 26000, category: "MATERIALS" }, { description: "Cable NYM 5×6 mm²", unit: "m", price: 4.4, quantity: 4200, category: "MATERIALS" }, { description: "Distribution board, apartment", unit: "pcs", price: 480, quantity: 120, category: "MATERIALS" }] },
  ppe: { title: "PPE and site safety", supplier: "ppe", items: [{ description: "Safety helmet EN 397", unit: "pcs", price: 9, quantity: 150, category: "MATERIALS" }, { description: "Full-body harness", unit: "pcs", price: 68, quantity: 40, category: "MATERIALS" }, { description: "Hi-vis vest", unit: "pcs", price: 4.5, quantity: 200, category: "MATERIALS" }, { description: "Work gloves", unit: "pair", price: 2.8, quantity: 600, category: "MATERIALS" }] },
  tiles: { title: "Ceramic tiles and adhesive", supplier: "tiles", items: [{ description: "Porcelain floor tile 60×60", unit: "m²", price: 16, quantity: 7800, category: "MATERIALS" }, { description: "Wall tile 30×60", unit: "m²", price: 12, quantity: 5200, category: "MATERIALS" }, { description: "Tile adhesive C2TE", unit: "bag", price: 6.5, quantity: 3400, category: "MATERIALS" }] },
  diesel: { title: "Diesel for site plant", supplier: "fuel", items: [{ description: "Diesel, delivered to the site tank", unit: "l", price: 1.62, quantity: 24000, category: "MATERIALS" }] },
  containers: { title: "Site offices and welfare", supplier: "containers", items: [{ description: "Office container 6 m, rental", unit: "month", price: 450, quantity: 24, category: "EQUIPMENT" }, { description: "Welfare unit with WC, rental", unit: "month", price: 380, quantity: 18, category: "EQUIPMENT" }] },
  paint: { title: "Paints and plaster", supplier: "paint", items: [{ description: "Gypsum plaster, machine", unit: "bag", price: 7.2, quantity: 5200, category: "MATERIALS" }, { description: "Interior paint, white", unit: "l", price: 3.9, quantity: 9000, category: "MATERIALS" }] },
  steelFrame: { title: "Structural steel portal frames", supplier: "steelFrame", items: [{ description: "Portal frame steel S355, fabricated", unit: "t", price: 1650, quantity: 420, category: "MATERIALS" }, { description: "Roof purlins Z200", unit: "t", price: 1480, quantity: 95, category: "MATERIALS" }] },
} satisfies Record<string, { title: string; supplier: string; items: Item[] }>;

type SupplierSpec = { key: string; name: string; type: string; city: string; terms: number };

/** The group's suppliers; every company keeps its own record of the ones it uses. */
const SUPPLIERS: SupplierSpec[] = [
  { key: "steel", name: "Ferro Adriatik", type: "Steel stockist", city: "Durrës", terms: 45 },
  { key: "concrete", name: "Arvela Betoni", type: "Ready-mix concrete (group company)", city: "Fushë-Krujë", terms: 30 },
  { key: "formwork", name: "Kallëp Systems", type: "Formwork", city: "Tiranë", terms: 30 },
  { key: "crane", name: "Arvela Pajisje", type: "Plant hire (group company)", city: "Kashar", terms: 30 },
  { key: "blocks", name: "Tulla Shkumbin", type: "Clay blocks", city: "Elbasan", terms: 45 },
  { key: "waterproofing", name: "Mbrojtje Hidro", type: "Waterproofing", city: "Tiranë", terms: 30 },
  { key: "windows", name: "Profil Alu Durrës", type: "Aluminium joinery", city: "Durrës", terms: 60 },
  { key: "electrical", name: "Elektro Drini", type: "Electrical wholesale", city: "Shkodër", terms: 45 },
  { key: "ppe", name: "Siguria Pro", type: "PPE and safety", city: "Tiranë", terms: 15 },
  { key: "tiles", name: "Qeramika Iliria", type: "Tiles", city: "Vlorë", terms: 45 },
  { key: "fuel", name: "Karburant Veriu", type: "Fuel", city: "Vorë", terms: 15 },
  { key: "containers", name: "Kontejner Plus", type: "Site cabins", city: "Durrës", terms: 30 },
  { key: "paint", name: "Ngjyra Teuta", type: "Paints and plaster", city: "Tiranë", terms: 30 },
  { key: "steelFrame", name: "Struktura Metalike Lezha", type: "Steel fabrication", city: "Lezhë", terms: 60 },
];

/** Subcontractors: the trades a developer lets out whole. */
const SUBCONTRACTORS = [
  { key: "earthworks", name: "Gërmime Lumi", discipline: "CIVIL" as const, scope: "Excavation, shoring and the basement dig" },
  { key: "mep", name: "Instal Termo", discipline: "MECHANICAL" as const, scope: "Mechanical, plumbing and fire installations" },
  { key: "facade", name: "Fasada Glass", discipline: "FACADE" as const, scope: "Curtain wall, cladding and external joinery" },
  { key: "lifts", name: "Ashensor Tech", discipline: "MECHANICAL" as const, scope: "Supply and installation of lifts" },
  { key: "electrical", name: "Rrjeti Elektrik", discipline: "ELECTRICAL" as const, scope: "Electrical installations and low current" },
  { key: "landscape", name: "Gjelbërim Projekt", discipline: "LANDSCAPE" as const, scope: "Landscaping, paving and irrigation" },
];

type ProjectBuying = {
  projectId: string;
  companyId: string;
  /** Quantities against the ~30,000 m² the package sizes assume. */
  scale: number;
  /** Packages in the order the site needed them, oldest first. */
  packages: PackageKey[];
  /** Days from the reset the first package was raised. */
  from: number;
  subcontracts: Array<{ key: string; value: number; status: ContractStatus; start: number; variations?: Array<{ title: string; delta: number; status: "APPROVED" | "ACTIVE" | "PENDING_APPROVAL" | "DRAFT"; at: number }> }>;
  /** Framework supply agreements the orders are called off under. */
  agreements: Array<{ supplier: string; value: number; start: number }>;
};

const BUYING: ProjectBuying[] = [
  {
    projectId: "project_b", companyId: "company_demo_b", scale: 1.2, from: -280,
    packages: ["containers", "concrete", "rebar", "crane", "formwork", "waterproofing", "ppe", "diesel", "electrical", "windows"],
    subcontracts: [
      { key: "earthworks", value: 640000, status: "COMPLETED", start: -300 },
      { key: "mep", value: 2850000, status: "ACTIVE", start: -120, variations: [{ title: "Additional sprinkler zones on floors 9–11 (smaller suites)", delta: 46500, status: "ACTIVE", at: -40 }, { title: "Second fire-pump set", delta: 28800, status: "PENDING_APPROVAL", at: -4 }] },
      { key: "facade", value: 3420000, status: "SIGNED", start: -25 },
      { key: "lifts", value: 980000, status: "PENDING_APPROVAL", start: -6 },
    ],
    agreements: [{ supplier: "concrete", value: 420000, start: -270 }, { supplier: "steel", value: 520000, start: -260 }],
  },
  {
    projectId: "project_showcase_promenada", companyId: "company_demo_b", scale: 1.3, from: -520,
    packages: ["concrete", "rebar", "crane", "blocks", "waterproofing", "electrical", "windows", "ppe", "tiles", "paint"],
    subcontracts: [
      { key: "mep", value: 2140000, status: "ACTIVE", start: -300, variations: [{ title: "Seafront shops: separate metering", delta: 18200, status: "ACTIVE", at: -90 }] },
      { key: "facade", value: 1260000, status: "ACTIVE", start: -200 },
      { key: "lifts", value: 520000, status: "ACTIVE", start: -150 },
    ],
    agreements: [{ supplier: "concrete", value: 380000, start: -500 }],
  },
  {
    projectId: "project_c", companyId: "company_demo_c", scale: 1.0, from: -240,
    packages: ["containers", "diesel", "concrete", "rebar", "steelFrame", "crane", "ppe", "electrical"],
    subcontracts: [
      { key: "earthworks", value: 1180000, status: "ACTIVE", start: -230, variations: [{ title: "Rock excavation at the north yard", delta: 64000, status: "ACTIVE", at: -70 }, { title: "Extra stone column ground improvement", delta: 112000, status: "PENDING_APPROVAL", at: -3 }] },
      { key: "electrical", value: 690000, status: "SIGNED", start: -20 },
      { key: "landscape", value: 240000, status: "DRAFT", start: -2 },
    ],
    agreements: [{ supplier: "concrete", value: 300000, start: -230 }, { supplier: "fuel", value: 60000, start: -235 }],
  },
  {
    projectId: "project_d", companyId: "company_demo_d", scale: 0.95, from: -360,
    packages: ["concrete", "rebar", "crane", "formwork", "blocks", "waterproofing", "ppe", "electrical", "windows", "tiles"],
    subcontracts: [
      { key: "earthworks", value: 410000, status: "COMPLETED", start: -380 },
      { key: "mep", value: 1720000, status: "ACTIVE", start: -200 },
      { key: "facade", value: 1040000, status: "ACTIVE", start: -90, variations: [{ title: "Sea-facing balustrades upgraded to laminated glass", delta: 38600, status: "APPROVED", at: -20 }] },
      { key: "lifts", value: 460000, status: "IN_REVIEW", start: -8 },
    ],
    agreements: [{ supplier: "concrete", value: 260000, start: -350 }],
  },
  {
    projectId: "project_e", companyId: "company_demo_e", scale: 1.1, from: -280,
    packages: ["containers", "diesel", "concrete", "rebar", "crane", "formwork", "ppe", "waterproofing"],
    subcontracts: [
      { key: "earthworks", value: 720000, status: "COMPLETED", start: -290 },
      { key: "mep", value: 3100000, status: "SIGNED", start: -30 },
      { key: "landscape", value: 380000, status: "PENDING_APPROVAL", start: -5 },
    ],
    agreements: [{ supplier: "concrete", value: 340000, start: -270 }, { supplier: "steel", value: 410000, start: -250 }],
  },
];

/** How far each package has got, by its place in the list (oldest first). */
function stageOf(index: number, count: number): { request: PurchaseRequestStatus; order: PurchaseOrderStatus | null; rfq: "CLOSED" | "ISSUED" | null; delivered: number } {
  const fromEnd = count - 1 - index;
  if (fromEnd === 0) return { request: "DRAFT", order: null, rfq: null, delivered: 0 };
  if (fromEnd === 1) return { request: "PENDING_APPROVAL", order: null, rfq: null, delivered: 0 };
  if (fromEnd === 2) return { request: "IN_SOURCING", order: null, rfq: "ISSUED", delivered: 0 };
  if (fromEnd === 3) return { request: "ORDERED", order: "PENDING_APPROVAL", rfq: "CLOSED", delivered: 0 };
  if (fromEnd === 4) return { request: "ORDERED", order: "ISSUED", rfq: "CLOSED", delivered: 0 };
  if (fromEnd === 5) return { request: "PARTIALLY_ORDERED", order: "PARTIALLY_RECEIVED", rfq: "CLOSED", delivered: 0.55 };
  if (index === 0) return { request: "COMPLETED", order: "CLOSED", rfq: null, delivered: 1 };
  return { request: "COMPLETED", order: "RECEIVED", rfq: index % 2 === 0 ? "CLOSED" : null, delivered: 1 };
}

export type ReceiptLine = { goodsReceiptItemId: string; description: string; unit: string; quantity: number; category: ProcurementCategory };
export type DeliveredReceipt = { companyId: string; projectId: string; goodsReceiptId: string; receiptNumber: string; date: number; lines: ReceiptLine[] };

export async function seedShowcaseProcurement(prisma: PrismaClient, clock: Clock) {
  const numbers = new Numbers(prisma);
  const delivered: DeliveredReceipt[] = [];
  const totals = { suppliers: 0, subcontractors: 0, requests: 0, rfqs: 0, quotes: 0, orders: 0, receipts: 0, contracts: 0, variations: 0, commitments: 0 };

  for (const companyId of new Set(BUYING.map((row) => row.companyId))) {
    const cast = await castOf(prisma, companyId);
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, legalName: true, registrationNumber: true, address: true } });
    const rand = random(`procurement:${companyId}`);
    const projects = BUYING.filter((row) => row.companyId === companyId);
    const needed = new Set(projects.flatMap((row) => [...row.packages.map((key) => PACKAGES[key].supplier), ...row.agreements.map((agreement) => agreement.supplier)]));
    const suppliers = new Map<string, { id: string; name: string }>();
    for (const [index, spec] of SUPPLIERS.filter((row) => needed.has(row.key)).entries()) {
      const id = `sup_${companyId.slice(-1)}_${spec.key}`;
      await prisma.supplier.create({
        data: { id, companyId, code: `SUP-${String(index + 101)}`, name: spec.name, legalName: `${spec.name} sh.p.k.`, normalizedName: normalizeSupplierName(spec.name), supplierType: "COMPANY", email: `orders@${spec.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ë/g, "e").replace(/[^a-z]+/g, "")}.test`, phone: `+355 69 000 ${String(5100 + index + Number(companyId.charCodeAt(companyId.length - 1)) * 20).padStart(4, "0")}`, city: spec.city, country: "Albania", status: "ACTIVE", paymentTermsDays: spec.terms, defaultCurrency: EUR, notes: spec.type, createdByMemberId: cast.member("procurement"), createdAt: at(clock, -420) },
      });
      suppliers.set(spec.key, { id, name: spec.name });
      totals.suppliers += 1;
    }

    const contractors = await seedContractors(prisma, clock, cast, companyId, projects);
    totals.subcontractors += contractors.size;

    for (const project of projects) {
      // Supply agreements the orders call off.
      const agreementOf = new Map<string, string>();
      for (const agreement of project.agreements) {
        const supplier = suppliers.get(agreement.supplier)!;
        const id = await procurementContract(prisma, clock, numbers, cast, company, { projectId: project.projectId, type: "PURCHASE_AGREEMENT", title: `${PACKAGES[packageOfSupplier(agreement.supplier)].title} — supply agreement`, counterparty: supplier.name, partyRole: "COUNTERPARTY", value: agreement.value, start: agreement.start, status: "ACTIVE", expiry: agreement.start + 540 });
        agreementOf.set(agreement.supplier, id);
        totals.contracts += 1;
      }
      // Subcontracts, their variations, and the work packages they cover.
      for (const subcontract of project.subcontracts) {
        const contractor = contractors.get(subcontract.key)!;
        const id = await procurementContract(prisma, clock, numbers, cast, company, { projectId: project.projectId, type: "SUBCONTRACT", title: `${contractor.scope} — subcontract`, counterparty: contractor.name, partyRole: "SUBCONTRACTOR", value: subcontract.value, start: subcontract.start, status: subcontract.status, expiry: null });
        totals.contracts += 1;
        let value = subcontract.value;
        for (const [index, variation] of (subcontract.variations ?? []).entries()) {
          const live = variation.status === "ACTIVE" || variation.status === "APPROVED";
          await prisma.contractAmendment.create({
            data: { companyId, contractId: id, amendmentNumber: `VO-${String(index + 1).padStart(2, "0")}`, title: variation.title, summary: `Variation ${index + 1}: ${variation.title.toLowerCase()}.`, status: variation.status, valueDelta: dec(variation.delta), previousContractValue: dec(value), newContractValue: dec(value + variation.delta), effectiveDate: live ? businessDay(clock, variation.at + 3) : null, signedDate: variation.status === "ACTIVE" ? businessDay(clock, variation.at + 2) : null, activatedAt: variation.status === "ACTIVE" ? at(clock, variation.at + 3) : null, createdByMemberId: cast.member("legal"), createdAt: at(clock, variation.at) },
          });
          if (variation.status === "ACTIVE") {
            value += variation.delta;
            await prisma.contract.update({ where: { id }, data: { contractValue: dec(value) } });
          }
          if (variation.status === "PENDING_APPROVAL") {
            const amendment = await prisma.contractAmendment.findFirstOrThrow({ where: { contractId: id, amendmentNumber: `VO-${String(index + 1).padStart(2, "0")}` }, select: { id: true } });
            await prisma.contractApproval.create({ data: { companyId, recordType: "AMENDMENT", recordId: amendment.id, status: "PENDING", submittedByMemberId: cast.member("legal"), submittedAt: at(clock, variation.at) } });
          }
          totals.variations += 1;
        }
        if (["ACTIVE", "SIGNED", "COMPLETED"].includes(subcontract.status)) {
          await prisma.commitment.create({ data: { companyId, projectId: project.projectId, reference: (await prisma.contract.findUniqueOrThrow({ where: { id }, select: { contractNumber: true } })).contractNumber, description: `Subcontract — ${contractor.scope.toLowerCase()}`, counterpartyName: contractor.name, category: "SUBCONTRACTOR", currency: EUR, amount: dec(value), expectedDate: businessDay(clock, subcontract.start + 300), status: subcontract.status === "COMPLETED" ? "CLOSED" : "APPROVED", sourceModule: "contracts", sourceEntityType: "contract", sourceEntityId: id, createdByMemberId: cast.member("finance"), createdAt: at(clock, subcontract.start + 2) } });
          totals.commitments += 1;
        }
        const assignment = await prisma.projectContractorAssignment.create({
          data: { companyId, projectId: project.projectId, contractorId: contractor.id, status: subcontract.status === "COMPLETED" ? "COMPLETED" : ["ACTIVE", "SIGNED"].includes(subcontract.status) ? "ACTIVE" : "PLANNED", scopeSummary: contractor.scope, contractId: id, internalManagerMemberId: cast.member("pm"), primaryContractorContactId: contractor.contactId, startDate: businessDay(clock, subcontract.start + 10), endDate: businessDay(clock, subcontract.start + 400), createdByMemberId: cast.member("pm"), createdAt: at(clock, subcontract.start) },
        });
        const code = await numbers.take({ companyId, table: "work_packages", column: "code", prefix: "WP", year: at(clock, subcontract.start).getUTCFullYear() });
        const done = subcontract.status === "COMPLETED";
        await prisma.workPackage.create({
          data: { companyId, projectId: project.projectId, contractorId: contractor.id, projectContractorAssignmentId: assignment.id, code, name: contractor.scope, discipline: contractor.discipline, status: done ? "COMPLETED" : subcontract.status === "ACTIVE" ? (rand.chance(0.25) ? "AT_RISK" : "ACTIVE") : "PLANNED", contractId: id, responsibleMemberId: cast.member("pm"), plannedStartDate: businessDay(clock, subcontract.start + 10), plannedFinishDate: businessDay(clock, subcontract.start + 380), actualStartDate: subcontract.status === "ACTIVE" || done ? businessDay(clock, subcontract.start + 14) : null, actualFinishDate: done ? businessDay(clock, subcontract.start + 200) : null, completedAt: done ? at(clock, subcontract.start + 200) : null, completedByMemberId: done ? cast.member("pm") : null, value: dec(value), currency: EUR, createdByMemberId: cast.member("pm"), createdAt: at(clock, subcontract.start) },
        });
      }

      // The purchasing itself, package by package.
      for (const [index, key] of project.packages.entries()) {
        const spec = PACKAGES[key];
        const stage = stageOf(index, project.packages.length);
        // The open ones are this month's; the rest spread back to when buying started.
        const fromEnd = project.packages.length - 1 - index;
        const raised = fromEnd <= 4 ? -(fromEnd * 6 + 4) : Math.round(project.from + ((index + 0.5) * (-project.from - 40)) / (project.packages.length - 5));
        const supplier = suppliers.get(spec.supplier)!;
        const items = spec.items.map((item) => ({ ...item, quantity: Math.max(1, Math.round(item.quantity * project.scale * (0.85 + rand.next() * 0.3))) }));
        const estimated = round2(items.reduce((sum, item) => sum + item.quantity * item.price, 0));
        const prNumber = await numbers.take({ companyId, table: "purchase_requests", column: "requestNumber", prefix: "PR", year: at(clock, raised).getUTCFullYear() });
        const requestId = `pr_${companyId.slice(-1)}_${prNumber.toLowerCase().replace(/-/g, "_")}`;
        const approved = !["DRAFT", "PENDING_APPROVAL", "REJECTED"].includes(stage.request);
        await prisma.purchaseRequest.create({
          data: {
            id: requestId, companyId, projectId: project.projectId, requestNumber: prNumber, title: `${spec.title} — ${await projectName(prisma, project.projectId)}`, description: rand.pick(REQUEST_NOTES), currency: EUR, status: stage.request,
            priority: index === project.packages.length - 2 ? "HIGH" : rand.chance(0.2) ? "HIGH" : "MEDIUM", estimatedTotal: dec(estimated), requestedByMemberId: cast.member("pm"), ownerMemberId: cast.member("procurement"), requiredDate: businessDay(clock, raised + 21),
            submittedAt: stage.request === "DRAFT" ? null : at(clock, raised + 1), approvedAt: approved ? at(clock, raised + 3) : null, approvedByMemberId: approved ? cast.member("ceo") : null,
            createdByMemberId: cast.member("pm"), createdAt: at(clock, raised),
            items: { create: items.map((item, line) => ({ id: `${requestId}_i${line + 1}`, description: item.description, quantity: dec(item.quantity), unit: item.unit, estimatedUnitPrice: dec(item.price), estimatedAmount: dec(item.quantity * item.price), category: item.category, sortOrder: line + 1 })) },
          },
        });
        totals.requests += 1;
        if (stage.request === "PENDING_APPROVAL") await prisma.procurementApproval.create({ data: { companyId, recordType: "PURCHASE_REQUEST", recordId: requestId, status: "PENDING", submittedByMemberId: cast.member("pm"), submittedAt: at(clock, raised + 1) } });
        if (approved) await prisma.procurementApproval.create({ data: { companyId, recordType: "PURCHASE_REQUEST", recordId: requestId, status: "APPROVED", submittedByMemberId: cast.member("pm"), submittedAt: at(clock, raised + 1), decidedByMemberId: cast.member("ceo"), decidedAt: at(clock, raised + 3), decisionNote: "Within the project budget." } });

        // An RFQ to three suppliers for the bigger packages; quotes back from them.
        let quoteId: string | null = null;
        let rfqId: string | null = null;
        let quotePrices = items.map((item) => item.price);
        if (stage.rfq) {
          const rfqNumber = await numbers.take({ companyId, table: "rfqs", column: "rfqNumber", prefix: "RFQ", year: at(clock, raised + 4).getUTCFullYear() });
          rfqId = `rfq_${requestId}`;
          await prisma.rFQ.create({
            data: { id: rfqId, companyId, rfqNumber, title: `${spec.title} — request for quotation`, purchaseRequestId: requestId, projectId: project.projectId, currency: EUR, responseDueDate: businessDay(clock, raised + 14), status: stage.rfq, issuedAt: at(clock, raised + 4), closedAt: stage.rfq === "CLOSED" ? at(clock, raised + 15) : null, createdByMemberId: cast.member("procurement"), createdAt: at(clock, raised + 4), items: { create: items.map((item, line) => ({ id: `${rfqId}_i${line + 1}`, sourceRequestItemId: `${requestId}_i${line + 1}`, description: item.description, quantity: dec(item.quantity), unit: item.unit, sortOrder: line + 1 })) } },
          });
          totals.rfqs += 1;
          // The chosen supplier and two others the group knows.
          const others = [...suppliers.values()].filter((row) => row.id !== supplier.id).slice(index % 3, (index % 3) + 2);
          const invited = [supplier, ...others];
          for (const [position, bidder] of invited.entries()) {
            const responded = stage.rfq === "CLOSED" || position < 2;
            await prisma.rFQSupplier.create({ data: { rfqId, supplierId: bidder.id, status: responded ? "RESPONDED" : "INVITED", invitedAt: at(clock, raised + 4), respondedAt: responded ? at(clock, raised + 9 + position) : null } });
            if (!responded) continue;
            const factor = position === 0 ? 1 : 1 + (0.03 + rand.next() * 0.09);
            const prices = items.map((item) => round2(item.price * factor));
            const subtotal = round2(items.reduce((sum, item, line) => sum + item.quantity * prices[line]!, 0));
            const id = `${rfqId}_q${position + 1}`;
            await prisma.supplierQuote.create({
              data: {
                id, companyId, rfqId, supplierId: bidder.id, quoteNumber: `Q-${bidder.name.slice(0, 3).toUpperCase()}-${String(100 + index * 3 + position)}`, quoteDate: businessDay(clock, raised + 9 + position), validUntil: businessDay(clock, raised + 45), currency: EUR,
                subtotal: dec(subtotal), taxAmount: dec(subtotal * VAT), totalAmount: dec(subtotal * (1 + VAT)), leadTimeDays: rand.int(5, 30),
                status: stage.rfq === "CLOSED" ? (position === 0 ? "SELECTED" : "NOT_SELECTED") : "RECEIVED", notes: position === 0 ? "Price held for 45 days; delivery in two lots." : null, createdByMemberId: cast.member("procurement"), createdAt: at(clock, raised + 9 + position),
                items: { create: items.map((item, line) => ({ rfqItemId: `${rfqId}_i${line + 1}`, quantity: dec(item.quantity), unitPrice: dec(prices[line]!), taxRate: dec(VAT), subtotal: dec(item.quantity * prices[line]!), taxAmount: dec(item.quantity * prices[line]! * VAT), totalAmount: dec(item.quantity * prices[line]! * (1 + VAT)) })) },
              },
            });
            totals.quotes += 1;
            if (position === 0) {
              quoteId = id;
              quotePrices = prices;
            }
          }
        }
        if (!stage.order) continue;

        // The order, approved by the CEO, and the commitment it opens.
        const ordered = raised + (stage.rfq ? 17 : 5);
        const poNumber = await numbers.take({ companyId, table: "purchase_orders", column: "poNumber", prefix: "PO", year: at(clock, ordered).getUTCFullYear() });
        const orderId = `po_${companyId.slice(-1)}_${poNumber.toLowerCase().replace(/-/g, "_")}`;
        const subtotal = round2(items.reduce((sum, item, line) => sum + item.quantity * quotePrices[line]!, 0));
        const total = round2(subtotal * (1 + VAT));
        const orderApproved = stage.order !== "PENDING_APPROVAL";
        await prisma.purchaseOrder.create({
          data: {
            id: orderId, companyId, poNumber, supplierId: supplier.id, purchaseRequestId: requestId, rfqId, supplierQuoteId: quoteId, projectId: project.projectId, contractId: agreementOf.get(spec.supplier) ?? null,
            orderDate: businessDay(clock, ordered), requiredDate: businessDay(clock, ordered + 20), currency: EUR, subtotal: dec(subtotal), taxAmount: dec(subtotal * VAT), totalAmount: dec(total), status: stage.order,
            submittedAt: at(clock, ordered), approvedAt: orderApproved ? at(clock, ordered + 1) : null, approvedByMemberId: orderApproved ? cast.member("ceo") : null,
            issuedAt: orderApproved && stage.order !== "APPROVED" ? at(clock, ordered + 1) : null, closedAt: stage.order === "CLOSED" ? at(clock, ordered + 60) : null,
            notes: agreementOf.has(spec.supplier) ? "Called off under the supply agreement." : null, createdByMemberId: cast.member("procurement"), createdAt: at(clock, ordered),
            items: { create: items.map((item, line) => ({ id: `${orderId}_i${line + 1}`, sourceRequestItemId: `${requestId}_i${line + 1}`, sourceQuoteItemId: null, description: item.description, quantity: dec(item.quantity), unit: item.unit, unitPrice: dec(quotePrices[line]!), taxRate: dec(VAT), subtotal: dec(item.quantity * quotePrices[line]!), taxAmount: dec(item.quantity * quotePrices[line]! * VAT), totalAmount: dec(item.quantity * quotePrices[line]! * (1 + VAT)), sortOrder: line + 1 })) },
          },
        });
        totals.orders += 1;
        await prisma.procurementApproval.create({ data: { companyId, recordType: "PURCHASE_ORDER", recordId: orderId, status: orderApproved ? "APPROVED" : "PENDING", submittedByMemberId: cast.member("procurement"), submittedAt: at(clock, ordered), decidedByMemberId: orderApproved ? cast.member("ceo") : null, decidedAt: orderApproved ? at(clock, ordered + 1) : null } });
        if (orderApproved) {
          const commitment = await prisma.commitment.create({ data: { companyId, projectId: project.projectId, reference: poNumber, description: `Purchase order ${poNumber}`, counterpartyName: supplier.name, category: "MATERIALS", currency: EUR, amount: dec(total), expectedDate: businessDay(clock, ordered + 20), status: stage.order === "CLOSED" ? "CLOSED" : "APPROVED", sourceModule: "procurement", sourceEntityType: "purchase_order", sourceEntityId: orderId, createdByMemberId: cast.member("procurement"), createdAt: at(clock, ordered + 1) }, select: { id: true } });
          await prisma.purchaseOrder.update({ where: { id: orderId }, data: { financeCommitmentId: commitment.id } });
          totals.commitments += 1;
        }

        // Deliveries: two lots for most, the second short where the order is part-received.
        if (stage.delivered === 0) continue;
        const lots = stage.delivered === 1 ? [0.6, 0.4] : [stage.delivered];
        for (const [lot, share] of lots.entries()) {
          const when = Math.min(-2, ordered + 8 + lot * 14);
          const receiptNumber = await numbers.take({ companyId, table: "goods_receipts", column: "receiptNumber", prefix: "GR", year: at(clock, when).getUTCFullYear() });
          const receiptId = `gr_${orderId}_${lot + 1}`;
          const rejectSome = lot === 0 && rand.chance(0.2);
          const lines = items.map((item, line) => {
            const received = round2(item.quantity * share);
            const rejected = rejectSome && line === 0 ? round2(received * 0.04) : 0;
            return { id: `${receiptId}_i${line + 1}`, purchaseOrderItemId: `${orderId}_i${line + 1}`, receivedQuantity: dec(received), acceptedQuantity: dec(received - rejected), rejectedQuantity: dec(rejected), notes: rejected > 0 ? "Bent bars rejected at the gate; supplier to replace." : null, item, accepted: received - rejected };
          });
          await prisma.goodsReceipt.create({
            data: { id: receiptId, companyId, receiptNumber, purchaseOrderId: orderId, projectId: project.projectId, supplierId: supplier.id, receiptDate: businessDay(clock, when), deliveryReference: `DN-${String(4000 + index * 10 + lot)}`, status: "RECORDED", receivedByMemberId: cast.member("inventory"), createdByMemberId: cast.member("inventory"), createdAt: at(clock, when), items: { create: lines.map((line) => ({ id: line.id, purchaseOrderItemId: line.purchaseOrderItemId, receivedQuantity: line.receivedQuantity, acceptedQuantity: line.acceptedQuantity, rejectedQuantity: line.rejectedQuantity, notes: line.notes })) } },
          });
          totals.receipts += 1;
          delivered.push({ companyId, projectId: project.projectId, goodsReceiptId: receiptId, receiptNumber, date: when, lines: lines.map((line) => ({ goodsReceiptItemId: line.id, description: line.item.description, unit: line.item.unit, quantity: line.accepted, category: line.item.category })) });
        }
      }
    }
  }
  return { ...totals, delivered };
}

function packageOfSupplier(supplier: string): PackageKey {
  return (Object.keys(PACKAGES) as PackageKey[]).find((key) => PACKAGES[key].supplier === supplier)!;
}

const names = new Map<string, string>();
async function projectName(prisma: PrismaClient, projectId: string) {
  if (!names.has(projectId)) names.set(projectId, (await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } })).name);
  return names.get(projectId)!;
}

type Contractor = { id: string; name: string; scope: string; discipline: (typeof SUBCONTRACTORS)[number]["discipline"]; contactId: string };

/** The company's subcontractors with a contact and their papers: insurance, a performance guarantee, HSE certification. */
async function seedContractors(prisma: PrismaClient, clock: Clock, cast: Cast, companyId: string, projects: ProjectBuying[]): Promise<Map<string, Contractor>> {
  const keys = new Set(projects.flatMap((project) => project.subcontracts.map((row) => row.key)));
  const result = new Map<string, Contractor>();
  const rand = random(`contractors:${companyId}`);
  for (const spec of SUBCONTRACTORS.filter((row) => keys.has(row.key))) {
    const id = `ctr_${companyId.slice(-1)}_${spec.key}`;
    const email = `office@${spec.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ë/g, "e").replace(/[^a-z]+/g, "")}.test`;
    const person = rand.pick(["Arben Topalli", "Elona Ndreu", "Gëzim Kuqi", "Mirela Tafaj", "Saimir Duka", "Vjosa Gjoka"]);
    await prisma.contractorProfile.create({
      data: { id, companyId, legalName: `${spec.name} sh.p.k.`, tradingName: spec.name, normalizedName: normalizeContractorName(`${spec.name} sh.p.k.`), email, phone: `+355 69 000 ${String(6000 + result.size * 7 + companyId.charCodeAt(companyId.length - 1)).padStart(4, "0")}`, city: rand.pick(["Tiranë", "Durrës", "Vlorë"]), countryCode: "AL", status: "ACTIVE", statusChangedAt: at(clock, -400), primaryContactName: person, primaryContactEmail: email.replace("office@", `${person.split(" ")[0]!.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ë/g, "e")}@`), notes: spec.scope, createdByMemberId: cast.member("procurement"), createdAt: at(clock, -420) },
    });
    const contact = await prisma.contractorContact.create({ data: { companyId, contractorId: id, name: person, roleTitle: "Project Manager", contactRole: "PROJECT_MANAGER", email: email.replace("office@", "pm@"), phone: `+355 69 000 ${String(6500 + result.size).padStart(4, "0")}`, active: true }, select: { id: true } });
    const expiring = rand.chance(0.3);
    await prisma.contractorComplianceItem.createMany({
      data: [
        { companyId, contractorId: id, type: "INSURANCE", title: "Contractor's all-risk insurance", status: "VALID", issuedAt: at(clock, -200), expiresAt: at(clock, 165), issuer: "Sigurime Adriatik", referenceNumber: `CAR-${2026}-${String(400 + result.size)}`, statusChangedAt: at(clock, -200), createdByMemberId: cast.member("procurement") },
        { companyId, contractorId: id, type: "PERFORMANCE_GUARANTEE", title: "Performance guarantee, 10%", status: expiring ? "EXPIRING" : "VALID", issuedAt: at(clock, -330), expiresAt: at(clock, expiring ? 18 : 220), issuer: "Banka e Bashkuar", referenceNumber: `PG-${String(8800 + result.size)}`, statusChangedAt: at(clock, expiring ? -5 : -330), createdByMemberId: cast.member("procurement") },
        { companyId, contractorId: id, type: "HSE_CERTIFICATION", title: "ISO 45001 certificate", status: "VALID", issuedAt: at(clock, -500), expiresAt: at(clock, 590), issuer: "Certifikim Ballkan", statusChangedAt: at(clock, -500), createdByMemberId: cast.member("hse") },
      ],
    });
    result.set(spec.key, { id, name: spec.name, scope: spec.scope, discipline: spec.discipline, contactId: contact.id });
  }
  return result;
}

/** A supply agreement or subcontract, with both parties and its obligations. */
async function procurementContract(
  prisma: PrismaClient,
  clock: Clock,
  numbers: Numbers,
  cast: Cast,
  company: { name: string; legalName: string | null; registrationNumber: string | null; address: string | null },
  input: { projectId: string; type: "PURCHASE_AGREEMENT" | "SUBCONTRACT"; title: string; counterparty: string; partyRole: "COUNTERPARTY" | "SUBCONTRACTOR"; value: number; start: number; status: ContractStatus; expiry: number | null },
): Promise<string> {
  const companyId = cast.companyId;
  const number = await numbers.take({ companyId, table: "contracts", column: "contractNumber", prefix: "CTR", year: at(clock, input.start).getUTCFullYear() });
  const id = `contract_${number.toLowerCase().replace(/-/g, "_")}_${companyId.slice(-1)}`;
  const signed = ["SIGNED", "ACTIVE", "COMPLETED"].includes(input.status);
  await prisma.contract.create({
    data: {
      id, companyId, contractNumber: number, title: input.title, contractType: input.type, projectId: input.projectId, ownerMemberId: cast.member("legal"), status: input.status,
      counterpartyName: `${input.counterparty} sh.p.k.`, currency: EUR, contractValue: dec(input.value), governingLaw: "Albania", jurisdiction: "Tirana District Court",
      sentAt: signed || input.status === "SENT" ? at(clock, input.start - 2) : null, signedDate: signed ? businessDay(clock, input.start) : null, effectiveDate: signed ? businessDay(clock, input.start + 1) : null,
      expiryDate: input.expiry === null ? null : businessDay(clock, input.expiry), completedAt: input.status === "COMPLETED" ? at(clock, input.start + 200) : null, completedByMemberId: input.status === "COMPLETED" ? cast.member("legal") : null,
      summary: input.type === "SUBCONTRACT" ? "Lump-sum subcontract with 5% retention, released at the end of the defects period." : "Framework prices for the project; the site calls off quantities by purchase order.",
      commercialNotes: input.type === "SUBCONTRACT" ? "Monthly valuations; payment 45 days after certification." : null,
      createdByMemberId: cast.member("legal"), createdAt: at(clock, input.start - 10),
    },
  });
  await prisma.contractParty.createMany({
    data: [
      { companyId, contractId: id, partyRole: "OUR_COMPANY", partyType: "COMPANY", name: company.name, legalName: company.legalName, registrationNumber: company.registrationNumber, address: company.address, country: "Albania", signatoryName: cast.name("ceo"), signatoryTitle: "Administrator", isPrimaryCounterparty: false },
      { companyId, contractId: id, partyRole: input.partyRole, partyType: "COMPANY", name: input.counterparty, legalName: `${input.counterparty} sh.p.k.`, country: "Albania", signatoryName: "Administrator", isPrimaryCounterparty: true },
    ],
  });
  if (signed) {
    const done = input.status === "COMPLETED";
    await prisma.contractObligation.createMany({
      data:
        input.type === "SUBCONTRACT"
          ? [
              { companyId, contractId: id, title: "Performance guarantee lodged", obligationType: "DOCUMENT", responsibleMemberId: cast.member("legal"), dueDate: businessDay(clock, input.start + 14), status: "COMPLETED", completedAt: at(clock, input.start + 10), createdByMemberId: cast.member("legal") },
              { companyId, contractId: id, title: "Monthly progress report and valuation", obligationType: "DELIVERABLE", responsibleMemberId: cast.member("pm"), dueDate: businessDay(clock, done ? input.start + 180 : 12), status: done ? "COMPLETED" : "OPEN", completedAt: done ? at(clock, input.start + 180) : null, createdByMemberId: cast.member("legal") },
              { companyId, contractId: id, title: "Release of retention", obligationType: "PAYMENT", responsibleMemberId: cast.member("finance"), dueDate: businessDay(clock, input.start + 565), status: "OPEN", createdByMemberId: cast.member("legal") },
            ]
          : [
              { companyId, contractId: id, title: "Mill certificates with every delivery", obligationType: "COMPLIANCE", responsibleMemberId: cast.member("qaqc"), status: "OPEN", createdByMemberId: cast.member("legal") },
              { companyId, contractId: id, title: "Price review", obligationType: "RENEWAL", responsibleMemberId: cast.member("procurement"), dueDate: businessDay(clock, input.start + 180), status: input.start + 180 < 0 ? "COMPLETED" : "OPEN", completedAt: input.start + 180 < 0 ? at(clock, input.start + 182) : null, createdByMemberId: cast.member("legal") },
            ],
    });
  }
  if (input.status === "PENDING_APPROVAL") {
    await prisma.contractApproval.create({ data: { companyId, recordType: "CONTRACT", recordId: id, status: "PENDING", submittedByMemberId: cast.member("legal"), submittedAt: at(clock, input.start) } });
  }
  if (signed) {
    await prisma.contractApproval.create({ data: { companyId, recordType: "CONTRACT", recordId: id, status: "APPROVED", submittedByMemberId: cast.member("legal"), submittedAt: at(clock, input.start - 5), decidedByMemberId: cast.member("ceo"), decidedAt: at(clock, input.start - 3), decisionNote: "Approved; within budget." } });
  }
  return id;
}

const REQUEST_NOTES = [
  "For the next pours on the programme; delivery to the site gate.",
  "Quantities from the latest bill of quantities, with 5% waste.",
  "Needed before the structure reaches the next level.",
  "Replaces stock used faster than planned last month.",
  "As specified by the engineer; samples approved by QA/QC.",
];

