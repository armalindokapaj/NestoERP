/**
 * Finance fixtures (PRD #15 §328–§339).
 *
 * Every state the Finance module has to render is present, because a screen
 * that has never been seen with data in it has never really been built:
 *
 *   invoices        every workflow status, and every settlement state including
 *                   each receivables aging bucket (§329, §337)
 *   expenses        every status, across all eight cost categories (§331)
 *   payments        receipts and disbursements, recorded and voided (§332)
 *   budgets         a current approved budget per live project, plus a
 *                   superseded v1 and a draft revision (§333)
 *   budget risk     one project comfortably inside budget, one near it, one
 *                   over it (§334)
 *   commitments     every status, spread across projects (§335)
 *   approvals       a pending invoice, expense, budget and commitment, so the
 *                   approval queue is meaningful from the first login (§336)
 *
 * The seed is idempotent: everything is addressed by a deterministic id and
 * upserted, so re-running it on an existing database converges rather than
 * duplicating.
 */
import type { PrismaClient, Prisma } from "@prisma/client";

import { COMPANY_A, COMPANY_B, PROJECT_IDS, daysFromNow } from "./constants";

type Members = Map<string, string>;

const EUR = "EUR";

export async function seedFinanceRecords(prisma: PrismaClient, members: Members) {
  const finance = members.get("user_finance")!;
  const ceo = members.get("user_ceo")!;
  const pm = members.get("user_pm")!;

  await seedSettings(prisma);
  await seedInvoices(prisma, finance);
  await seedExpenses(prisma, finance, pm);
  await seedBudgets(prisma, finance, ceo);
  await seedCommitments(prisma, finance);
  await seedPayments(prisma, finance);
  await seedApprovals(prisma, finance, ceo);

  return {
    invoices: await prisma.invoice.count({ where: { companyId: COMPANY_A } }),
    expenses: await prisma.expense.count({ where: { companyId: COMPANY_A } }),
    payments: await prisma.payment.count({ where: { companyId: COMPANY_A } }),
    budgets: await prisma.projectBudget.count({ where: { companyId: COMPANY_A } }),
    commitments: await prisma.commitment.count({ where: { companyId: COMPANY_A } }),
  };
}

/* -------------------------------------------------------------------------- */
/* Settings (PRD #15 §28)                                                      */
/* -------------------------------------------------------------------------- */

async function seedSettings(prisma: PrismaClient) {
  for (const companyId of [COMPANY_A, COMPANY_B]) {
    await prisma.financeSettings.upsert({
      where: { companyId },
      update: {},
      // Base currency, fiscal year and payment terms live on CompanySettings
      // now; Finance keeps only what is finance-specific (PRD #24 §124).
      create: {
        companyId,
        invoicePrefix: "INV",
        defaultTaxRate: "20",
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Invoices (PRD #15 §329, §330, §337)                                         */
/* -------------------------------------------------------------------------- */

type InvoiceLine = { description: string; quantity: string; unitPrice: string; taxRate: string };

type InvoiceFixture = {
  id: string;
  number: string;
  project: string | null;
  client: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "SENT" | "CANCELLED" | "ARCHIVED";
  /** Days from today. Negative is in the past. */
  due: number;
  currency?: string;
  lines: InvoiceLine[];
  /** Portion of the total already received, as a fraction. */
  settled?: number;
};

const INVOICES: InvoiceFixture[] = [
  // Sent and current — not yet due (PRD #15 §337).
  {
    id: "invoice_001",
    number: "INV-2026-001",
    project: PROJECT_IDS.a,
    client: "client_acme",
    status: "SENT",
    due: 18,
    lines: [
      { description: "Stage 3 valuation — blocks A and B", quantity: "1", unitPrice: "96000", taxRate: "20" },
      { description: "Site supervision, February", quantity: "160", unitPrice: "65", taxRate: "20" },
    ],
  },
  // Sent, 1–30 days overdue, partially paid.
  {
    id: "invoice_002",
    number: "INV-2026-002",
    project: PROJECT_IDS.a,
    client: "client_acme",
    status: "SENT",
    due: -12,
    settled: 0.4,
    lines: [
      { description: "Stage 2 valuation — substructure", quantity: "1", unitPrice: "80000", taxRate: "20" },
    ],
  },
  // Sent, 31–60 days overdue, nothing received.
  {
    id: "invoice_003",
    number: "INV-2026-003",
    project: PROJECT_IDS.c,
    client: "client_meridian",
    status: "SENT",
    due: -44,
    lines: [
      { description: "Concept design package", quantity: "1", unitPrice: "34000", taxRate: "20" },
      { description: "Planning support meetings", quantity: "12", unitPrice: "420", taxRate: "20" },
    ],
  },
  // Sent, 61–90 days overdue.
  {
    id: "invoice_004",
    number: "INV-2026-004",
    project: PROJECT_IDS.d,
    client: "client_atlas",
    status: "SENT",
    due: -72,
    lines: [
      { description: "Topographical survey and report", quantity: "1", unitPrice: "26250", taxRate: "20" },
    ],
  },
  // Sent, 90+ days overdue — the one that should be shouting.
  {
    id: "invoice_005",
    number: "INV-2026-005",
    project: PROJECT_IDS.c,
    client: "client_meridian",
    status: "SENT",
    due: -118,
    lines: [
      { description: "Feasibility and massing study", quantity: "1", unitPrice: "15625", taxRate: "20" },
    ],
  },
  // Sent and settled in full.
  {
    id: "invoice_006",
    number: "INV-2026-006",
    project: PROJECT_IDS.b,
    client: "client_beta",
    status: "SENT",
    due: -30,
    settled: 1,
    lines: [
      { description: "Design fee — RIBA stage 4", quantity: "1", unitPrice: "70833.34", taxRate: "20" },
    ],
  },
  // Sent, fully settled, older — proves a paid invoice stays SENT (PRD #15 §45).
  {
    id: "invoice_007",
    number: "INV-2026-007",
    project: PROJECT_IDS.f,
    client: "client_urban",
    status: "SENT",
    due: -80,
    settled: 1,
    lines: [
      { description: "Final account — retail fit-out", quantity: "1", unitPrice: "53333.33", taxRate: "20" },
    ],
  },
  // Awaiting a decision: this one populates the approval queue.
  {
    id: "invoice_008",
    number: "INV-2026-008",
    project: PROJECT_IDS.b,
    client: "client_beta",
    status: "PENDING_APPROVAL",
    due: 22,
    lines: [
      { description: "Enabling works — valuation 1", quantity: "1", unitPrice: "175000", taxRate: "20" },
    ],
  },
  // Approved, not yet marked sent.
  {
    id: "invoice_009",
    number: "INV-2026-009",
    project: PROJECT_IDS.d,
    client: "client_atlas",
    status: "APPROVED",
    due: 26,
    lines: [
      { description: "Standby and preliminaries", quantity: "1", unitPrice: "8166.67", taxRate: "20" },
    ],
  },
  // Draft, still being written.
  {
    id: "invoice_010",
    number: "INV-2026-010",
    project: PROJECT_IDS.e,
    client: "client_greenline",
    status: "DRAFT",
    due: 45,
    lines: [
      { description: "Feasibility study", quantity: "1", unitPrice: "12083.33", taxRate: "20" },
    ],
  },
  // Rejected and sent back for correction.
  {
    id: "invoice_011",
    number: "INV-2026-011",
    project: PROJECT_IDS.a,
    client: "client_acme",
    status: "REJECTED",
    due: 30,
    lines: [
      { description: "Variation 04 — balcony redesign", quantity: "1", unitPrice: "22750", taxRate: "20" },
    ],
  },
  // Cancelled: raised in error, never sent.
  {
    id: "invoice_012",
    number: "INV-2026-012",
    project: PROJECT_IDS.f,
    client: "client_urban",
    status: "CANCELLED",
    due: -100,
    lines: [
      { description: "Retention release — raised in error", quantity: "1", unitPrice: "10000", taxRate: "20" },
    ],
  },
  // A second currency, so the multi-currency rule is exercised (PRD #15 §35).
  {
    id: "invoice_013",
    number: "INV-2026-013",
    project: null,
    client: "client_atlas",
    status: "SENT",
    due: -6,
    currency: "USD",
    lines: [
      { description: "Advisory retainer, Q1", quantity: "3", unitPrice: "4000", taxRate: "0" },
    ],
  },
  // Sent, not yet due, and partly settled — the plain PARTIALLY_PAID case, so
  // it is distinguishable from an overdue invoice that also has money against
  // it (PRD #15 §337).
  {
    id: "invoice_015",
    number: "INV-2026-015",
    project: PROJECT_IDS.b,
    client: "client_beta",
    status: "SENT",
    due: 21,
    settled: 0.3,
    lines: [
      { description: "Design fee — RIBA stage 5, first instalment", quantity: "1", unitPrice: "24000", taxRate: "20" },
    ],
  },
  // Archived from draft, proving restore has something to return to.
  {
    id: "invoice_014",
    number: "INV-2025-098",
    project: PROJECT_IDS.f,
    client: "client_urban",
    status: "ARCHIVED",
    due: -210,
    lines: [
      { description: "Superseded retention claim", quantity: "1", unitPrice: "9000", taxRate: "20" },
    ],
  },
];

/** Mirrors invoice.calculation.ts, in plain decimal string arithmetic. */
function lineTotals(line: InvoiceLine) {
  const subtotal = round2(Number(line.quantity) * Number(line.unitPrice));
  const taxAmount = round2((subtotal * Number(line.taxRate)) / 100);
  return { subtotal, taxAmount, totalAmount: round2(subtotal + taxAmount) };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function seedInvoices(prisma: PrismaClient, finance: string) {
  for (const fixture of INVOICES) {
    const lines = fixture.lines.map(lineTotals);
    const subtotal = round2(lines.reduce((sum, line) => sum + line.subtotal, 0));
    const taxAmount = round2(lines.reduce((sum, line) => sum + line.taxAmount, 0));
    const totalAmount = round2(lines.reduce((sum, line) => sum + line.totalAmount, 0));

    const archived = fixture.status === "ARCHIVED";

    await prisma.invoice.upsert({
      where: { id: fixture.id },
      update: {},
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        invoiceNumber: fixture.number,
        clientId: fixture.client,
        projectId: fixture.project,
        issueDate: daysFromNow(fixture.due - 30),
        dueDate: daysFromNow(fixture.due),
        currency: fixture.currency ?? EUR,
        subtotal,
        taxAmount,
        totalAmount,
        status: fixture.status,
        preArchiveStatus: archived ? "DRAFT" : null,
        archivedAt: archived ? daysFromNow(fixture.due + 10) : null,
        archivedByMemberId: archived ? finance : null,
        sentAt: fixture.status === "SENT" ? daysFromNow(fixture.due - 30) : null,
        createdByMemberId: finance,
        lineItems: {
          create: fixture.lines.map((line, index) => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            taxRate: line.taxRate,
            ...lineTotals(line),
            sortOrder: index,
          })),
        },
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Expenses (PRD #15 §331, §338)                                               */
/* -------------------------------------------------------------------------- */

type ExpenseFixture = {
  id: string;
  number: string | null;
  project: string | null;
  category:
    | "LABOR"
    | "MATERIALS"
    | "EQUIPMENT"
    | "SUBCONTRACTOR"
    | "SERVICES"
    | "TRAVEL"
    | "ADMINISTRATION"
    | "OTHER";
  description: string;
  payee: string | null;
  net: number;
  tax: number;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "CANCELLED" | "ARCHIVED";
  days: number;
  /** Fraction of the total already paid out. */
  settled?: number;
};

const EXPENSES: ExpenseFixture[] = [
  { id: "expense_001", number: "EXP-001", project: PROJECT_IDS.a, category: "SUBCONTRACTOR", description: "Groundworks package — February", payee: "Terra Ndërtim sh.p.k.", net: 145000, tax: 29000, status: "APPROVED", days: -40, settled: 1 },
  { id: "expense_002", number: "EXP-002", project: PROJECT_IDS.a, category: "MATERIALS", description: "Reinforcement steel, batch 3", payee: "Alba Steel", net: 68000, tax: 13600, status: "APPROVED", days: -25, settled: 0.5 },
  { id: "expense_003", number: "EXP-003", project: PROJECT_IDS.a, category: "EQUIPMENT", description: "Tower crane hire, month 4", payee: "Lift & Co", net: 22000, tax: 4400, status: "APPROVED", days: -12 },
  { id: "expense_004", number: "EXP-004", project: PROJECT_IDS.a, category: "LABOR", description: "Site labour, week 8", payee: null, net: 18400, tax: 0, status: "APPROVED", days: -8 },
  { id: "expense_005", number: "EXP-005", project: PROJECT_IDS.b, category: "SUBCONTRACTOR", description: "Facade engineering package", payee: "Vertek Engineering", net: 96000, tax: 19200, status: "APPROVED", days: -30, settled: 1 },
  { id: "expense_006", number: "EXP-006", project: PROJECT_IDS.b, category: "SERVICES", description: "Structural peer review", payee: "Rilind Consulting", net: 14500, tax: 2900, status: "APPROVED", days: -18 },
  { id: "expense_007", number: "EXP-007", project: PROJECT_IDS.c, category: "SERVICES", description: "Planning consultancy retainer", payee: "Kthesa Planning", net: 9800, tax: 1960, status: "APPROVED", days: -20 },
  // Project D is deliberately pushed over its budget (PRD #15 §334).
  { id: "expense_008", number: "EXP-008", project: PROJECT_IDS.d, category: "SUBCONTRACTOR", description: "Hardstanding and drainage", payee: "Terra Ndërtim sh.p.k.", net: 210000, tax: 42000, status: "APPROVED", days: -50, settled: 0.25 },
  { id: "expense_009", number: "EXP-009", project: PROJECT_IDS.d, category: "MATERIALS", description: "Precast units, phase 1", payee: "Precast Adriatik", net: 88000, tax: 17600, status: "APPROVED", days: -22 },
  { id: "expense_010", number: "EXP-010", project: PROJECT_IDS.d, category: "EQUIPMENT", description: "Plant hire — extended standby", payee: "Lift & Co", net: 34000, tax: 6800, status: "APPROVED", days: -6 },
  // Awaiting a decision: populates the approval queue.
  { id: "expense_011", number: "EXP-011", project: PROJECT_IDS.b, category: "MATERIALS", description: "Curtain walling deposit", payee: "Vertek Engineering", net: 45000, tax: 9000, status: "PENDING_APPROVAL", days: -3 },
  { id: "expense_012", number: "EXP-012", project: PROJECT_IDS.a, category: "TRAVEL", description: "Site visits and mileage, February", payee: null, net: 860, tax: 172, status: "PENDING_APPROVAL", days: -2 },
  { id: "expense_013", number: "EXP-013", project: null, category: "ADMINISTRATION", description: "Office rent, March", payee: "Tirana Business Park", net: 4200, tax: 840, status: "APPROVED", days: -5 },
  { id: "expense_014", number: "EXP-014", project: null, category: "SERVICES", description: "Annual accounting retainer", payee: "Numra Accounting", net: 7500, tax: 1500, status: "APPROVED", days: -60, settled: 1 },
  { id: "expense_015", number: "EXP-015", project: null, category: "OTHER", description: "Professional indemnity insurance", payee: "Sigal", net: 11200, tax: 0, status: "DRAFT", days: -1 },
  { id: "expense_016", number: "EXP-016", project: PROJECT_IDS.c, category: "LABOR", description: "Overtime claim — disputed", payee: null, net: 3200, tax: 640, status: "REJECTED", days: -15 },
  { id: "expense_017", number: "EXP-017", project: PROJECT_IDS.e, category: "SERVICES", description: "Duplicate consultancy entry", payee: "Kthesa Planning", net: 2400, tax: 480, status: "CANCELLED", days: -35 },
  { id: "expense_018", number: null, project: PROJECT_IDS.f, category: "OTHER", description: "Superseded retention cost", payee: null, net: 1800, tax: 360, status: "ARCHIVED", days: -200 },
];

async function seedExpenses(prisma: PrismaClient, finance: string, pm: string) {
  for (const fixture of EXPENSES) {
    const archived = fixture.status === "ARCHIVED";

    await prisma.expense.upsert({
      where: { id: fixture.id },
      update: {},
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        expenseNumber: fixture.number,
        projectId: fixture.project,
        expenseDate: daysFromNow(fixture.days),
        category: fixture.category,
        description: fixture.description,
        payeeName: fixture.payee,
        currency: EUR,
        netAmount: fixture.net,
        taxAmount: fixture.tax,
        totalAmount: round2(fixture.net + fixture.tax),
        status: fixture.status,
        preArchiveStatus: archived ? "CANCELLED" : null,
        archivedAt: archived ? daysFromNow(fixture.days + 20) : null,
        archivedByMemberId: archived ? finance : null,
        // Project costs are raised by whoever is running the project; company
        // overheads by Finance.
        createdByMemberId: fixture.project ? pm : finance,
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Budgets (PRD #15 §333, §334)                                                */
/* -------------------------------------------------------------------------- */

type BudgetLine = {
  category: ExpenseFixture["category"];
  description: string;
  plannedAmount: number;
};

type BudgetFixture = {
  id: string;
  project: string;
  version: number;
  name: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  isCurrent: boolean;
  lines: BudgetLine[];
};

/**
 * Budget totals are chosen against the seeded expenses and commitments so the
 * three risk bands are all reachable (PRD #15 §334):
 *
 *   Project A  forecast well inside budget    → GREEN
 *   Project B  forecast in the 90–100% band   → WARNING
 *   Project D  forecast above budget          → CRITICAL
 */
const BUDGETS: BudgetFixture[] = [
  {
    id: "budget_a_v1",
    project: PROJECT_IDS.a,
    version: 1,
    name: "Riverside — original budget",
    status: "APPROVED",
    isCurrent: false,
    lines: [
      { category: "SUBCONTRACTOR", description: "Groundworks and substructure", plannedAmount: 150000 },
      { category: "MATERIALS", description: "Structural materials", plannedAmount: 90000 },
      { category: "LABOR", description: "Site labour", plannedAmount: 60000 },
    ],
  },
  {
    id: "budget_a_v2",
    project: PROJECT_IDS.a,
    version: 2,
    name: "Riverside — revised for variation 04",
    status: "APPROVED",
    isCurrent: true,
    lines: [
      { category: "SUBCONTRACTOR", description: "Groundworks and substructure", plannedAmount: 200000 },
      { category: "MATERIALS", description: "Structural materials", plannedAmount: 120000 },
      { category: "LABOR", description: "Site labour", plannedAmount: 80000 },
      { category: "EQUIPMENT", description: "Crane and plant", plannedAmount: 60000 },
      { category: "SERVICES", description: "Design and supervision", plannedAmount: 40000 },
    ],
  },
  {
    id: "budget_b_v1",
    project: PROJECT_IDS.b,
    version: 1,
    name: "Central Office — construction budget",
    status: "APPROVED",
    isCurrent: true,
    lines: [
      { category: "SUBCONTRACTOR", description: "Facade package", plannedAmount: 120000 },
      { category: "SERVICES", description: "Engineering and review", plannedAmount: 25000 },
      { category: "MATERIALS", description: "Curtain walling", plannedAmount: 40000 },
    ],
  },
  {
    id: "budget_c_v1",
    project: PROJECT_IDS.c,
    version: 1,
    name: "Marina — design stage budget",
    status: "APPROVED",
    isCurrent: true,
    lines: [
      { category: "SERVICES", description: "Design and planning", plannedAmount: 80000 },
      { category: "LABOR", description: "Internal resource", plannedAmount: 20000 },
    ],
  },
  {
    id: "budget_d_v1",
    project: PROJECT_IDS.d,
    version: 1,
    name: "Logistics Hub — phase 1 budget",
    status: "APPROVED",
    isCurrent: true,
    lines: [
      { category: "SUBCONTRACTOR", description: "Hardstanding and drainage", plannedAmount: 220000 },
      { category: "MATERIALS", description: "Precast units", plannedAmount: 90000 },
      { category: "EQUIPMENT", description: "Plant hire", plannedAmount: 30000 },
    ],
  },
  // Awaiting a decision: populates the approval queue.
  {
    id: "budget_c_v2",
    project: PROJECT_IDS.c,
    version: 2,
    name: "Marina — technical design uplift",
    status: "PENDING_APPROVAL",
    isCurrent: false,
    lines: [
      { category: "SERVICES", description: "Design and planning", plannedAmount: 110000 },
      { category: "LABOR", description: "Internal resource", plannedAmount: 28000 },
      { category: "OTHER", description: "Statutory fees", plannedAmount: 6000 },
    ],
  },
  {
    id: "budget_e_v1",
    project: PROJECT_IDS.e,
    version: 1,
    name: "Greenline — outline budget",
    status: "DRAFT",
    isCurrent: false,
    lines: [
      { category: "SERVICES", description: "Feasibility and concept", plannedAmount: 35000 },
    ],
  },
];

async function seedBudgets(prisma: PrismaClient, finance: string, ceo: string) {
  for (const fixture of BUDGETS) {
    const totalAmount = round2(
      fixture.lines.reduce((sum, line) => sum + line.plannedAmount, 0),
    );
    const approved = fixture.status === "APPROVED";

    await prisma.projectBudget.upsert({
      where: { id: fixture.id },
      update: {},
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        projectId: fixture.project,
        version: fixture.version,
        name: fixture.name,
        currency: EUR,
        status: fixture.status,
        isCurrent: fixture.isCurrent,
        totalAmount,
        createdByMemberId: finance,
        approvedByMemberId: approved ? ceo : null,
        approvedAt: approved ? daysFromNow(-90 + fixture.version * 20) : null,
        lineItems: {
          create: fixture.lines.map((line, index) => ({
            category: line.category,
            description: line.description,
            plannedAmount: line.plannedAmount,
            sortOrder: index,
          })),
        },
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Commitments (PRD #15 §335)                                                  */
/* -------------------------------------------------------------------------- */

type CommitmentFixture = {
  id: string;
  reference: string;
  project: string | null;
  description: string;
  counterparty: string | null;
  category: ExpenseFixture["category"];
  amount: number;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "CLOSED" | "CANCELLED" | "ARCHIVED";
  expected: number | null;
};

const COMMITMENTS: CommitmentFixture[] = [
  { id: "commitment_001", reference: "COM-001", project: PROJECT_IDS.a, description: "Superstructure frame package", counterparty: "Terra Ndërtim sh.p.k.", category: "SUBCONTRACTOR", amount: 60000, status: "APPROVED", expected: 45 },
  { id: "commitment_002", reference: "COM-002", project: PROJECT_IDS.a, description: "Window and glazing supply", counterparty: "Vertek Engineering", category: "MATERIALS", amount: 24000, status: "APPROVED", expected: 70 },
  { id: "commitment_003", reference: "COM-003", project: PROJECT_IDS.b, description: "Curtain walling — balance", counterparty: "Vertek Engineering", category: "MATERIALS", amount: 42000, status: "APPROVED", expected: 30 },
  { id: "commitment_004", reference: "COM-004", project: PROJECT_IDS.d, description: "Drainage extension works", counterparty: "Terra Ndërtim sh.p.k.", category: "SUBCONTRACTOR", amount: 46000, status: "APPROVED", expected: 20 },
  { id: "commitment_005", reference: "COM-005", project: PROJECT_IDS.c, description: "Landscape design fee", counterparty: "Kthesa Planning", category: "SERVICES", amount: 12000, status: "APPROVED", expected: 60 },
  // Awaiting a decision: populates the approval queue.
  { id: "commitment_006", reference: "COM-006", project: PROJECT_IDS.b, description: "Lift installation contract", counterparty: "Adria Lifts", category: "SUBCONTRACTOR", amount: 88000, status: "PENDING_APPROVAL", expected: 120 },
  { id: "commitment_007", reference: "COM-007", project: PROJECT_IDS.a, description: "Temporary works design", counterparty: "Rilind Consulting", category: "SERVICES", amount: 6500, status: "DRAFT", expected: 25 },
  { id: "commitment_008", reference: "COM-008", project: PROJECT_IDS.e, description: "Ground investigation", counterparty: "Geo Albania", category: "SERVICES", amount: 9000, status: "REJECTED", expected: 40 },
  // Closed: the work happened and became an expense, so it stops counting.
  { id: "commitment_009", reference: "COM-009", project: PROJECT_IDS.a, description: "Groundworks package", counterparty: "Terra Ndërtim sh.p.k.", category: "SUBCONTRACTOR", amount: 174000, status: "CLOSED", expected: -35 },
  { id: "commitment_010", reference: "COM-010", project: PROJECT_IDS.b, description: "Facade engineering", counterparty: "Vertek Engineering", category: "SERVICES", amount: 115200, status: "CLOSED", expected: -25 },
  { id: "commitment_011", reference: "COM-011", project: PROJECT_IDS.d, description: "Cancelled plant framework", counterparty: "Lift & Co", category: "EQUIPMENT", amount: 18000, status: "CANCELLED", expected: 15 },
  { id: "commitment_012", reference: "COM-012", project: null, description: "Company vehicle lease", counterparty: "Auto Tirana", category: "OTHER", amount: 21000, status: "APPROVED", expected: 90 },
];

async function seedCommitments(prisma: PrismaClient, finance: string) {
  for (const fixture of COMMITMENTS) {
    await prisma.commitment.upsert({
      where: { id: fixture.id },
      update: {},
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        projectId: fixture.project,
        reference: fixture.reference,
        description: fixture.description,
        counterpartyName: fixture.counterparty,
        category: fixture.category,
        currency: EUR,
        amount: fixture.amount,
        expectedDate: fixture.expected === null ? null : daysFromNow(fixture.expected),
        status: fixture.status,
        createdByMemberId: finance,
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Payments (PRD #15 §332)                                                     */
/* -------------------------------------------------------------------------- */

const METHODS = ["BANK_TRANSFER", "BANK_TRANSFER", "CARD", "CASH", "CHECK"] as const;

/**
 * Payments are derived from the `settled` fractions above rather than listed
 * separately, so an invoice's recorded receipts can never drift away from the
 * settlement state its fixture claims. Each is allocated in full to what it
 * settles, with the id the E-05F migration gives an existing payment's
 * allocation, so reseeding a migrated database changes nothing (E-05F §31).
 */
async function allocateInFull(prisma: PrismaClient, payment: { id: string; amount: number; createdByMemberId: string }, target: { invoiceId?: string; expenseId?: string }) {
  await prisma.paymentAllocation.upsert({
    where: { id: `alloc_${payment.id}` },
    update: {},
    create: { id: `alloc_${payment.id}`, companyId: COMPANY_A, paymentId: payment.id, invoiceId: target.invoiceId ?? null, expenseId: target.expenseId ?? null, amount: payment.amount, createdByMemberId: payment.createdByMemberId },
  });
}

async function seedPayments(prisma: PrismaClient, finance: string) {
  let index = 0;

  for (const fixture of INVOICES) {
    if (!fixture.settled) continue;

    const invoice = await prisma.invoice.findUnique({
      where: { id: fixture.id },
      select: { totalAmount: true, currency: true, dueDate: true, clientId: true, projectId: true },
    });
    if (!invoice) continue;

    index += 1;
    const amount = round2(Number(invoice.totalAmount) * fixture.settled);
    const paymentId = `payment_in_${index.toString().padStart(3, "0")}`;

    await prisma.payment.upsert({
      where: { id: paymentId },
      update: {},
      create: {
        id: paymentId,
        companyId: COMPANY_A,
        direction: "RECEIPT",
        clientId: invoice.clientId,
        projectId: invoice.projectId,
        amount,
        currency: invoice.currency,
        paymentDate: daysFromNow(fixture.due + 4),
        method: METHODS[index % METHODS.length],
        reference: `BK-${2026000 + index}`,
        status: "RECORDED",
        createdByMemberId: finance,
      },
    });
    await allocateInFull(prisma, { id: paymentId, amount, createdByMemberId: finance }, { invoiceId: fixture.id });
  }

  let outIndex = 0;
  for (const fixture of EXPENSES) {
    if (!fixture.settled) continue;

    outIndex += 1;
    const total = round2(fixture.net + fixture.tax);
    const paymentId = `payment_out_${outIndex.toString().padStart(3, "0")}`;
    const expense = await prisma.expense.findUnique({ where: { id: fixture.id }, select: { projectId: true } });

    await prisma.payment.upsert({
      where: { id: paymentId },
      update: {},
      create: {
        id: paymentId,
        companyId: COMPANY_A,
        direction: "DISBURSEMENT",
        projectId: expense?.projectId ?? null,
        amount: round2(total * fixture.settled),
        currency: EUR,
        paymentDate: daysFromNow(fixture.days + 7),
        method: METHODS[outIndex % METHODS.length],
        reference: `PAY-${5026000 + outIndex}`,
        status: "RECORDED",
        createdByMemberId: finance,
      },
    });
    await allocateInFull(prisma, { id: paymentId, amount: round2(total * fixture.settled), createdByMemberId: finance }, { expenseId: fixture.id });
  }

  /*
   * A voided payment, so the "recorded, then reversed" path has a fixture.
   * It is deliberately *not* one of the settlement payments above: voiding one
   * of those would make the invoice's settlement state disagree with its
   * fixture (PRD #15 §86).
   */
  await prisma.payment.upsert({
    where: { id: "payment_voided_001" },
    update: {},
    create: {
      id: "payment_voided_001",
      companyId: COMPANY_A,
      direction: "RECEIPT",
      clientId: (await prisma.invoice.findUniqueOrThrow({ where: { id: "invoice_001" }, select: { clientId: true } })).clientId,
      projectId: (await prisma.invoice.findUniqueOrThrow({ where: { id: "invoice_001" }, select: { projectId: true } })).projectId,
      amount: 1000,
      currency: EUR,
      paymentDate: daysFromNow(-4),
      method: "BANK_TRANSFER",
      reference: "BK-DUPLICATE",
      status: "VOIDED",
      voidReason: "Duplicate of BK-2026001, reversed by the bank.",
      voidedAt: daysFromNow(-3),
      voidedByMemberId: finance,
      createdByMemberId: finance,
    },
  });
  await allocateInFull(prisma, { id: "payment_voided_001", amount: 1000, createdByMemberId: finance }, { invoiceId: "invoice_001" });
}

/* -------------------------------------------------------------------------- */
/* Approvals (PRD #15 §336)                                                    */
/* -------------------------------------------------------------------------- */

type ApprovalFixture = {
  id: string;
  recordType: "INVOICE" | "EXPENSE" | "BUDGET" | "COMMITMENT";
  recordId: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  days: number;
  note?: string;
};

const APPROVALS: ApprovalFixture[] = [
  // One pending cycle per record type, so the queue is meaningful at first login.
  { id: "approval_001", recordType: "INVOICE", recordId: "invoice_008", status: "PENDING", days: -3 },
  { id: "approval_002", recordType: "EXPENSE", recordId: "expense_011", status: "PENDING", days: -3 },
  { id: "approval_003", recordType: "EXPENSE", recordId: "expense_012", status: "PENDING", days: -2 },
  { id: "approval_004", recordType: "BUDGET", recordId: "budget_c_v2", status: "PENDING", days: -5 },
  { id: "approval_005", recordType: "COMMITMENT", recordId: "commitment_006", status: "PENDING", days: -4 },
  // Settled history, so a record's approval trail is not empty.
  { id: "approval_006", recordType: "INVOICE", recordId: "invoice_009", status: "APPROVED", days: -9, note: "Checked against the valuation." },
  { id: "approval_007", recordType: "INVOICE", recordId: "invoice_011", status: "REJECTED", days: -7, note: "Variation 04 is not agreed with the client yet." },
  { id: "approval_008", recordType: "EXPENSE", recordId: "expense_016", status: "REJECTED", days: -14, note: "Overtime was not authorised in advance." },
  { id: "approval_009", recordType: "BUDGET", recordId: "budget_a_v2", status: "APPROVED", days: -50, note: "Approved with the variation." },
  { id: "approval_010", recordType: "COMMITMENT", recordId: "commitment_004", status: "APPROVED", days: -18 },
];

async function seedApprovals(prisma: PrismaClient, finance: string, ceo: string) {
  for (const fixture of APPROVALS) {
    const decided = fixture.status !== "PENDING";

    await prisma.financeApproval.upsert({
      where: { id: fixture.id },
      update: {},
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        recordType: fixture.recordType,
        recordId: fixture.recordId,
        status: fixture.status,
        // Finance raises and submits; the CEO decides. That is the separation
        // the module exists to hold (PRD #15 §18, §19).
        submittedByMemberId: finance,
        submittedAt: daysFromNow(fixture.days),
        decidedByMemberId: decided ? ceo : null,
        decidedAt: decided ? daysFromNow(fixture.days + 1) : null,
        decisionNote: fixture.note ?? null,
      } satisfies Prisma.FinanceApprovalUncheckedCreateInput,
    });
  }
}
