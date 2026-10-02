/**
 * ARMAAR's money and supply chain, lived in (D-04 enrichment, finance & supply).
 *
 * D-01 and D-02 gave every screen of Finance, Procurement and Inventory one
 * example of each state. This file gives the working companies six months of
 * ordinary business behind them and three months ahead:
 *
 *   clients        a few commercial counterparties for the companies that had none
 *   invoices       tenants, operators and power buyers invoiced monthly: paid,
 *                  paid in two parts, part-paid, overdue, not yet due, drafts,
 *                  waiting, approved, sent back and cancelled — each paid one
 *                  through a receipt allocated to it
 *   expenses       site costs, fees and services in every state, the approved
 *                  ones mostly paid by a disbursement allocated to them
 *   commitments    undertakings entered by hand, in every state
 *   budgets        a second revision of four budgets: waiting, draft, sent back
 *   suppliers      more of the group register (SUP-021 onwards), and existing
 *                  suppliers opened in more companies under the same code
 *   buying         request → approval → order → delivery chains in every state;
 *                  each approved order has its commitment and integration link
 *   stock          new stores and items, opening balances, receipts from the
 *                  deliveries above, transfers, issues to site and counts —
 *                  the ledger and the balances agree, and some items end at or
 *                  below their reorder point across the company's stores
 *
 * Numbers continue each company's series in the product's shape: a number is
 * taken (highest + 1) only when its record is first written. Every value is
 * synthetic. Stable ids (`armaar_d04_…`); a rerun adds nothing.
 */
import { Prisma, type ExpenseStatus, type FinanceCostCategory, type InventoryItemCategory, type PrismaClient, type ProcurementCategory, type PurchaseOrderStatus, type PurchaseRequestStatus, type StockAdjustmentReason, type StockMovementType } from "@prisma/client";

import { buildIdempotencyKey, IntegrationType } from "../../../lib/core/integrations/integration.registry";
import { addLocalDays, localDate } from "../../../lib/modules/calendar/calendar.time";
import { rebuildBalances } from "../inventory";
import { memberId } from "./access";
import { supplierId } from "./operations";
import { companyId } from "./organization";
import { userId } from "./people";
import { projectId } from "./projects";
import type { CompanyCode, ProjectCode } from "./public-facts";
import { ARMAAR_GROUP_ID } from "./records";

const ZONE = "Europe/Tirane";
const EUR = "EUR";
const P = "armaar_d04_";
const BCI = "BUILDING_CONSTRUCTION_INVEST" as const;
const ALN = "ARLIS_NDERTIM" as const;
const IDEAL = "IDEAL_CONSTRUCTION" as const;
const UNICO = "UNICO_CONSTRUCTION" as const;
const SMI = "SARANDA_MARINA_INVEST" as const;
const ARSOL = "ARSOL_ENERGY" as const;
const WORKING: CompanyCode[] = [BCI, ALN, IDEAL, UNICO, SMI, ARSOL];
const SLUG: Partial<Record<CompanyCode, string>> = { [BCI]: "bci", [ALN]: "aln", [IDEAL]: "ideal", [UNICO]: "unico", [SMI]: "smi", [ARSOL]: "arsol" };
const CLIENT_PREFIX: Partial<Record<CompanyCode, string>> = { [IDEAL]: "IDC", [UNICO]: "UNC", [SMI]: "SMI", [ARSOL]: "ASE" };

const money = (value: number) => new Prisma.Decimal(value.toFixed(2));
const qty = (value: number) => new Prisma.Decimal(value.toFixed(4));
const round2 = (value: number) => Math.round(value * 100) / 100;
const normalizeSupplier = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Who keeps the books, and who approves them, in each company (as finance.ts). */
const KEEPER: Partial<Record<CompanyCode, string>> = { [BCI]: "bci.finance-specialist", [ALN]: "arlis.accountant", [IDEAL]: "ideal.finance", [UNICO]: "unico.finance", [SMI]: "smi.finance", [ARSOL]: "arsol.finance" };
const FIN_APPROVER: Partial<Record<CompanyCode, string>> = { [BCI]: "bci.finance", [ALN]: "arlis.finance", [IDEAL]: "ideal.director", [UNICO]: "unico.director", [SMI]: "smi.director", [ARSOL]: "arsol.director" };
/** Who buys, approves, asks and receives (as supply.ts). */
const BUYER: Partial<Record<CompanyCode, string>> = { [BCI]: "bci.procurement", [ALN]: "arlis.procurement", [IDEAL]: "ideal.procurement", [ARSOL]: "arsol.procurement", [SMI]: "armaar.procurement", [UNICO]: "armaar.procurement" };
const PROC_APPROVER: Partial<Record<CompanyCode, string>> = { [BCI]: "bci.director", [ALN]: "arlis.director", [IDEAL]: "ideal.director", [ARSOL]: "arsol.director", [SMI]: "smi.director", [UNICO]: "unico.director" };
const REQUESTERS: Partial<Record<CompanyCode, string[]>> = { [BCI]: ["bci.pm", "bci.engineering", "arlis.site-engineer", "arlis.mep", "bci.architect"], [ALN]: ["arlis.pm-lead", "arlis.pm", "arlis.site-engineer", "arlis.hse"], [IDEAL]: ["ideal.pm", "ideal.site-engineer", "ideal.engineering"], [UNICO]: ["unico.coordinator", "unico.engineering", "unico.structural"], [SMI]: ["smi.pm", "smi.architect"], [ARSOL]: ["arsol.pm", "arsol.electrical", "arsol.engineering"] };
const STOREKEEPER = (code: CompanyCode) => (code === BCI || code === ALN ? "arlis.inventory" : "armaar.inventory");
const PROJECTS: Partial<Record<CompanyCode, Array<ProjectCode | null>>> = { [BCI]: ["TIRANA_LAKE"], [ALN]: [null], [IDEAL]: ["EYES_OF_TIRANA"], [UNICO]: ["UNITED_TOWERS"], [SMI]: ["CLEARWATER_BEACH"], [ARSOL]: [null] };
const PROJECT_NAME: Partial<Record<ProjectCode, string>> = { TIRANA_LAKE: "Tirana Lake", EYES_OF_TIRANA: "Eyes of Tirana", UNITED_TOWERS: "United Towers", CLEARWATER_BEACH: "Clearwater Beach", SQUARE_21: "Square 21" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A small deterministic generator: the same content on every run. */
export function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)), pick: <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]! };
}

/** Each company's series: highest existing `PREFIX-2026-NNNN` + 1, taken only for a record being created. */
export function series(rows: Array<{ companyId: string; number: string | null }>, prefix: string) {
  const pattern = new RegExp(`^${prefix}-2026-(\\d+)$`);
  const high = new Map<string, number>();
  for (const row of rows) {
    const match = row.number?.match(pattern);
    if (match) high.set(row.companyId, Math.max(high.get(row.companyId) ?? 0, Number(match[1])));
  }
  return (company: string) => {
    const next = (high.get(company) ?? 0) + 1;
    high.set(company, next);
    return `${prefix}-2026-${String(next).padStart(4, "0")}`;
  };
}

/* Clients ------------------------------------------------------------------ */
const CLIENTS: Array<{ key: string; company: CompanyCode; name: string }> = [
  { key: "ideal_retail", company: IDEAL, name: "Eyes of Tirana Retail Partners sh.p.k." },
  { key: "ideal_offices", company: IDEAL, name: "Blloku Office Tenants sh.p.k." },
  { key: "unico_hospitality", company: UNICO, name: "Demo Hospitality Group" },
  { key: "unico_offices", company: UNICO, name: "Tirana Office Holdings sh.p.k." },
  { key: "smi_villas", company: SMI, name: "Riviera Villas Club sh.p.k." },
  { key: "smi_resorts", company: SMI, name: "Saranda Beach Resorts sh.p.k." },
  { key: "smi_yachts", company: SMI, name: "Ionian Yacht Services sh.p.k." },
  { key: "arsol_retail_park", company: ARSOL, name: "Demo Retail Park sh.p.k." },
  { key: "arsol_logistics", company: ARSOL, name: "Durrës Logistics Hub sh.p.k." },
  { key: "arsol_cold_store", company: ARSOL, name: "Elbasan Agro Cold Store sh.p.k." },
];
const clientId = (key: string) => `${P}client_${key}`;
const INVOICE_CLIENTS: Partial<Record<CompanyCode, string[]>> = {
  [BCI]: ["armaar_client_liqeni_retail_sh_p_k", "armaar_client_vista_office_partners_sh_p_k", "armaar_client_nord_coffee_co_sh_p_k", "armaar_client_metro_dental_clinics_sh_p_k", "armaar_client_blu_fitness_sh_p_k", "armaar_client_adria_pharma_stores_sh_p_k"],
  [ALN]: ["armaar_client_aln_liqeni_retail_sh_p_k", "armaar_client_aln_vista_office_partners_sh_p_k", "armaar_client_aln_adria_pharma_stores_sh_p_k", "armaar_client_aln_nord_coffee_co_sh_p_k"],
  [IDEAL]: [clientId("ideal_retail"), clientId("ideal_offices")],
  [UNICO]: [clientId("unico_hospitality"), clientId("unico_offices")],
  [SMI]: [clientId("smi_villas"), clientId("smi_resorts"), clientId("smi_yachts")],
  [ARSOL]: [clientId("arsol_retail_park"), clientId("arsol_logistics"), clientId("arsol_cold_store")],
};
/** What each company invoices for: [description, quantity, unit price] lines; `{m}` is the month, `{p}` the project. */
const INVOICE_THEMES: Partial<Record<CompanyCode, Array<Array<[string, number, number]>>>> = {
  [BCI]: [
    [["Service charge — podium retail, {m}", 1, 2_850], ["Common-area electricity recharge — {m}", 1, 640]],
    [["Tenant fit-out contribution — shell and core works", 1, 18_400]],
    [["Early access licence — tenant fit-out period", 1, 4_200], ["Temporary water and power — {m}", 1, 380]],
    [["Parking licence — basement B1, {m}", 12, 95]],
    [["Tenant works recharge — sprinkler drop relocation", 1, 3_150], ["Out-of-hours security during tenant works", 16, 22]],
  ],
  [ALN]: [
    [["Service charge — {p}, {m}", 1, 1_950]],
    [["Parking licence — {p}, {m}", 8, 80]],
    [["Defects recharge — tenant damage to the shopfront", 1, 2_300]],
    [["Signage installation for tenant — {p}", 1, 1_480], ["Access control cards", 20, 12]],
  ],
  [IDEAL]: [
    [["Pre-let reservation fee — ground-floor retail, Eyes of Tirana", 1, 25_000]],
    [["Design coordination services to the incoming tenant — {m}", 1, 6_800]],
    [["Marketing suite hire — {m}", 1, 2_400]],
  ],
  [UNICO]: [
    [["Pre-opening design services — hotel floors, {m}", 1, 14_500]],
    [["Office pre-let reservation fee — levels 18 to 20", 1, 30_000]],
    [["Technical due-diligence report for the operator", 1, 8_900], ["Site visits and coordination", 6, 450]],
  ],
  [SMI]: [
    [["Villa management fee — {m}", 6, 1_150]],
    [["Beach concession rent — {m}", 1, 7_600]],
    [["Marina berth services — {m}", 14, 310]],
    [["Pre-opening consultancy recharge — {p}", 1, 9_200]],
  ],
  [ARSOL]: [
    [["Energy supplied — {m} 2026, rooftop batch 1 (MWh)", 148, 96.5]],
    [["Energy supplied — {m} 2026 (MWh)", 62, 101], ["Metering and O&M charge — {m}", 1, 420]],
    [["O&M services — quarterly inverter inspection", 1, 3_600]],
  ],
};
type InvoiceScenario = "PAID" | "PAID_EARLY" | "PAID_TWO" | "PARTLY" | "OVERDUE" | "NOT_DUE" | "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
const INVOICE_SCENARIOS: InvoiceScenario[] = ["PAID", "NOT_DUE", "OVERDUE", "PARTLY", "PAID", "DRAFT", "PAID_TWO", "PENDING", "OVERDUE", "PAID_EARLY", "REJECTED", "APPROVED", "PAID", "CANCELLED"];
const INVOICE_REJECTIONS = ["Wrong client entity — invoice the operating company, not the holding.", "Rate does not match the signed heads of terms; reissue at the agreed rate.", "Split the recharge by unit before sending.", "Missing the tenant's purchase order number."];

/* Expenses ------------------------------------------------------------------ */
const EXPENSE_THEMES: Partial<Record<CompanyCode, Array<{ description: string; payee: string; category: FinanceCostCategory; net: [number, number] }>>> = {
  [BCI]: [
    { description: "Site security — {m}", payee: "Demo Security Services sh.p.k.", category: "SERVICES", net: [9_200, 10_400] },
    { description: "Tower crane TC-2 operator overtime — {m}", payee: "Demo Plant Hire sh.p.k.", category: "EQUIPMENT", net: [3_100, 5_600] },
    { description: "Temporary site power — {m}", payee: "OSHEE Distribution", category: "ADMINISTRATION", net: [4_800, 7_900] },
    { description: "Façade consultant site visits — {m}", payee: "Demo Façade Engineering sh.p.k.", category: "SERVICES", net: [2_400, 3_800] },
    { description: "Show apartment cleaning and staging — {m}", payee: "Demo Facility Services sh.p.k.", category: "SERVICES", net: [900, 1_600] },
    { description: "Travel — supplier factory visit, Italy", payee: "Demo Travel sh.p.k.", category: "TRAVEL", net: [1_800, 2_600] },
  ],
  [ALN]: [
    { description: "Skip hire and waste removal — {p}, {m}", payee: "Demo Waste Services sh.p.k.", category: "SERVICES", net: [1_900, 3_200] },
    { description: "Concrete testing laboratory — {m}", payee: "Demo Materials Laboratory sh.p.k.", category: "SERVICES", net: [2_600, 3_700] },
    { description: "Agency labour — finishing crew, {p}", payee: "Demo Workforce Solutions sh.p.k.", category: "LABOR", net: [6_400, 11_800] },
    { description: "Mobile crane hire — {p}", payee: "Demo Plant Hire sh.p.k.", category: "EQUIPMENT", net: [2_200, 4_100] },
    { description: "Municipal occupation permit — scaffold on the pavement, {p}", payee: "Tirana Municipality", category: "ADMINISTRATION", net: [700, 1_400] },
  ],
  [IDEAL]: [
    { description: "Topographic survey — Eyes of Tirana plot", payee: "Demo Survey Partners sh.p.k.", category: "SERVICES", net: [3_400, 4_900] },
    { description: "Legal fees — land registration, {m}", payee: "Demo Law Partners", category: "ADMINISTRATION", net: [2_000, 3_500] },
    { description: "Hoarding graphics printing", payee: "Demo Print Studio sh.p.k.", category: "OTHER", net: [1_200, 2_100] },
    { description: "Utility diversion design", payee: "Demo Grid Consultants sh.p.k.", category: "SERVICES", net: [5_800, 8_400] },
  ],
  [UNICO]: [
    { description: "Wind-tunnel study — United Towers", payee: "Demo Wind Engineering Ltd", category: "SERVICES", net: [18_000, 26_000] },
    { description: "Planning consultant — {m}", payee: "Demo Urban Planning sh.p.k.", category: "SERVICES", net: [3_200, 4_800] },
    { description: "BIM software licences — {m}", payee: "Demo Software Reseller sh.p.k.", category: "ADMINISTRATION", net: [1_400, 2_100] },
    { description: "Model-making — tower massing model", payee: "Demo Model Studio sh.p.k.", category: "OTHER", net: [2_600, 3_900] },
  ],
  [SMI]: [
    { description: "Environmental impact assessment — {p}", payee: "Demo Environmental Consultants sh.p.k.", category: "SERVICES", net: [9_000, 14_500] },
    { description: "Coastal permit fees — {p}", payee: "National Territory Planning Agency", category: "ADMINISTRATION", net: [3_500, 6_000] },
    { description: "Travel — operator design review, Madrid", payee: "Demo Travel sh.p.k.", category: "TRAVEL", net: [1_600, 2_400] },
    { description: "Site security — {p}, {m}", payee: "Demo Security Services sh.p.k.", category: "SERVICES", net: [4_200, 5_600] },
  ],
  [ARSOL]: [
    { description: "Grid connection study — rooftop batch {n}", payee: "Demo Grid Consultants sh.p.k.", category: "SERVICES", net: [5_500, 8_000] },
    { description: "Roof structural assessments — batch {n}", payee: "Demo Engineering Consultants sh.p.k.", category: "SERVICES", net: [2_800, 4_600] },
    { description: "Monitoring platform subscription — {m}", payee: "Demo Solar Monitoring Ltd", category: "ADMINISTRATION", net: [450, 700] },
    { description: "Van lease — O&M team, {m}", payee: "Demo Fleet Leasing sh.p.k.", category: "EQUIPMENT", net: [780, 950] },
  ],
};
type ExpenseScenario = "PAID" | "PART_PAID" | "UNPAID" | "PENDING" | "DRAFT" | "REJECTED" | "CANCELLED";
const EXPENSE_SCENARIOS: ExpenseScenario[] = ["PAID", "PENDING", "PAID", "UNPAID", "DRAFT", "PAID", "REJECTED", "PART_PAID", "PAID", "CANCELLED"];
const EXPENSE_REJECTIONS = ["Charge it to the subcontractor under their package.", "No purchase order behind this; raise one first.", "Duplicate of an expense already paid last month.", "Attach the signed timesheets before resubmitting."];

/* Suppliers and what they sell -------------------------------------------- */
const NEW_SUPPLIERS: Array<{ key: string; code: string; name: string; taxId: string; category: string; city: string; companies: CompanyCode[] }> = [
  { key: "devoll_aggregates", code: "SUP-021", name: "Devoll Aggregates sh.p.k.", taxId: "X90000021W", category: "Sand, gravel and aggregates", city: "Maliq", companies: [ALN, IDEAL, UNICO] },
  { key: "shkodra_bricks", code: "SUP-022", name: "Shkodra Bricks & Blocks sh.p.k.", taxId: "X90000022X", category: "Clay and AAC blocks", city: "Shkodër", companies: [BCI, ALN, IDEAL] },
  { key: "kastrati_fuel", code: "SUP-023", name: "Kastrati Fuel & Lubricants sh.p.k.", taxId: "X90000023Y", category: "Diesel and lubricants", city: "Tirana", companies: [BCI, ALN, SMI] },
  { key: "tirana_scaffold", code: "SUP-024", name: "Tirana Scaffolding Rentals sh.p.k.", taxId: "X90000024Z", category: "Scaffold and hoarding hire", city: "Tirana", companies: [BCI, ALN, UNICO] },
  { key: "illyria_paints", code: "SUP-025", name: "Illyria Paints sh.p.k.", taxId: "X90000025A", category: "Paints and coatings", city: "Durrës", companies: [BCI, ALN] },
  { key: "adriatic_insulation", code: "SUP-026", name: "Adriatic Insulation Systems sh.p.k.", taxId: "X90000026B", category: "Thermal insulation", city: "Durrës", companies: [BCI, SMI] },
  { key: "vlora_marine", code: "SUP-027", name: "Vlora Marine Works sh.p.k.", taxId: "X90000027C", category: "Marine works and surveys", city: "Vlorë", companies: [SMI] },
  { key: "butrint_stone", code: "SUP-028", name: "Butrint Stone Quarry sh.p.k.", taxId: "X90000028D", category: "Natural stone", city: "Sarandë", companies: [SMI] },
  { key: "energji_inverter", code: "SUP-029", name: "Energji Inverter Solutions sh.p.k.", taxId: "X90000029E", category: "Inverters and power electronics", city: "Tirana", companies: [ARSOL] },
  { key: "balkan_alu", code: "SUP-030", name: "Balkan Aluminium Profiles sh.p.k.", taxId: "X90000030F", category: "Aluminium window and façade profiles", city: "Elbasan", companies: [BCI, IDEAL] },
  { key: "office_point", code: "SUP-031", name: "Office Point Albania sh.p.k.", taxId: "X90000031G", category: "Office supplies and consumables", city: "Tirana", companies: [BCI, ALN, UNICO, ARSOL] },
  { key: "elbasan_precast", code: "SUP-032", name: "Elbasan Precast sh.p.k.", taxId: "X90000032H", category: "Precast concrete elements", city: "Elbasan", companies: [ALN, UNICO] },
];
/** Suppliers of the register opened in more companies, under their register code. */
const MORE_COMPANIES: Array<{ key: string; code: string; name: string; taxId: string | null; category: string; companies: CompanyCode[] }> = [
  { key: "tirana_readymix", code: "SUP-003", name: "Tirana Ready-Mix sh.p.k.", taxId: null, category: "Ready-mixed concrete", companies: [IDEAL, UNICO, SMI] },
  { key: "adriatik_steel", code: "SUP-002", name: "Adriatik Steel sh.p.k.", taxId: null, category: "Reinforcing steel", companies: [IDEAL, UNICO, SMI] },
  { key: "safework", code: "SUP-017", name: "SafeWork Albania sh.p.k.", taxId: "X90000017S", category: "PPE and site safety equipment", companies: [BCI, UNICO, SMI, ARSOL] },
  { key: "elektronord", code: "SUP-005", name: "ElektroNord sh.p.k.", taxId: null, category: "Electrical works and materials", companies: [ALN, IDEAL] },
];

type Buy = { supplier: string; title: string; description: string; category: ProcurementCategory; unit: string; quantity: [number, number]; price: number; item?: string };
const CATALOG: Partial<Record<CompanyCode, Buy[]>> = {
  [BCI]: [
    { supplier: "shkodra_bricks", title: "AAC blocks — Tower B partitions, batch {n}", description: "AAC block 600×200×100, pallets of 60", category: "MATERIALS", unit: "pallet", quantity: [40, 90], price: 210, item: "blocks" },
    { supplier: "illyria_paints", title: "Interior paint — Tower A apartments, batch {n}", description: "Interior emulsion, white, 15 L", category: "MATERIALS", unit: "pail", quantity: [150, 320], price: 38, item: "paint" },
    { supplier: "adriatic_insulation", title: "XPS insulation — podium terraces", description: "XPS insulation board 50 mm", category: "MATERIALS", unit: "m²", quantity: [800, 1_800], price: 11.5, item: "xps" },
    { supplier: "kastrati_fuel", title: "Diesel for site plant — {m}", description: "Diesel, delivered to the site tank", category: "MATERIALS", unit: "L", quantity: [6_000, 12_000], price: 1.62, item: "diesel" },
    { supplier: "tirana_scaffold", title: "Scaffold hire — Tower B east elevation", description: "System scaffold hire, erected and inspected", category: "SERVICES", unit: "month", quantity: [3, 6], price: 7_800 },
    { supplier: "balkan_alu", title: "Aluminium window profiles — Tower B levels 7 to 12", description: "Thermally broken window profiles, 70 mm system", category: "MATERIALS", unit: "m", quantity: [1_200, 2_600], price: 24 },
    { supplier: "adria_tiles", title: "Tile adhesive and grout — Tower A, batch {n}", description: "Flexible tile adhesive C2TE, 25 kg", category: "MATERIALS", unit: "bag", quantity: [500, 1_100], price: 9.8, item: "adhesive" },
    { supplier: "safework", title: "Cut-resistant gloves — steel fixers", description: "Cut-resistant gloves, level C", category: "EQUIPMENT", unit: "pair", quantity: [300, 700], price: 6.4, item: "gloves" },
    { supplier: "office_point", title: "Site office consumables — {m}", description: "Paper, toner, plotter rolls and stationery", category: "OFFICE", unit: "lot", quantity: [1, 1], price: 2_400 },
    { supplier: "elektronord", title: "PVC conduit — Tower B first fix, batch {n}", description: "PVC conduit 20 mm with boxes", category: "MATERIALS", unit: "m", quantity: [4_000, 8_000], price: 0.85, item: "conduit" },
  ],
  [ALN]: [
    { supplier: "devoll_aggregates", title: "Washed sand 0/4 — {p}", description: "Washed sand 0/4, delivered", category: "MATERIALS", unit: "t", quantity: [200, 500], price: 14, item: "sand" },
    { supplier: "adriatik_steel", title: "Rebar B500C — {p}, level {n} slab", description: "Reinforcing steel B500C, 10–25 mm, cut and bent", category: "MATERIALS", unit: "t", quantity: [30, 80], price: 720, item: "rebar" },
    { supplier: "shkodra_bricks", title: "Clay blocks — {p} external walls", description: "Clay block 25 cm, pallets", category: "MATERIALS", unit: "pallet", quantity: [60, 130], price: 185, item: "blocks" },
    { supplier: "korca_timber", title: "Formwork plywood 18 mm — {p}", description: "Film-faced plywood 18 mm", category: "MATERIALS", unit: "sheet", quantity: [200, 500], price: 32, item: "plywood" },
    { supplier: "kastrati_fuel", title: "Diesel for site plant — {p}, {m}", description: "Diesel, delivered to the site tank", category: "MATERIALS", unit: "L", quantity: [4_000, 8_000], price: 1.62, item: "diesel" },
    { supplier: "elbasan_precast", title: "Precast stair flights — {p}", description: "Precast stair flight, 14 risers", category: "MATERIALS", unit: "each", quantity: [8, 20], price: 1_450 },
    { supplier: "tirana_scaffold", title: "Scaffold hire — {p}", description: "System scaffold hire, erected and inspected", category: "SERVICES", unit: "month", quantity: [2, 5], price: 5_200 },
    { supplier: "devoll_aggregates", title: "Gravel 4/16 — {p}", description: "Gravel 4/16, delivered", category: "MATERIALS", unit: "t", quantity: [200, 450], price: 16, item: "gravel" },
    { supplier: "adriatik_steel", title: "Tie wire — {p}", description: "Tie wire 1.2 mm, 25 kg coil", category: "MATERIALS", unit: "coil", quantity: [40, 100], price: 38, item: "wire" },
    { supplier: "illyria_paints", title: "Façade paint — {p}", description: "Silicone façade paint, 15 L", category: "MATERIALS", unit: "pail", quantity: [120, 280], price: 46 },
  ],
  [IDEAL]: [
    { supplier: "korca_timber", title: "Site hoarding panels — Eyes of Tirana", description: "Timber hoarding panels 2.4 m with posts", category: "MATERIALS", unit: "m", quantity: [180, 300], price: 42, item: "hoarding" },
    { supplier: "safework", title: "PPE for the early-works crew", description: "PPE kit: hard hat, harness, gloves, hi-vis", category: "EQUIPMENT", unit: "set", quantity: [30, 60], price: 82, item: "ppe" },
    { supplier: "tirana_readymix", title: "Blinding concrete — piling platform", description: "Concrete C12/15 blinding", category: "MATERIALS", unit: "m³", quantity: [60, 140], price: 78 },
    { supplier: "albabuild", title: "Demolition of the existing structures", description: "Demolition and clearance, including asbestos survey", category: "SUBCONTRACT", unit: "lot", quantity: [1, 1], price: 148_000 },
    { supplier: "adriatik_steel", title: "Pile cage reinforcement — test piles", description: "Reinforcing steel B500C, pile cages", category: "MATERIALS", unit: "t", quantity: [12, 30], price: 735 },
    { supplier: "elektronord", title: "Temporary site power — Eyes of Tirana", description: "Temporary supply, distribution boards and lighting", category: "SERVICES", unit: "lot", quantity: [1, 1], price: 18_500 },
  ],
  [UNICO]: [
    { supplier: "geotest", title: "Additional boreholes — tower 2 footprint", description: "Two boreholes to 50 m with laboratory testing", category: "SERVICES", unit: "lot", quantity: [1, 1], price: 21_500 },
    { supplier: "tirana_scaffold", title: "Hoarding and gantry — United Towers", description: "Hoarding and pedestrian gantry hire", category: "SERVICES", unit: "month", quantity: [3, 8], price: 4_100 },
    { supplier: "devoll_aggregates", title: "Piling platform aggregate, batch {n}", description: "Crushed aggregate 0/63", category: "MATERIALS", unit: "t", quantity: [800, 1_500], price: 12, item: "aggregate" },
    { supplier: "tirana_readymix", title: "Concrete C35/45 — test piles", description: "Concrete C35/45, pumped", category: "MATERIALS", unit: "m³", quantity: [120, 240], price: 86 },
    { supplier: "adriatik_steel", title: "Rebar — pile cages, phase {n}", description: "Reinforcing steel B500C, pile cages", category: "MATERIALS", unit: "t", quantity: [60, 120], price: 725, item: "rebar" },
    { supplier: "elbasan_precast", title: "Precast kerbs and drainage channels", description: "Precast kerbs and channels", category: "MATERIALS", unit: "m", quantity: [300, 650], price: 28 },
    { supplier: "office_point", title: "Design office supplies and plotter consumables", description: "Plotter rolls, ink and stationery", category: "OFFICE", unit: "lot", quantity: [1, 1], price: 3_100 },
    { supplier: "safework", title: "PPE — United Towers enabling works", description: "PPE kit: hard hat, harness, gloves, hi-vis", category: "EQUIPMENT", unit: "set", quantity: [40, 80], price: 80, item: "ppe" },
  ],
  [SMI]: [
    { supplier: "butrint_stone", title: "Limestone cladding — hotel block, batch {n}", description: "Limestone cladding 30 mm, honed", category: "MATERIALS", unit: "m²", quantity: [400, 1_000], price: 68, item: "stone" },
    { supplier: "vlora_marine", title: "Marine survey — Clearwater Beach seabed", description: "Bathymetric survey and seabed sampling", category: "SERVICES", unit: "lot", quantity: [1, 1], price: 42_000 },
    { supplier: "adriatic_insulation", title: "Roof insulation — villas cluster A", description: "PIR roof insulation 100 mm", category: "MATERIALS", unit: "m²", quantity: [600, 1_400], price: 14 },
    { supplier: "liftech", title: "Lift protection and maintenance during construction", description: "Monthly maintenance of the builders' lifts", category: "SERVICES", unit: "month", quantity: [6, 12], price: 850 },
    { supplier: "kastrati_fuel", title: "Diesel for the {p} site plant, {m}", description: "Diesel, delivered to the site tank", category: "MATERIALS", unit: "L", quantity: [5_000, 9_000], price: 1.64, item: "diesel" },
    { supplier: "tirana_readymix", title: "Concrete C30/37 — villas foundations", description: "Concrete C30/37, pumped", category: "MATERIALS", unit: "m³", quantity: [180, 380], price: 88 },
    { supplier: "safework", title: "PPE — {p} crews", description: "PPE kit: hard hat, harness, gloves, hi-vis", category: "EQUIPMENT", unit: "set", quantity: [40, 80], price: 81, item: "ppe" },
    { supplier: "adriatik_steel", title: "Rebar — hotel block podium, batch {n}", description: "Reinforcing steel B500C", category: "MATERIALS", unit: "t", quantity: [40, 90], price: 740, item: "rebar" },
  ],
  [ARSOL]: [
    { supplier: "solartech", title: "PV modules 550 Wp — rooftop batch {n}", description: "Monocrystalline PV modules 550 Wp", category: "EQUIPMENT", unit: "each", quantity: [600, 1_500], price: 112, item: "pv" },
    { supplier: "energji_inverter", title: "String inverters 50 kW — rooftop batch {n}", description: "Three-phase string inverter 50 kW", category: "EQUIPMENT", unit: "each", quantity: [8, 24], price: 3_900, item: "inverter" },
    { supplier: "balkan_cable", title: "Solar DC cable 6 mm² — batch {n}", description: "Solar DC cable 6 mm², red and black", category: "MATERIALS", unit: "m", quantity: [8_000, 18_000], price: 0.92, item: "solarcable" },
    { supplier: "balkan_cable", title: "MC4 connectors — batch {n}", description: "MC4 connector pairs", category: "MATERIALS", unit: "pair", quantity: [800, 1_800], price: 2.1, item: "mc4" },
    { supplier: "elektronord", title: "Grid connection works — Durrës logistics hub", description: "MV connection, transformer bay and protection", category: "SUBCONTRACT", unit: "lot", quantity: [1, 1], price: 64_000 },
    { supplier: "office_point", title: "Office supplies — {m}", description: "Stationery and consumables", category: "OFFICE", unit: "lot", quantity: [1, 1], price: 950 },
    { supplier: "safework", title: "Roof-work harness kits", description: "Harness, lanyard and roof anchor kit", category: "EQUIPMENT", unit: "set", quantity: [20, 40], price: 145 },
  ],
};

type ChainState = "DRAFT" | "PENDING" | "REJECTED" | "CANCELLED" | "APPROVED" | "PO_PENDING" | "PO_APPROVED" | "PO_ISSUED" | "PO_PARTIAL" | "PO_RECEIVED" | "PO_CLOSED";
const CHAIN_STATES: ChainState[] = ["PO_RECEIVED", "PENDING", "PO_ISSUED", "DRAFT", "PO_CLOSED", "REJECTED", "PO_PARTIAL", "APPROVED", "PO_APPROVED", "PO_PENDING", "CANCELLED", "PO_RECEIVED"];
const PR_REJECTIONS = ["Over the package budget; re-quote with two alternatives.", "Already covered by the framework call-off; use that instead.", "Quantities do not match the take-off; revise and resubmit.", "Specification not yet approved by the design team."];
const APPROVED_ORDER: PurchaseOrderStatus[] = ["APPROVED", "ISSUED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"];

/* Stores and items ---------------------------------------------------------- */
const STORES: Array<{ id: string; company: CompanyCode; code: string; name: string; type: "CENTRAL" | "PROJECT_SITE"; project: ProjectCode | null; city: string; locations: string[] }> = [
  { id: `${P}wh_aln_central`, company: ALN, code: "WH-01", name: "Central yard — Kashar", type: "CENTRAL", project: null, city: "Tirana", locations: ["MAIN", "YARD"] },
  { id: `${P}wh_ideal_central`, company: IDEAL, code: "WH-01", name: "Central store — Tirana", type: "CENTRAL", project: null, city: "Tirana", locations: ["MAIN"] },
  { id: `${P}wh_unico_ut`, company: UNICO, code: "WH-UT", name: "United Towers — site store", type: "PROJECT_SITE", project: "UNITED_TOWERS", city: "Tirana", locations: ["MAIN", "YARD"] },
  { id: `${P}wh_arsol_central`, company: ARSOL, code: "WH-01", name: "Central store — Durrës", type: "CENTRAL", project: null, city: "Durrës", locations: ["MAIN", "YARD"] },
];
const loc = (warehouse: string, code: string) => `${warehouse}_${code.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
const BCI_CENTRAL = "armaar_wh_bci_central";
const BCI_TL = "armaar_wh_bci_tl";
const ALN_TC = "armaar_wh_aln_tc";

type Item = { key: string; company: CompanyCode; sku: string; name: string; category: InventoryItemCategory; unit: string; minimum: number; reorder: number; opening: number; openAt: string; site: string; low?: true; project: ProjectCode | null };
const ITEMS: Item[] = [
  { key: "blocks", company: BCI, sku: "BLK-AAC10", name: "AAC block 600×200×100, pallet of 60", category: "MATERIAL", unit: "pallet", minimum: 10, reorder: 25, opening: 60, openAt: loc(BCI_CENTRAL, "YARD"), site: loc(BCI_TL, "YARD"), project: "TIRANA_LAKE" },
  { key: "paint", company: BCI, sku: "PNT-INT15", name: "Interior emulsion, white, 15 L", category: "MATERIAL", unit: "pail", minimum: 40, reorder: 80, opening: 300, openAt: loc(BCI_CENTRAL, "MAIN"), site: loc(BCI_TL, "MAIN"), low: true, project: "TIRANA_LAKE" },
  { key: "xps", company: BCI, sku: "INS-XPS50", name: "XPS insulation board 50 mm", category: "MATERIAL", unit: "m²", minimum: 150, reorder: 300, opening: 1_200, openAt: loc(BCI_CENTRAL, "YARD"), site: loc(BCI_TL, "YARD"), project: "TIRANA_LAKE" },
  { key: "diesel", company: BCI, sku: "FUL-DSL", name: "Diesel fuel — site tank", category: "CONSUMABLE", unit: "L", minimum: 1_500, reorder: 3_000, opening: 8_000, openAt: loc(BCI_TL, "YARD"), site: loc(BCI_TL, "YARD"), project: "TIRANA_LAKE" },
  { key: "adhesive", company: BCI, sku: "ADH-C2TE", name: "Flexible tile adhesive C2TE, 25 kg", category: "MATERIAL", unit: "bag", minimum: 80, reorder: 160, opening: 500, openAt: loc(BCI_CENTRAL, "MAIN"), site: loc(BCI_TL, "CONT-2"), low: true, project: "TIRANA_LAKE" },
  { key: "gloves", company: BCI, sku: "PPE-GLVC", name: "Cut-resistant gloves, level C", category: "CONSUMABLE", unit: "pair", minimum: 60, reorder: 120, opening: 400, openAt: loc(BCI_CENTRAL, "MAIN"), site: loc(BCI_TL, "CONT-2"), low: true, project: "TIRANA_LAKE" },
  { key: "conduit", company: BCI, sku: "CND-PVC20", name: "PVC conduit 20 mm", category: "MATERIAL", unit: "m", minimum: 800, reorder: 1_500, opening: 6_000, openAt: loc(BCI_CENTRAL, "MAIN"), site: loc(BCI_TL, "MAIN"), project: "TIRANA_LAKE" },
  { key: "ppe", company: IDEAL, sku: "PPE-KIT", name: "PPE kit — hard hat, harness, gloves, hi-vis", category: "CONSUMABLE", unit: "set", minimum: 10, reorder: 20, opening: 40, openAt: loc(`${P}wh_ideal_central`, "MAIN"), site: loc(`${P}wh_ideal_central`, "MAIN"), low: true, project: "EYES_OF_TIRANA" },
  { key: "signage", company: IDEAL, sku: "SGN-SET", name: "Site safety signage set", category: "CONSUMABLE", unit: "set", minimum: 5, reorder: 10, opening: 30, openAt: loc(`${P}wh_ideal_central`, "MAIN"), site: loc(`${P}wh_ideal_central`, "MAIN"), project: "EYES_OF_TIRANA" },
  { key: "hoarding", company: IDEAL, sku: "HRD-240", name: "Hoarding panel 2.4 m", category: "MATERIAL", unit: "m", minimum: 20, reorder: 40, opening: 150, openAt: loc(`${P}wh_ideal_central`, "MAIN"), site: loc(`${P}wh_ideal_central`, "MAIN"), project: "EYES_OF_TIRANA" },
  { key: "aggregate", company: UNICO, sku: "AGG-063", name: "Crushed aggregate 0/63", category: "MATERIAL", unit: "t", minimum: 100, reorder: 200, opening: 400, openAt: loc(`${P}wh_unico_ut`, "YARD"), site: loc(`${P}wh_unico_ut`, "YARD"), project: "UNITED_TOWERS" },
  { key: "rebar", company: UNICO, sku: "REB-B500C", name: "Reinforcing steel B500C, pile cages", category: "MATERIAL", unit: "t", minimum: 10, reorder: 20, opening: 30, openAt: loc(`${P}wh_unico_ut`, "YARD"), site: loc(`${P}wh_unico_ut`, "YARD"), project: "UNITED_TOWERS" },
  { key: "ppe", company: UNICO, sku: "PPE-KIT", name: "PPE kit — hard hat, harness, gloves, hi-vis", category: "CONSUMABLE", unit: "set", minimum: 15, reorder: 30, opening: 60, openAt: loc(`${P}wh_unico_ut`, "MAIN"), site: loc(`${P}wh_unico_ut`, "MAIN"), low: true, project: "UNITED_TOWERS" },
  { key: "pegs", company: UNICO, sku: "SRV-PEG", name: "Survey pegs and marker paint, box", category: "CONSUMABLE", unit: "box", minimum: 5, reorder: 10, opening: 40, openAt: loc(`${P}wh_unico_ut`, "MAIN"), site: loc(`${P}wh_unico_ut`, "MAIN"), project: "UNITED_TOWERS" },
  { key: "pv", company: ARSOL, sku: "PV-550", name: "PV module 550 Wp, monocrystalline", category: "EQUIPMENT", unit: "each", minimum: 100, reorder: 200, opening: 400, openAt: loc(`${P}wh_arsol_central`, "MAIN"), site: loc(`${P}wh_arsol_central`, "MAIN"), project: null },
  { key: "inverter", company: ARSOL, sku: "INV-50K", name: "String inverter 50 kW", category: "EQUIPMENT", unit: "each", minimum: 4, reorder: 8, opening: 12, openAt: loc(`${P}wh_arsol_central`, "MAIN"), site: loc(`${P}wh_arsol_central`, "MAIN"), low: true, project: null },
  { key: "solarcable", company: ARSOL, sku: "CAB-SOL6", name: "Solar DC cable 6 mm²", category: "MATERIAL", unit: "m", minimum: 2_000, reorder: 4_000, opening: 10_000, openAt: loc(`${P}wh_arsol_central`, "MAIN"), site: loc(`${P}wh_arsol_central`, "MAIN"), project: null },
  { key: "mc4", company: ARSOL, sku: "CON-MC4", name: "MC4 connector pair", category: "CONSUMABLE", unit: "pair", minimum: 200, reorder: 400, opening: 1_500, openAt: loc(`${P}wh_arsol_central`, "MAIN"), site: loc(`${P}wh_arsol_central`, "MAIN"), project: null },
  { key: "rails", company: ARSOL, sku: "MNT-RAIL42", name: "Mounting rail, aluminium, 4.2 m", category: "MATERIAL", unit: "each", minimum: 150, reorder: 300, opening: 900, openAt: loc(`${P}wh_arsol_central`, "YARD"), site: loc(`${P}wh_arsol_central`, "YARD"), project: null },
];
const itemId = (company: CompanyCode, key: string) => `${P}item_${SLUG[company]}_${key}`;
const warehouseOf = (location: string) => [...STORES.map((store) => store.id), BCI_CENTRAL, BCI_TL, ALN_TC].find((id) => location.startsWith(`${id}_`))!;
const ISSUE_TO: Partial<Record<CompanyCode, string[]>> = { [BCI]: ["arlis.site-supervisor", "arlis.site-engineer", "arlis.mep"], [ALN]: ["arlis.pm-lead", "arlis.site-engineer", "arlis.hse"], [IDEAL]: ["ideal.site-engineer", "ideal.pm"], [UNICO]: ["unico.coordinator", "unico.engineering"], [SMI]: ["smi.pm"], [ARSOL]: ["arsol.electrical", "arsol.pm"] };
const SIGN: Record<StockMovementType, 1 | -1> = { RECEIPT: 1, RETURN_TO_STOCK: 1, TRANSFER_IN: 1, ADJUSTMENT_IN: 1, ISSUE: -1, TRANSFER_OUT: -1, ADJUSTMENT_OUT: -1, REVERSAL: 1 };

export async function seedArmaarEnrichFinance(prisma: PrismaClient) {
  const today = localDate(new Date(), ZONE);
  const day = (offset: number) => new Date(`${addLocalDays(today, offset)}T12:00:00.000Z`);
  const at = (offset: number, hour = 10) => new Date(`${addLocalDays(today, offset)}T${String(hour).padStart(2, "0")}:00:00.000Z`);
  const monthOf = (offset: number) => MONTHS[Number(addLocalDays(today, offset).slice(5, 7)) - 1]!;
  const fill = (text: string, values: { m?: string; p?: string; n?: number }) => text.replace("{m}", values.m ?? "").replace("{p}", values.p ?? "").replace("{n}", String(values.n ?? 1));
  const m = (username: string, code: CompanyCode) => memberId(username, code);
  const inGroup = { company: { parentGroupId: ARMAAR_GROUP_ID } };

  /* Clients ------------------------------------------------------------------ */
  for (const client of CLIENTS) {
    const slug = client.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 20);
    await prisma.client.upsert({
      where: { id: clientId(client.key) },
      update: {},
      create: { id: clientId(client.key), companyId: companyId(client.company), code: `${CLIENT_PREFIX[client.company]}-C-${slug}`, name: client.name, legalName: client.name, type: "COMPANY", email: `accounts@${client.key.replace(/_/g, "-")}.armaar-demo.test`, city: client.company === SMI ? "Sarandë" : client.company === ARSOL ? "Durrës" : "Tirana", country: "Albania", status: "ACTIVE", normalizedName: normalizeSupplier(client.name), createdBy: userId(KEEPER[client.company]!), createdAt: at(-200) },
    });
  }

  /* Invoices, and what paid them ---------------------------------------------- */
  const nextInvoice = series((await prisma.invoice.findMany({ where: inGroup, select: { companyId: true, invoiceNumber: true } })).map((row) => ({ companyId: row.companyId, number: row.invoiceNumber })), "INV");
  const knownInvoices = new Set((await prisma.invoice.findMany({ where: { id: { startsWith: `${P}inv_` } }, select: { id: true } })).map((row) => row.id));
  let receipts = 0;
  for (const [ci, code] of WORKING.entries()) {
    const r = random(1_000 + ci);
    const keeper = m(KEEPER[code]!, code);
    const approver = m(FIN_APPROVER[code]!, code);
    const themes = INVOICE_THEMES[code]!;
    const clients = INVOICE_CLIENTS[code]!;
    const projects = PROJECTS[code]!;
    for (const [index, scenario] of INVOICE_SCENARIOS.entries()) {
      const id = `${P}inv_${SLUG[code]}_${String(index + 1).padStart(3, "0")}`;
      const issued =
        scenario === "PAID" ? -r.int(40, 175)
        : scenario === "PAID_TWO" ? -r.int(70, 160)
        : scenario === "PARTLY" ? -r.int(25, 120)
        : scenario === "OVERDUE" ? -r.int(40, 110)
        : scenario === "NOT_DUE" || scenario === "PAID_EARLY" ? -r.int(6, 25)
        : scenario === "REJECTED" ? -r.int(8, 40)
        : scenario === "CANCELLED" ? -r.int(30, 90)
        : scenario === "DRAFT" ? -r.int(0, 3)
        : -r.int(1, 6);
      const due = issued + 30;
      const project = projects[index % projects.length]!;
      const lines = themes[index % themes.length]!.map(([text, quantity, price]) => ({ description: fill(text, { m: `${monthOf(issued)}`, p: project ? PROJECT_NAME[project] : "" }), quantity, price: round2(price * (0.9 + r.next() * 0.2)) }));
      const subtotal = round2(lines.reduce((sum, line) => sum + round2(line.quantity * line.price), 0));
      const tax = round2(subtotal * 0.2);
      const total = round2(subtotal + tax);
      const status = scenario === "DRAFT" ? "DRAFT" : scenario === "PENDING" ? "PENDING_APPROVAL" : scenario === "APPROVED" ? "APPROVED" : scenario === "REJECTED" ? "REJECTED" : scenario === "CANCELLED" ? "CANCELLED" : "SENT";
      const client = clients[index % clients.length]!;
      if (!knownInvoices.has(id)) {
        await prisma.invoice.create({
          data: {
            id,
            companyId: companyId(code),
            invoiceNumber: nextInvoice(companyId(code)),
            clientId: client,
            projectId: project ? projectId(project) : null,
            issueDate: day(issued),
            dueDate: day(due),
            currency: EUR,
            subtotal: money(subtotal),
            taxAmount: money(tax),
            totalAmount: money(total),
            status,
            sentAt: status === "SENT" ? at(issued, 15) : null,
            notes: scenario === "CANCELLED" ? "Cancelled: raised against the wrong unit; reissued." : null,
            createdByMemberId: keeper,
            createdAt: at(issued, 9),
            lineItems: { create: lines.map((line, sort) => { const sub = round2(line.quantity * line.price); return { description: line.description, quantity: qty(line.quantity), unitPrice: qty(line.price), taxRate: new Prisma.Decimal("20"), subtotal: money(sub), taxAmount: money(sub * 0.2), totalAmount: money(sub * 1.2), sortOrder: sort }; }) },
          },
        });
      }
      if (status !== "DRAFT" && status !== "CANCELLED") {
        const decision = status === "PENDING_APPROVAL" ? "PENDING" : status === "REJECTED" ? "REJECTED" : "APPROVED";
        await prisma.financeApproval.upsert({
          where: { id: `${id}_approval` },
          update: {},
          create: { id: `${id}_approval`, companyId: companyId(code), recordType: "INVOICE", recordId: id, status: decision, submittedByMemberId: keeper, submittedAt: at(issued, 11), decidedByMemberId: decision === "PENDING" ? null : approver, decidedAt: decision === "PENDING" ? null : at(issued, 14), decisionNote: decision === "REJECTED" ? r.pick(INVOICE_REJECTIONS) : null },
        });
      }
      // Receipts: whole, in two parts, or part of it.
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id }, select: { invoiceNumber: true, totalAmount: true } });
      const invoiceTotal = Number(invoice.totalAmount);
      const parts: Array<{ share: number; day: number }> =
        scenario === "PAID" ? [{ share: 1, day: Math.min(-1, issued + r.int(12, 38)) }]
        : scenario === "PAID_EARLY" ? [{ share: 1, day: Math.min(-1, issued + r.int(3, 5)) }]
        : scenario === "PAID_TWO" ? [{ share: 0.5, day: issued + 20 }, { share: 0.5, day: Math.min(-1, issued + 45) }]
        : scenario === "PARTLY" ? [{ share: r.pick([0.3, 0.4, 0.5, 0.6]), day: Math.min(-1, issued + 18) }]
        : [];
      let paidSoFar = 0;
      for (const [pi, part] of parts.entries()) {
        const amount = pi === parts.length - 1 && part.share + paidSoFar / invoiceTotal >= 0.999 ? round2(invoiceTotal - paidSoFar) : round2(invoiceTotal * part.share);
        paidSoFar = round2(paidSoFar + amount);
        const paymentId = `${id}_pay_${pi + 1}`;
        await prisma.payment.upsert({
          where: { id: paymentId },
          update: {},
          create: { id: paymentId, companyId: companyId(code), direction: "RECEIPT", clientId: client, projectId: project ? projectId(project) : null, amount: money(amount), currency: EUR, paymentDate: day(part.day), method: r.next() < 0.85 ? "BANK_TRANSFER" : "CHECK", reference: `IN-${invoice.invoiceNumber}${parts.length > 1 ? `-${pi + 1}` : ""}`, notes: parts.length > 1 || part.share < 1 ? `Part payment of ${invoice.invoiceNumber}.` : `Settles ${invoice.invoiceNumber}.`, status: "RECORDED", createdByMemberId: keeper, createdAt: at(part.day, 15) },
        });
        await prisma.paymentAllocation.upsert({
          where: { id: `${paymentId}_alloc` },
          update: {},
          create: { id: `${paymentId}_alloc`, companyId: companyId(code), paymentId, invoiceId: id, amount: money(amount), createdByMemberId: keeper, createdAt: at(part.day, 15) },
        });
        receipts += 1;
      }
    }
  }

  /* Expenses and disbursements -------------------------------------------------- */
  const nextExpense = series((await prisma.expense.findMany({ where: inGroup, select: { companyId: true, expenseNumber: true } })).map((row) => ({ companyId: row.companyId, number: row.expenseNumber })), "EXP");
  const knownExpenses = new Set((await prisma.expense.findMany({ where: { id: { startsWith: `${P}exp_` } }, select: { id: true } })).map((row) => row.id));
  for (const [ci, code] of WORKING.entries()) {
    const r = random(2_000 + ci);
    const keeper = m(KEEPER[code]!, code);
    const approver = m(FIN_APPROVER[code]!, code);
    const themes = EXPENSE_THEMES[code]!;
    const projects = PROJECTS[code]!;
    for (const [index, scenario] of EXPENSE_SCENARIOS.entries()) {
      const id = `${P}exp_${SLUG[code]}_${String(index + 1).padStart(3, "0")}`;
      const theme = themes[index % themes.length]!;
      const offset = scenario === "DRAFT" ? -r.int(0, 3) : scenario === "PENDING" ? -r.int(1, 8) : -r.int(12, 170);
      const project = projects[index % projects.length]!;
      const net = r.int(theme.net[0], theme.net[1]);
      const status: ExpenseStatus = scenario === "DRAFT" ? "DRAFT" : scenario === "PENDING" ? "PENDING_APPROVAL" : scenario === "REJECTED" ? "REJECTED" : scenario === "CANCELLED" ? "CANCELLED" : "APPROVED";
      if (!knownExpenses.has(id)) {
        await prisma.expense.create({
          data: { id, companyId: companyId(code), expenseNumber: nextExpense(companyId(code)), projectId: project ? projectId(project) : null, expenseDate: day(offset), category: theme.category, description: fill(theme.description, { m: monthOf(offset), p: project ? PROJECT_NAME[project] : "", n: index + 3 }), payeeName: theme.payee, currency: EUR, netAmount: money(net), taxAmount: money(net * 0.2), totalAmount: money(net * 1.2), status, notes: scenario === "CANCELLED" ? "Withdrawn: the supplier credited the charge." : null, createdByMemberId: keeper, createdAt: at(offset, 11) },
        });
      }
      if (status !== "DRAFT") {
        const decision = status === "PENDING_APPROVAL" ? "PENDING" : status === "REJECTED" ? "REJECTED" : status === "CANCELLED" ? "CANCELLED" : "APPROVED";
        await prisma.financeApproval.upsert({
          where: { id: `${id}_approval` },
          update: {},
          create: { id: `${id}_approval`, companyId: companyId(code), recordType: "EXPENSE", recordId: id, status: decision, submittedByMemberId: keeper, submittedAt: at(offset, 12), decidedByMemberId: decision === "PENDING" || decision === "CANCELLED" ? null : approver, decidedAt: decision === "PENDING" ? null : at(offset + 1, 10), decisionNote: decision === "REJECTED" ? r.pick(EXPENSE_REJECTIONS) : null },
        });
      }
      if (scenario === "PAID" || scenario === "PART_PAID") {
        const expense = await prisma.expense.findUniqueOrThrow({ where: { id }, select: { expenseNumber: true, totalAmount: true, payeeName: true } });
        const amount = scenario === "PAID" ? Number(expense.totalAmount) : round2(Number(expense.totalAmount) * 0.9);
        const paid = Math.min(-1, offset + r.int(6, 25));
        const paymentId = `${id}_pay`;
        await prisma.payment.upsert({
          where: { id: paymentId },
          update: {},
          create: { id: paymentId, companyId: companyId(code), direction: "DISBURSEMENT", projectId: project ? projectId(project) : null, amount: money(amount), currency: EUR, paymentDate: day(paid), method: "BANK_TRANSFER", reference: `OUT-${expense.expenseNumber}`, notes: scenario === "PAID" ? `Paid to ${expense.payeeName}.` : `Paid to ${expense.payeeName}; 10% held until the final report.`, status: "RECORDED", createdByMemberId: keeper, createdAt: at(paid, 14) },
        });
        await prisma.paymentAllocation.upsert({
          where: { id: `${paymentId}_alloc` },
          update: {},
          create: { id: `${paymentId}_alloc`, companyId: companyId(code), paymentId, expenseId: id, amount: money(amount), createdByMemberId: keeper, createdAt: at(paid, 14) },
        });
      }
    }
  }

  /* Commitments entered by hand --------------------------------------------------- */
  const MANUAL: Array<{ key: string; company: CompanyCode; project: ProjectCode | null; reference: string; description: string; counterparty: string; category: FinanceCostCategory; amount: number; status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "CLOSED" | "CANCELLED"; day: number; expected: number; note?: string }> = [
    { key: "tl_security", company: BCI, project: "TIRANA_LAKE", reference: "TL-SEC-02", description: "Site security services — October to March", counterparty: "Demo Security Services sh.p.k.", category: "SERVICES", amount: 62_400, status: "APPROVED", day: -35, expected: 180 },
    { key: "tl_facade_consultant", company: BCI, project: "TIRANA_LAKE", reference: "TL-FAC-03", description: "Façade consultant — Tower B inspections", counterparty: "Demo Façade Engineering sh.p.k.", category: "SERVICES", amount: 28_000, status: "PENDING_APPROVAL", day: -2, expected: 120 },
    { key: "et_survey", company: IDEAL, project: "EYES_OF_TIRANA", reference: "ET-SRV-01", description: "Condition survey of the neighbouring buildings", counterparty: "Demo Survey Partners sh.p.k.", category: "SERVICES", amount: 12_800, status: "APPROVED", day: -60, expected: 20 },
    { key: "et_demolition_alt", company: IDEAL, project: "EYES_OF_TIRANA", reference: "ET-DEM-02", description: "Alternative demolition contractor — second quote", counterparty: "Demo Demolition sh.p.k.", category: "SUBCONTRACTOR", amount: 139_000, status: "REJECTED", day: -25, expected: 45, note: "AlbaBuild's order stands; this second quote is not needed." },
    { key: "ut_wind", company: UNICO, project: "UNITED_TOWERS", reference: "UT-ENG-02", description: "Wind-tunnel testing — facade pressures", counterparty: "Demo Wind Engineering Ltd", category: "SERVICES", amount: 54_000, status: "APPROVED", day: -80, expected: 40 },
    { key: "ut_planning", company: UNICO, project: "UNITED_TOWERS", reference: "UT-PLN-01", description: "Planning consultant retainer", counterparty: "Demo Urban Planning sh.p.k.", category: "SERVICES", amount: 36_000, status: "CANCELLED", day: -110, expected: 150 },
    { key: "cb_marine", company: SMI, project: "CLEARWATER_BEACH", reference: "CB-MAR-01", description: "Breakwater design — Clearwater Beach", counterparty: "Vlora Marine Works sh.p.k.", category: "SERVICES", amount: 88_000, status: "APPROVED", day: -45, expected: 90 },
    { key: "as_om", company: ARSOL, project: null, reference: "AS-OM-2026", description: "O&M contract — rooftop batch 1, year 2", counterparty: "Demo Solar Services sh.p.k.", category: "SERVICES", amount: 41_000, status: "APPROVED", day: -160, expected: 200 },
    { key: "as_insurance", company: ARSOL, project: null, reference: "AS-INS-2026", description: "All-risk insurance — rooftop batches 2 and 3", counterparty: "Demo Insurance sh.a.", category: "ADMINISTRATION", amount: 17_600, status: "PENDING_APPROVAL", day: -3, expected: 30 },
  ];
  for (const commitment of MANUAL) {
    const code = commitment.company;
    const id = `${P}cmt_${commitment.key}`;
    const keeper = m(KEEPER[code]!, code);
    await prisma.commitment.upsert({
      where: { id },
      update: {},
      create: { id, companyId: companyId(code), projectId: commitment.project ? projectId(commitment.project) : null, reference: commitment.reference, description: commitment.description, counterpartyName: commitment.counterparty, category: commitment.category, currency: EUR, amount: money(commitment.amount), expectedDate: day(commitment.expected), status: commitment.status, createdByMemberId: keeper, createdAt: at(commitment.day, 10) },
    });
    if (commitment.status === "DRAFT") continue;
    const decision = commitment.status === "PENDING_APPROVAL" ? "PENDING" : commitment.status === "REJECTED" ? "REJECTED" : "APPROVED";
    await prisma.financeApproval.upsert({
      where: { id: `${id}_approval` },
      update: {},
      create: { id: `${id}_approval`, companyId: companyId(code), recordType: "COMMITMENT", recordId: id, status: decision, submittedByMemberId: keeper, submittedAt: at(commitment.day, 11), decidedByMemberId: decision === "PENDING" ? null : m(FIN_APPROVER[code]!, code), decidedAt: decision === "PENDING" ? null : at(commitment.day + 1, 10), decisionNote: commitment.note ?? null },
    });
  }

  /* Budget revisions ------------------------------------------------------------------ */
  const REVISIONS: Array<{ company: CompanyCode; project: ProjectCode; status: "DRAFT" | "PENDING_APPROVAL" | "REJECTED"; factor: number; day: number; name: string; note?: string }> = [
    { company: BCI, project: "TIRANA_LAKE", status: "PENDING_APPROVAL", factor: 1.045, day: -3, name: "Revision 2 — Tower B levels 13 and 14" },
    { company: UNICO, project: "UNITED_TOWERS", status: "DRAFT", factor: 1.08, day: -1, name: "Revision 2 — after the wind-tunnel study" },
  ];
  for (const revision of REVISIONS) {
    const code = revision.company;
    const id = `${P}budget_${revision.project.toLowerCase()}_v2`;
    const current = await prisma.projectBudget.findFirst({ where: { projectId: projectId(revision.project), isCurrent: true }, select: { id: true, lineItems: { select: { category: true, description: true, plannedAmount: true, sortOrder: true } } } });
    const taken = await prisma.projectBudget.findFirst({ where: { projectId: projectId(revision.project), version: 2 }, select: { id: true } });
    if (!current || (taken && taken.id !== id)) continue;
    const lines = current.lineItems.map((line) => ({ category: line.category, description: line.description, plannedAmount: money(Number(line.plannedAmount) * revision.factor), sortOrder: line.sortOrder }));
    const total = lines.reduce((sum, line) => sum + Number(line.plannedAmount), 0);
    const keeper = m(KEEPER[code]!, code);
    await prisma.projectBudget.upsert({
      where: { id },
      update: {},
      create: { id, companyId: companyId(code), projectId: projectId(revision.project), version: 2, name: revision.name, currency: EUR, status: revision.status, isCurrent: false, totalAmount: money(total), notes: revision.note ?? null, createdByMemberId: keeper, createdAt: at(revision.day - 2, 10), lineItems: { create: lines } },
    });
    if (revision.status === "DRAFT") continue;
    const rejected = revision.status === "REJECTED";
    await prisma.financeApproval.upsert({
      where: { id: `${id}_approval` },
      update: {},
      create: { id: `${id}_approval`, companyId: companyId(code), recordType: "BUDGET", recordId: id, status: rejected ? "REJECTED" : "PENDING", submittedByMemberId: keeper, submittedAt: at(revision.day, 11), decidedByMemberId: rejected ? m(FIN_APPROVER[code]!, code) : null, decidedAt: rejected ? at(revision.day + 2, 10) : null, decisionNote: revision.note ?? null },
    });
  }

  /* Suppliers ------------------------------------------------------------------------- */
  for (const supplier of [...NEW_SUPPLIERS.map((row) => ({ ...row, taxId: row.taxId as string | null })), ...MORE_COMPANIES.map((row) => ({ ...row, city: "Tirana" }))]) {
    for (const [position, code] of supplier.companies.entries()) {
      const id = supplierId(supplier.key, code);
      await prisma.supplier.upsert({
        where: { id },
        update: {},
        create: { id, companyId: companyId(code), code: supplier.code, name: supplier.name, legalName: supplier.name, supplierType: "COMPANY", taxId: supplier.taxId, email: `orders@${supplier.key.replace(/_/g, "-")}.armaar-demo.test`, city: supplier.city, country: "Albania", status: "ACTIVE", paymentTermsDays: 30, defaultCurrency: EUR, notes: supplier.category, normalizedName: normalizeSupplier(supplier.name), createdByMemberId: m(BUYER[code]!, code), createdAt: at(-190 + position * 4) },
      });
    }
  }

  /* Request → approval → order → delivery ------------------------------------------------ */
  const nextRequest = series((await prisma.purchaseRequest.findMany({ where: inGroup, select: { companyId: true, requestNumber: true } })).map((row) => ({ companyId: row.companyId, number: row.requestNumber })), "PR");
  const nextOrder = series((await prisma.purchaseOrder.findMany({ where: inGroup, select: { companyId: true, poNumber: true } })).map((row) => ({ companyId: row.companyId, number: row.poNumber })), "PO");
  const nextReceipt = series((await prisma.goodsReceipt.findMany({ where: inGroup, select: { companyId: true, receiptNumber: true } })).map((row) => ({ companyId: row.companyId, number: row.receiptNumber })), "GRN");
  const knownRequests = new Set((await prisma.purchaseRequest.findMany({ where: { id: { startsWith: `${P}pr_` } }, select: { id: true } })).map((row) => row.id));
  const knownOrders = new Set((await prisma.purchaseOrder.findMany({ where: { id: { startsWith: `${P}po_` } }, select: { id: true } })).map((row) => row.id));
  const knownReceipts = new Set((await prisma.goodsReceipt.findMany({ where: { id: { startsWith: `${P}grn_` } }, select: { id: true } })).map((row) => row.id));
  /** Deliveries of stocked items, for the stock ledger below. */
  const delivered: Array<{ company: CompanyCode; item: string; goodsReceipt: string; quantity: number; day: number }> = [];

  for (const [ci, code] of WORKING.entries()) {
    const r = random(3_000 + ci);
    const catalog = CATALOG[code]!;
    const projects = PROJECTS[code]!;
    const buyer = m(BUYER[code]!, code);
    const approver = m(PROC_APPROVER[code]!, code);
    for (const [index, state] of CHAIN_STATES.entries()) {
      const buy = catalog[index % catalog.length]!;
      const batch = Math.floor(index / catalog.length) + 2 + ci % 2;
      const project = projects[index % projects.length]!;
      const key = `${SLUG[code]}_${String(index + 1).padStart(2, "0")}`;
      const requestId = `${P}pr_${key}`;
      const requestItemId = `${requestId}_item_1`;
      const requester = m(REQUESTERS[code]![index % REQUESTERS[code]!.length]!, code);
      const quantity = buy.quantity[0] === buy.quantity[1] ? buy.quantity[0] : Math.round(r.int(buy.quantity[0], buy.quantity[1]) / 10) * 10 || buy.quantity[0];
      const price = round2(buy.price * (0.95 + r.next() * 0.1));
      const submitted: number | null =
        state === "DRAFT" ? null
        : state === "PENDING" ? -r.int(1, 6)
        : state === "REJECTED" ? -r.int(8, 120)
        : state === "CANCELLED" ? -r.int(15, 140)
        : state === "APPROVED" ? -r.int(4, 25)
        : state === "PO_PENDING" ? -r.int(6, 18)
        : state === "PO_APPROVED" ? -r.int(10, 35)
        : state === "PO_ISSUED" ? -r.int(15, 60)
        : state === "PO_PARTIAL" ? -r.int(30, 100)
        : state === "PO_RECEIVED" ? -r.int(35, 170)
        : -r.int(50, 170);
      const hasOrder = state.startsWith("PO_");
      const complete = state === "PO_RECEIVED" || state === "PO_CLOSED";
      const status: PurchaseRequestStatus = state === "DRAFT" ? "DRAFT" : state === "PENDING" ? "PENDING_APPROVAL" : state === "REJECTED" ? "REJECTED" : state === "CANCELLED" ? "CANCELLED" : state === "APPROVED" ? "APPROVED" : complete ? "COMPLETED" : "ORDERED";
      const approved = !["DRAFT", "PENDING_APPROVAL", "REJECTED", "CANCELLED"].includes(status);
      const decidedAt = submitted === null ? null : at(Math.min(submitted + 1, 0), 11);
      const rejection = status === "REJECTED" ? r.pick(PR_REJECTIONS) : null;
      const values = { m: monthOf(submitted ?? 0), p: project ? PROJECT_NAME[project] : "", n: batch };
      const title = fill(buy.title, values);
      if (!knownRequests.has(requestId)) {
        await prisma.purchaseRequest.create({
          data: { id: requestId, companyId: companyId(code), requestNumber: nextRequest(companyId(code)), title, projectId: project ? projectId(project) : null, requestedByMemberId: requester, requiredDate: day((submitted ?? 0) + 30), priority: index % 7 === 2 ? "HIGH" : index % 11 === 5 ? "LOW" : "MEDIUM", currency: EUR, estimatedTotal: money(quantity * buy.price), status, submittedAt: submitted === null ? null : at(submitted, 9), approvedAt: approved ? decidedAt : null, approvedByMemberId: approved ? approver : null, rejectedAt: status === "REJECTED" ? decidedAt : null, rejectedByMemberId: status === "REJECTED" ? approver : null, rejectionReason: rejection, cancelledAt: status === "CANCELLED" ? at((submitted ?? 0) + 2, 16) : null, createdByMemberId: requester, createdAt: at((submitted ?? -1) - 2) },
        });
      }
      await prisma.purchaseRequestItem.upsert({
        where: { id: requestItemId },
        update: {},
        create: { id: requestItemId, purchaseRequestId: requestId, description: buy.description, quantity: qty(quantity), unit: buy.unit, estimatedUnitPrice: qty(buy.price), estimatedAmount: money(quantity * buy.price), category: buy.category, sortOrder: 1 },
      });
      if (submitted !== null) {
        const decision = status === "PENDING_APPROVAL" ? "PENDING" : status === "REJECTED" ? "REJECTED" : status === "CANCELLED" ? "CANCELLED" : "APPROVED";
        const existingNote = (await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: requestId }, select: { rejectionReason: true } })).rejectionReason;
        await prisma.procurementApproval.upsert({
          where: { id: `${requestId}_approval` },
          update: {},
          create: { id: `${requestId}_approval`, companyId: companyId(code), recordType: "PURCHASE_REQUEST", recordId: requestId, status: decision, submittedByMemberId: requester, submittedAt: at(submitted, 9), decidedByMemberId: decision === "APPROVED" || decision === "REJECTED" ? approver : null, decidedAt: decision === "PENDING" ? null : decision === "CANCELLED" ? at(submitted + 2, 16) : decidedAt, decisionNote: decision === "REJECTED" ? existingNote : decision === "APPROVED" ? "Within budget." : decision === "CANCELLED" ? "Withdrawn by the requester." : null },
        });
      }
      if (!hasOrder) continue;

      const orderId = `${P}po_${key}`;
      const placed = Math.min(submitted! + r.int(2, 4), -1);
      const orderStatus: PurchaseOrderStatus = state === "PO_PENDING" ? "PENDING_APPROVAL" : state === "PO_APPROVED" ? "APPROVED" : state === "PO_ISSUED" ? "ISSUED" : state === "PO_PARTIAL" ? "PARTIALLY_RECEIVED" : state === "PO_RECEIVED" ? "RECEIVED" : "CLOSED";
      const span = Math.max(2, -placed - 1);
      const deliveries: Array<{ share: number; day: number }> =
        state === "PO_PARTIAL" ? [{ share: r.pick([0.4, 0.5, 0.6]), day: placed + Math.max(1, Math.floor(span * 0.6)) }]
        : complete && index % 2 === 0 ? [{ share: 0.5, day: placed + Math.max(1, Math.floor(span * 0.3)) }, { share: 0.5, day: placed + Math.max(2, Math.floor(span * 0.6)) }]
        : complete ? [{ share: 1, day: placed + Math.max(1, Math.min(20, Math.floor(span * 0.4))) }]
        : [];
      const lead = state === "PO_ISSUED" || state === "PO_PARTIAL" ? -placed + r.int(5, 40) : state === "PO_PENDING" || state === "PO_APPROVED" ? r.int(20, 60) : Math.max(1, (deliveries.at(-1)?.day ?? placed + 10) - placed);
      const subtotal = round2(quantity * price);
      const orderApproved = APPROVED_ORDER.includes(orderStatus);
      if (!knownOrders.has(orderId)) {
        await prisma.purchaseOrder.create({
          data: { id: orderId, companyId: companyId(code), poNumber: nextOrder(companyId(code)), supplierId: supplierId(buy.supplier, code), purchaseRequestId: requestId, projectId: project ? projectId(project) : null, orderDate: day(placed), requiredDate: day(placed + lead), currency: EUR, subtotal: money(subtotal), taxAmount: money(subtotal * 0.2), totalAmount: money(subtotal * 1.2), status: orderStatus, submittedAt: at(placed, 10), approvedAt: orderApproved ? at(Math.min(placed + 1, 0), 11) : null, approvedByMemberId: orderApproved ? approver : null, issuedAt: orderApproved && orderStatus !== "APPROVED" ? at(Math.min(placed + 1, 0), 15) : null, closedAt: orderStatus === "CLOSED" ? at(Math.min((deliveries.at(-1)?.day ?? placed) + 2, 0), 16) : null, createdByMemberId: buyer, createdAt: at(placed, 9) },
        });
      }
      await prisma.purchaseOrderItem.upsert({
        where: { id: `${orderId}_item_1` },
        update: {},
        create: { id: `${orderId}_item_1`, purchaseOrderId: orderId, sourceRequestItemId: requestItemId, description: buy.description, quantity: qty(quantity), unit: buy.unit, unitPrice: qty(price), taxRate: new Prisma.Decimal("0.2000"), subtotal: money(subtotal), taxAmount: money(subtotal * 0.2), totalAmount: money(subtotal * 1.2), sortOrder: 1 },
      });
      await prisma.procurementApproval.upsert({
        where: { id: `${orderId}_approval` },
        update: {},
        create: { id: `${orderId}_approval`, companyId: companyId(code), recordType: "PURCHASE_ORDER", recordId: orderId, status: orderApproved ? "APPROVED" : "PENDING", submittedByMemberId: buyer, submittedAt: at(placed, 10), decidedByMemberId: orderApproved ? approver : null, decidedAt: orderApproved ? at(Math.min(placed + 1, 0), 11) : null },
      });
      for (const [di, delivery] of deliveries.entries()) {
        const receiptId = `${P}grn_${key}_${di + 1}`;
        const received = round2(quantity * delivery.share);
        const deliveryDay = Math.min(delivery.day, -1);
        if (!knownReceipts.has(receiptId)) {
          const number = nextReceipt(companyId(code));
          await prisma.goodsReceipt.create({
            data: { id: receiptId, companyId: companyId(code), receiptNumber: number, purchaseOrderId: orderId, projectId: project ? projectId(project) : null, supplierId: supplierId(buy.supplier, code), receiptDate: day(deliveryDay), deliveryReference: `DN-${number.slice(-4)}`, status: "RECORDED", receivedByMemberId: m(STOREKEEPER(code), code), createdByMemberId: buyer, createdAt: at(deliveryDay, 15) },
          });
        }
        await prisma.goodsReceiptItem.upsert({
          where: { id: `${receiptId}_item_1` },
          update: {},
          create: { id: `${receiptId}_item_1`, goodsReceiptId: receiptId, purchaseOrderItemId: `${orderId}_item_1`, receivedQuantity: qty(received), acceptedQuantity: qty(received), rejectedQuantity: qty(0) },
        });
        if (buy.item) delivered.push({ company: code, item: buy.item, goodsReceipt: receiptId, quantity: received, day: deliveryDay });
      }
    }
  }
  const commitments = await seedOrderCommitments(prisma);

  /* Stores, items and the ledger ------------------------------------------------------------ */
  for (const store of STORES) {
    const keeper = m(STOREKEEPER(store.company), store.company);
    await prisma.warehouse.upsert({
      where: { id: store.id },
      update: {},
      create: { id: store.id, companyId: companyId(store.company), code: store.code, name: store.name, warehouseType: store.type, projectId: store.project ? projectId(store.project) : null, city: store.city, country: "Albania", status: "ACTIVE", createdByMemberId: keeper, createdAt: at(-160) },
    });
    for (const [index, code] of store.locations.entries()) {
      await prisma.inventoryLocation.upsert({
        where: { id: loc(store.id, code) },
        update: {},
        create: { id: loc(store.id, code), companyId: companyId(store.company), warehouseId: store.id, code, name: code === "MAIN" ? "Main store" : "Yard", status: "ACTIVE", isDefault: index === 0, createdByMemberId: keeper },
      });
    }
  }
  for (const item of ITEMS) {
    await prisma.inventoryItem.upsert({
      where: { id: itemId(item.company, item.key) },
      update: {},
      create: { id: itemId(item.company, item.key), companyId: companyId(item.company), sku: item.sku, name: item.name, category: item.category, baseUnit: item.unit, status: "ACTIVE", minimumStock: qty(item.minimum), reorderPoint: qty(item.reorder), defaultWarehouseId: warehouseOf(item.site), defaultLocationId: item.site, createdByMemberId: m(STOREKEEPER(item.company), item.company), createdAt: at(-160) },
    });
  }

  // The documents, planned in date order against a running balance so nothing goes below zero.
  type Line = { item: Item; location: string; quantity: number; to?: string };
  type Doc = { kind: "adjustment" | "receipt" | "issue" | "transfer"; id: string; company: CompanyCode; day: number; warehouse: string; to?: string; reason?: StockAdjustmentReason; notes: string; goodsReceipt?: string; posted: boolean; project?: ProjectCode | null; lines: Line[] };
  const docs: Doc[] = [];
  const balance = new Map<string, number>();
  const bal = (item: Item, location: string) => balance.get(`${itemId(item.company, item.key)}:${location}`) ?? 0;
  const move = (item: Item, location: string, delta: number) => balance.set(`${itemId(item.company, item.key)}:${location}`, bal(item, location) + delta);
  const totalOf = (item: Item) => [...balance.entries()].filter(([k]) => k.startsWith(`${itemId(item.company, item.key)}:`)).reduce((sum, [, v]) => sum + v, 0);
  const round = (item: Item, value: number) => (item.unit === "t" || item.unit === "m²" ? Math.round(value * 10) / 10 : Math.round(value));

  type Event = { day: number; order: number; run: () => void };
  const events: Event[] = [];
  const docNo = new Map<string, number>();
  const docId = (kind: string, code: CompanyCode) => {
    const n = (docNo.get(`${kind}:${code}`) ?? 0) + 1;
    docNo.set(`${kind}:${code}`, n);
    return `${P}${kind}_${SLUG[code]}_${String(n).padStart(3, "0")}`;
  };
  for (const code of WORKING) {
    const items = ITEMS.filter((item) => item.company === code);
    // Opening balances, one document per store.
    for (const warehouse of [...new Set(items.map((item) => warehouseOf(item.openAt)))]) {
      const lines = items.filter((item) => warehouseOf(item.openAt) === warehouse).map((item) => ({ item, location: item.openAt, quantity: item.opening }));
      events.push({ day: -150, order: 0, run: () => { lines.forEach((line) => move(line.item, line.location, line.quantity)); docs.push({ kind: "adjustment", id: docId("adj", code), company: code, day: -150, warehouse, reason: "OPENING_BALANCE", notes: "Opening stock when the store went live in NESTO.", posted: true, lines }); } });
    }
    // Receipts from the deliveries recorded in Procurement.
    for (const delivery of delivered.filter((row) => row.company === code)) {
      const item = items.find((candidate) => candidate.key === delivery.item);
      if (!item) continue;
      events.push({ day: delivery.day, order: 1, run: () => { move(item, item.site, delivery.quantity); docs.push({ kind: "receipt", id: docId("ir", code), company: code, day: delivery.day, warehouse: warehouseOf(item.site), goodsReceipt: delivery.goodsReceipt, notes: "Received into stock from the goods receipt.", posted: true, lines: [{ item, location: item.site, quantity: delivery.quantity }] }); } });
    }
    // Transfers from a central store to site, every six weeks.
    const moving = items.filter((item) => item.openAt !== item.site);
    for (const offset of [-140, -98, -56, -14]) {
      const groups = [...new Set(moving.map((item) => `${warehouseOf(item.openAt)}>${warehouseOf(item.site)}`))];
      for (const group of groups) {
        const [from, to] = group.split(">") as [string, string];
        const lines = moving.filter((item) => warehouseOf(item.openAt) === from && warehouseOf(item.site) === to);
        events.push({ day: offset, order: 2, run: () => {
          const moved = lines.map((item) => ({ item, location: item.openAt, to: item.site, quantity: round(item, bal(item, item.openAt) * (offset === -14 ? 1 : 0.35)) })).filter((line) => line.quantity > 0);
          if (!moved.length) return;
          moved.forEach((line) => { move(line.item, line.location, -line.quantity); move(line.item, line.to, line.quantity); });
          docs.push({ kind: "transfer", id: docId("trf", code), company: code, day: offset, warehouse: from, to, notes: "Stock for the site's next weeks.", posted: true, lines: moved });
        } });
      }
    }
    // Issues to site, roughly weekly, spread over the items.
    const r = random(4_000 + WORKING.indexOf(code));
    for (let offset = -145; offset <= -2; offset += r.int(5, 9)) {
      const picked = items.filter((_, index) => (index + offset) % 3 === 0 || items.length <= 3);
      const issueDay = offset;
      events.push({ day: issueDay, order: 3, run: () => {
        const lines = picked.map((item) => {
          const available = bal(item, item.site);
          const want = round(item, available * (0.12 + r.next() * 0.18));
          // Items that stay healthy keep a margin above their reorder point, across every store.
          const floor = item.low ? item.minimum : item.reorder * 1.6;
          const allowed = Math.max(0, Math.min(want, available, totalOf(item) - floor));
          return { item, location: item.site, quantity: round(item, allowed) };
        }).filter((line) => line.quantity > 0);
        if (!lines.length) return;
        lines.forEach((line) => move(line.item, line.location, -line.quantity));
        const project = lines[0]!.item.project;
        docs.push({ kind: "issue", id: docId("iss", code), company: code, day: issueDay, warehouse: warehouseOf(lines[0]!.location), project, notes: project ? `Issued to ${PROJECT_NAME[project]} — ${r.pick(["daily works", "next pour", "finishing crew", "first fix", "plant refuelling", "site set-up"])}.` : `Issued to the rooftop installation crew — ${r.pick(["Demo Retail Park", "Durrës logistics hub", "Elbasan cold store"])}.`, posted: true, lines: lines.filter((line) => warehouseOf(line.location) === warehouseOf(lines[0]!.location)) });
        // Lines in another store go out on their own document.
        const other = lines.filter((line) => warehouseOf(line.location) !== warehouseOf(lines[0]!.location));
        if (other.length) docs.push({ kind: "issue", id: docId("iss", code), company: code, day: issueDay, warehouse: warehouseOf(other[0]!.location), project: other[0]!.item.project, notes: "Issued to site.", posted: true, lines: other });
      } });
    }
    // Last week: the low items drawn down to their reorder point or below, a count, and an issue still a draft.
    events.push({ day: -1, order: 4, run: () => {
      const lines = items.filter((item) => item.low).map((item) => ({ item, location: item.site, quantity: round(item, Math.min(bal(item, item.site), totalOf(item) - item.reorder * 0.7)) })).filter((line) => line.quantity > 0);
      for (const line of lines) {
        move(line.item, line.location, -line.quantity);
        docs.push({ kind: "issue", id: docId("iss", code), company: code, day: -1, warehouse: warehouseOf(line.location), project: line.item.project, notes: "Large call-off for the week's work; reorder raised.", posted: true, lines: [line] });
      }
    } });
    events.push({ day: -2, order: 5, run: () => {
      const counted = items.filter((item) => !item.low && bal(item, item.site) > 10).slice(0, 2);
      if (!counted.length) return;
      const lines = counted.map((item, index) => ({ item, location: item.site, quantity: index === 0 ? -round(item, Math.max(1, bal(item, item.site) * 0.02)) : round(item, Math.max(1, bal(item, item.site) * 0.01)) }));
      lines.forEach((line) => move(line.item, line.location, line.quantity));
      docs.push({ kind: "adjustment", id: docId("adj", code), company: code, day: -2, warehouse: warehouseOf(lines[0]!.location), reason: "PHYSICAL_COUNT", notes: "Monthly count: small differences against the ledger.", posted: true, lines: lines.filter((line) => warehouseOf(line.location) === warehouseOf(lines[0]!.location)) });
    } });
    events.push({ day: 0, order: 6, run: () => {
      const item = items.find((candidate) => !candidate.low && bal(candidate, candidate.site) > 0);
      if (!item) return;
      docs.push({ kind: "issue", id: docId("iss", code), company: code, day: 0, warehouse: warehouseOf(item.site), project: item.project, notes: "Waiting for the crew to collect.", posted: false, lines: [{ item, location: item.site, quantity: round(item, Math.max(1, bal(item, item.site) * 0.1)) }] });
    } });
  }
  events.sort((a, b) => a.day - b.day || a.order - b.order).forEach((event) => event.run());

  // Numbers continue each company's documents.
  const nextIssue = series((await prisma.stockIssue.findMany({ where: inGroup, select: { companyId: true, issueNumber: true } })).map((row) => ({ companyId: row.companyId, number: row.issueNumber })), "ISS");
  const nextTransfer = series((await prisma.stockTransfer.findMany({ where: inGroup, select: { companyId: true, transferNumber: true } })).map((row) => ({ companyId: row.companyId, number: row.transferNumber })), "TRF");
  const nextAdjustment = series((await prisma.stockAdjustment.findMany({ where: inGroup, select: { companyId: true, adjustmentNumber: true } })).map((row) => ({ companyId: row.companyId, number: row.adjustmentNumber })), "ADJ");
  const nextStockReceipt = series((await prisma.inventoryReceipt.findMany({ where: inGroup, select: { companyId: true, receiptNumber: true } })).map((row) => ({ companyId: row.companyId, number: row.receiptNumber })), "GRN");
  const written = new Set([
    ...(await prisma.stockIssue.findMany({ where: { id: { startsWith: P } }, select: { id: true } })),
    ...(await prisma.stockTransfer.findMany({ where: { id: { startsWith: P } }, select: { id: true } })),
    ...(await prisma.stockAdjustment.findMany({ where: { id: { startsWith: P } }, select: { id: true } })),
    ...(await prisma.inventoryReceipt.findMany({ where: { id: { startsWith: P } }, select: { id: true } })),
  ].map((row) => row.id));

  for (const doc of docs) {
    if (written.has(doc.id)) continue;
    const code = doc.company;
    const company = companyId(code);
    const by = m(STOREKEEPER(code), code);
    const when = at(doc.day, 11);
    const movements: Prisma.StockMovementCreateManyInput[] = [];
    const movement = (input: { id: string; item: Item; warehouse: string; location: string; type: StockMovementType; quantity: number; project?: string | null; lineId: string; entityType: string }) => {
      const amount = qty(Math.abs(input.quantity));
      movements.push({ id: input.id, companyId: company, inventoryItemId: itemId(code, input.item.key), warehouseId: input.warehouse, locationId: input.location, movementType: input.type, quantity: amount, signedQuantity: amount.mul(SIGN[input.type]), unit: input.item.unit, projectId: input.project ?? null, sourceModule: "inventory", sourceEntityType: input.entityType, sourceEntityId: doc.id, sourceLineId: input.lineId, occurredAt: when, postedByMemberId: by, createdAt: when });
      return input.id;
    };
    await prisma.$transaction(async (tx) => {
      if (doc.kind === "adjustment") {
        await tx.stockAdjustment.create({ data: { id: doc.id, companyId: company, adjustmentNumber: nextAdjustment(company), warehouseId: doc.warehouse, adjustmentDate: day(doc.day), reason: doc.reason!, status: "POSTED", notes: doc.notes, createdByMemberId: by, postedByMemberId: by, createdAt: when } });
        const lines = doc.lines.map((line, index) => { const lineId = `${doc.id}_line_${index + 1}`; const moved = movement({ id: `${doc.id}_mv_${index + 1}`, item: line.item, warehouse: doc.warehouse, location: line.location, type: line.quantity >= 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", quantity: line.quantity, lineId, entityType: "stock_adjustment" }); return { id: lineId, stockAdjustmentId: doc.id, inventoryItemId: itemId(code, line.item.key), locationId: line.location, quantityDelta: qty(line.quantity), unit: line.item.unit, movementId: moved }; });
        await tx.stockMovement.createMany({ data: movements });
        await tx.stockAdjustmentLine.createMany({ data: lines });
      } else if (doc.kind === "receipt") {
        await tx.inventoryReceipt.create({ data: { id: doc.id, companyId: company, receiptNumber: nextStockReceipt(company), goodsReceiptId: doc.goodsReceipt!, warehouseId: doc.warehouse, status: "POSTED", receiptDate: day(doc.day), postedAt: when, createdByMemberId: by, postedByMemberId: by, notes: doc.notes, createdAt: when } });
        const lines = doc.lines.map((line, index) => { const lineId = `${doc.id}_line_${index + 1}`; const moved = movement({ id: `${doc.id}_mv_${index + 1}`, item: line.item, warehouse: doc.warehouse, location: line.location, type: "RECEIPT", quantity: line.quantity, lineId, entityType: "inventory_receipt" }); return { id: lineId, inventoryReceiptId: doc.id, goodsReceiptItemId: `${doc.goodsReceipt}_item_1`, inventoryItemId: itemId(code, line.item.key), locationId: line.location, quantity: qty(line.quantity), unit: line.item.unit, movementId: moved }; });
        await tx.stockMovement.createMany({ data: movements });
        await tx.inventoryReceiptLine.createMany({ data: lines });
        const type = IntegrationType.PROCUREMENT_RECEIPT_INVENTORY_RECEIPT;
        const idempotencyKey = buildIdempotencyKey(company, type, doc.goodsReceipt!);
        await tx.integrationLink.upsert({
          where: { companyId_integrationType_idempotencyKey: { companyId: company, integrationType: type, idempotencyKey } },
          update: {},
          create: { companyId: company, integrationType: type, mode: "CREATE_FROM", sourceModule: "procurement", sourceEntityType: "goods_receipt", sourceEntityId: doc.goodsReceipt!, targetModule: "inventory", targetEntityType: "inventory_receipt", targetEntityId: doc.id, idempotencyKey, createdByMemberId: by, createdAt: when },
        });
      } else if (doc.kind === "issue") {
        const project = doc.project ? projectId(doc.project) : null;
        const to = m(r0(ISSUE_TO[code]!, doc.id), code);
        await tx.stockIssue.create({ data: { id: doc.id, companyId: company, issueNumber: nextIssue(company), projectId: project, warehouseId: doc.warehouse, status: doc.posted ? "POSTED" : "DRAFT", issueDate: day(doc.day), issuedToMemberId: to, requestedByMemberId: to, createdByMemberId: by, postedByMemberId: doc.posted ? by : null, notes: doc.notes, createdAt: when } });
        const lines = doc.lines.map((line, index) => { const lineId = `${doc.id}_line_${index + 1}`; const moved = doc.posted ? movement({ id: `${doc.id}_mv_${index + 1}`, item: line.item, warehouse: doc.warehouse, location: line.location, type: "ISSUE", quantity: line.quantity, project, lineId, entityType: "stock_issue" }) : null; return { id: lineId, stockIssueId: doc.id, inventoryItemId: itemId(code, line.item.key), locationId: line.location, quantity: qty(line.quantity), unit: line.item.unit, movementId: moved }; });
        if (movements.length) await tx.stockMovement.createMany({ data: movements });
        await tx.stockIssueLine.createMany({ data: lines });
      } else {
        await tx.stockTransfer.create({ data: { id: doc.id, companyId: company, transferNumber: nextTransfer(company), fromWarehouseId: doc.warehouse, toWarehouseId: doc.to!, transferDate: day(doc.day), status: "POSTED", createdByMemberId: by, postedByMemberId: by, notes: doc.notes, createdAt: when } });
        const lines = doc.lines.map((line, index) => { const lineId = `${doc.id}_line_${index + 1}`; const out = movement({ id: `${doc.id}_out_${index + 1}`, item: line.item, warehouse: doc.warehouse, location: line.location, type: "TRANSFER_OUT", quantity: line.quantity, lineId, entityType: "stock_transfer" }); const into = movement({ id: `${doc.id}_in_${index + 1}`, item: line.item, warehouse: doc.to!, location: line.to!, type: "TRANSFER_IN", quantity: line.quantity, lineId, entityType: "stock_transfer" }); return { id: lineId, stockTransferId: doc.id, inventoryItemId: itemId(code, line.item.key), fromLocationId: line.location, toLocationId: line.to!, quantity: qty(line.quantity), unit: line.item.unit, outMovementId: out, inMovementId: into }; });
        await tx.stockMovement.createMany({ data: movements });
        await tx.stockTransferLine.createMany({ data: lines });
      }
    });
  }
  // Balances are the ledger's sum, as the balance service computes them.
  for (const code of WORKING) await rebuildBalances(prisma, companyId(code));

  return {
    clients: await prisma.client.count({ where: { ...inGroup, type: "COMPANY" } }),
    invoices: await prisma.invoice.count({ where: inGroup }),
    expenses: await prisma.expense.count({ where: inGroup }),
    payments: await prisma.payment.count({ where: inGroup }),
    newReceipts: receipts,
    orderCommitments: commitments,
    commitments: await prisma.commitment.count({ where: inGroup }),
    budgets: await prisma.projectBudget.count({ where: inGroup }),
    suppliers: await prisma.supplier.count({ where: inGroup }),
    requests: await prisma.purchaseRequest.count({ where: inGroup }),
    orders: await prisma.purchaseOrder.count({ where: inGroup }),
    goodsReceipts: await prisma.goodsReceipt.count({ where: inGroup }),
    items: await prisma.inventoryItem.count({ where: inGroup }),
    warehouses: await prisma.warehouse.count({ where: inGroup }),
    movements: await prisma.stockMovement.count({ where: inGroup }),
  };
}

/** A stable choice from a list, keyed on an id. */
function r0<T>(list: readonly T[], key: string): T {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return list[hash % list.length]!;
}

/** The commitment approving an order opens, for this file's orders (as supply.ts does for its own). */
async function seedOrderCommitments(prisma: PrismaClient): Promise<number> {
  const CATEGORY: Record<ProcurementCategory, FinanceCostCategory> = { MATERIALS: "MATERIALS", EQUIPMENT: "EQUIPMENT", SUBCONTRACT: "SUBCONTRACTOR", SERVICES: "SERVICES", LOGISTICS: "SERVICES", OFFICE: "ADMINISTRATION", OTHER: "OTHER" };
  const orders = await prisma.purchaseOrder.findMany({
    where: { id: { startsWith: `${P}po_` }, status: { in: APPROVED_ORDER } },
    select: { id: true, companyId: true, poNumber: true, projectId: true, currency: true, totalAmount: true, requiredDate: true, status: true, approvedAt: true, approvedByMemberId: true, createdByMemberId: true, financeCommitmentId: true, supplier: { select: { name: true } }, items: { take: 1, select: { sourceRequestItemId: true } } },
  });
  const categories = new Map((await prisma.purchaseRequestItem.findMany({ where: { id: { in: orders.map((order) => order.items[0]?.sourceRequestItemId ?? "") } }, select: { id: true, category: true } })).map((row) => [row.id, row.category]));
  for (const order of orders) {
    const source = { companyId: order.companyId, sourceModule: "procurement", sourceEntityType: "purchase_order", sourceEntityId: order.id };
    const approver = order.approvedByMemberId ?? order.createdByMemberId;
    const category = categories.get(order.items[0]?.sourceRequestItemId ?? "");
    const commitment = await prisma.commitment.upsert({
      where: { companyId_sourceModule_sourceEntityType_sourceEntityId: source },
      update: {},
      create: { id: `${P}cmt_${order.id.replace(new RegExp(`^${P}`), "")}`, ...source, projectId: order.projectId, reference: order.poNumber, description: `Purchase order ${order.poNumber}`, counterpartyName: order.supplier.name, category: category ? CATEGORY[category] : "MATERIALS", currency: order.currency, amount: order.totalAmount, expectedDate: order.requiredDate, status: order.status === "CLOSED" ? "CLOSED" : "APPROVED", createdByMemberId: approver, createdAt: order.approvedAt ?? undefined },
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
