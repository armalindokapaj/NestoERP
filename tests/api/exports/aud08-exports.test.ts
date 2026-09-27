import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { GET as contractsExport } from "@/app/api/contracts/export/route";
import { GET as invoicesExport } from "@/app/api/finance/invoices/export/route";
import { GET as hseExport } from "@/app/api/hse/export/route";
import { GET as qaqcExport } from "@/app/api/qaqc/export/route";
import { GET as salesExport } from "@/app/api/sales/export/route";
import type { UserContext } from "@/lib/context/types";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, PROJECT, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";
import { byHeader, readCsvBytes, spreadsheetWouldEvaluate, type ReadCsv } from "../../unit/csv/rfc4180";

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));

/**
 * The exports through their routes, read back byte for byte (AUD-08 §7, §9;
 * DT-02, DT-03, DT-14..DT-17, DT-22).
 *
 * Route handlers are called as Next calls them, with a real session behind the
 * context resolver, so permission, scope, the list services, the headers and
 * the file are all the product's own. Every expectation — which ids, in which
 * order, how many — is written out here from the fixture's own definition or
 * read straight from the table, never from the list service under test. Files
 * are parsed with the strict RFC 4180 reader in `tests/unit/csv/rfc4180.ts`.
 *
 * Fixtures are `aud08b_`-prefixed and removed after each test.
 */

const PREFIX = "aud08b";
const startedAt = new Date();
const restore: Array<() => Promise<unknown>> = [];

type Called = { status: number; headers: Headers; bytes: Uint8Array; text: string; csv: () => ReadCsv; json: () => { error: { code: string; message: string; details?: { code?: string; field?: string } } } };

async function call(route: (request: Request) => Promise<Response>, path: string, as: UserContext | null): Promise<Called> {
  actAs(as);
  const response = await route(new Request(`http://nesto.test${path}`));
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  return { status: response.status, headers: response.headers, bytes, text, csv: () => readCsvBytes(bytes), json: () => JSON.parse(text) };
}

/** A refusal is JSON in the ordinary envelope, never a file. */
function expectRefusedWithoutFile(response: Called, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toMatch(/^application\/json/);
  expect(response.headers.get("content-disposition")).toBeNull();
  const body = response.json();
  expect(body.error.details?.code ?? body.error.code).toBe(code);
  return body;
}

async function removeFixtures() {
  const allocations = await prisma.paymentAllocation.findMany({ where: { invoiceId: { startsWith: PREFIX } }, select: { paymentId: true } });
  const paymentIds = [...new Set(allocations.map((row) => row.paymentId))];
  await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.payment.deleteMany({ where: { OR: [{ id: { in: paymentIds } }, { id: { startsWith: PREFIX } }] } });
  await prisma.invoice.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.client.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.lead.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.auditEvent.deleteMany({ where: { entityType: "export", occurredAt: { gte: startedAt }, entityId: { in: ["sales", "contracts", "qaqc", "hse", "finance-invoices"] } } });
}

beforeAll(removeFixtures);
afterEach(async () => {
  for (const undo of restore.splice(0).reverse()) await undo();
  await removeFixtures();
  await cleanupSessions();
  actAs(null);
});
afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/* -------------------------------------------------------------------------- */
/* Lead fixture                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 57 leads: 50 live, 7 archived (i ≥ 50). Values repeat so the sort has ties
 * and nulls: i%4 = 0 → no value, 1 → 1500.00 EUR, 2 → 1500.00 ALL, 3 → 250.50
 * USD. Leads 3, 4 and 5 are the Owner's, the rest the Sales rep's. Four carry
 * company names a spreadsheet must not run or reshape.
 */
const LEAD_COUNT = 57;
const leadId = (i: number) => `${PREFIX}_lead_${pad(i)}`;
const leadValue = (i: number) => (i % 4 === 0 ? null : i % 4 === 3 ? "250.50" : "1500.00");
const leadCurrency = (i: number) => [null, "EUR", "ALL", "USD"][i % 4]!;
const SPECIAL_NAMES: Record<number, string> = { 1: "=cmd|' /C calc'!A0", 2: "-120.50", 6: "0042", 7: 'Çelësi, "ë"\nrresht i dytë' };

async function seedLeads() {
  await prisma.lead.createMany({
    data: Array.from({ length: LEAD_COUNT }, (_, i) => ({
      id: leadId(i),
      companyId: COMPANY.a,
      name: `AUD08B-L-${pad(i)}`,
      companyName: SPECIAL_NAMES[i] ?? `Fixture ${pad(i)}`,
      source: "REFERRAL" as const,
      status: i >= 50 ? ("ARCHIVED" as const) : ("NEW" as const),
      preArchiveStatus: i >= 50 ? ("NEW" as const) : null,
      archivedAt: i >= 50 ? new Date("2026-09-01T10:00:00.000Z") : null,
      ownerMemberId: i >= 3 && i <= 5 ? "member_owner" : "member_sales",
      estimatedValue: leadValue(i),
      currency: leadCurrency(i),
      notes: "internal note that never leaves",
      createdByMemberId: "member_sales",
    })),
  });
}

/** value-desc, nulls last, then id — written out from the fixture, not read from the list. */
function expectedValueDescOrder(): string[] {
  const live = Array.from({ length: 50 }, (_, i) => i);
  const rank = (i: number) => (leadValue(i) === "1500.00" ? 0 : leadValue(i) === "250.50" ? 1 : 2);
  return live.sort((a, b) => rank(a) - rank(b) || a - b).map(leadId);
}

describe("sales leads export (DT-14, DT-15, DT-02, DT-03, DT-22)", () => {
  it("DT-14 exports every match beyond one page, in the list's order with ties and nulls, ignoring page and limit", async () => {
    await seedLeads();
    const owner = await loginAs("OWNER");
    const response = await call(salesExport, "/api/sales/export?type=leads&search=AUD08B-L-&sort=value-desc&page=2&limit=7", owner);
    expect(response.status).toBe(200);
    const read = response.csv();
    expect(read.bom).toBe(true);
    expect(read.lineBreak).toBe("\r\n");
    const rows = byHeader(read);
    expect(rows.map((row) => row["Lead ID"])).toEqual(expectedValueDescOrder());
    expect(response.headers.get("x-export-row-count")).toBe("50");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="sales-leads.csv"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("DT-15 writes the standard columns: ids, company, fixed decimals beside their currency, UTC instants, guarded text, no notes", async () => {
    await seedLeads();
    const owner = await loginAs("OWNER");
    const read = (await call(salesExport, "/api/sales/export?type=leads&search=AUD08B-L-&sort=value-desc", owner)).csv();
    expect(read.header).toEqual(["Company ID", "Lead ID", "Lead", "Company", "Source", "Owner", "Estimated value", "Currency", "Status", "Updated at"]);
    const rows = new Map(byHeader(read).map((row) => [row["Lead ID"]!, row]));
    for (let i = 0; i < 50; i += 1) {
      const row = rows.get(leadId(i))!;
      expect(row["Company ID"]).toBe(COMPANY.a);
      expect(row["Estimated value"]).toBe(leadValue(i) ?? "");
      expect(row.Currency).toBe(leadCurrency(i) ?? "");
      expect(row.Status).toBe("New");
      expect(row["Updated at"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      for (const column of ["Lead", "Company", "Owner", "Source"]) expect(spreadsheetWouldEvaluate(row[column]!), `${leadId(i)} ${column}`).toBe(false);
    }
    expect(rows.get(leadId(1))!.Company).toBe("'=cmd|' /C calc'!A0");
    expect(rows.get(leadId(2))!.Company).toBe("'-120.50");
    expect(rows.get(leadId(6))!.Company).toBe("0042");
    expect(rows.get(leadId(7))!.Company).toBe('Çelësi, "ë"\nrresht i dytë');
    expect(new TextDecoder().decode((await call(salesExport, "/api/sales/export?type=leads&search=AUD08B-L-", owner)).bytes)).not.toContain("internal note");
  });

  it("DT-02 keeps the Archived and Mine restrictions the list applies", async () => {
    await seedLeads();
    const owner = await loginAs("OWNER");
    const archived = byHeader((await call(salesExport, "/api/sales/export?type=leads&search=AUD08B-L-&archived=1&sort=name-asc", owner)).csv());
    expect(archived.map((row) => row["Lead ID"])).toEqual([50, 51, 52, 53, 54, 55, 56].map(leadId));
    const mine = byHeader((await call(salesExport, "/api/sales/export?type=leads&search=AUD08B-L-&mine=1&sort=name-asc", owner)).csv());
    expect(mine.map((row) => row["Lead ID"])).toEqual([3, 4, 5].map(leadId));
  });

  it("DT-03 refuses a filter the list would drop, a filter it does not know and an export that does not exist", async () => {
    await seedLeads();
    const owner = await loginAs("OWNER");
    expectRefusedWithoutFile(await call(salesExport, "/api/sales/export?type=leads&search=AUD08B-L-&status=NEWW", owner), 422, "EXPORT_FILTER_INVALID");
    expectRefusedWithoutFile(await call(salesExport, "/api/sales/export?type=leads&search=AUD08B-L-&stage=NEGOTIATION", owner), 422, "EXPORT_FILTER_INVALID");
    expectRefusedWithoutFile(await call(salesExport, "/api/sales/export?type=leads&search=AUD08B-L-&sort=value-sideways", owner), 422, "EXPORT_FILTER_INVALID");
    expectRefusedWithoutFile(await call(salesExport, "/api/sales/export?type=everything", owner), 422, "EXPORT_FILTER_INVALID");
    // Positive control: the list's own spelling, case-insensitive as the list reads it.
    const ok = await call(salesExport, "/api/sales/export?type=leads&search=AUD08B-L-&status=new", owner);
    expect(ok.status).toBe(200);
    expect(ok.csv().rows).toHaveLength(50);
  });

  it("DT-22 refuses another company's id and exports nothing of Company A to another tenant, while the owner's own company works", async () => {
    await seedLeads();
    const owner = await loginAs("OWNER");
    expectRefusedWithoutFile(await call(salesExport, `/api/sales/export?type=leads&search=AUD08B-L-&company=${COMPANY.b}`, owner), 422, "EXPORT_COMPANY_OUT_OF_SCOPE");
    const own = await call(salesExport, `/api/sales/export?type=leads&search=AUD08B-L-&company=${COMPANY.a}`, owner);
    expect(own.status).toBe(200);
    expect(own.csv().rows).toHaveLength(50);

    const tenant = await loginAsEmail(DEMO_EMAIL.tenantOwner);
    const foreign = await call(salesExport, "/api/sales/export?type=leads&search=AUD08B-L-", tenant);
    expect([200, 403]).toContain(foreign.status);
    expect(foreign.text).not.toContain(PREFIX);
    if (foreign.status === 200) expect(foreign.csv().rows).toHaveLength(0);

    const signedOut = await call(salesExport, "/api/sales/export?type=leads", null);
    expect(signedOut.status).toBe(401);
  });
});

/* -------------------------------------------------------------------------- */
/* DT-17: the row cap                                                          */
/* -------------------------------------------------------------------------- */

describe("DT-17 the row cap refuses whole and never truncates", () => {
  it("refuses 1,001 leads with a JSON explanation and no file, then exports exactly 1,000", async () => {
    await prisma.lead.createMany({
      data: Array.from({ length: 1001 }, (_, i) => ({
        id: `${PREFIX}_cap_${pad(i, 4)}`,
        companyId: COMPANY.a,
        name: `AUD08B-CAP-${pad(i, 4)}`,
        source: "OTHER" as const,
        ownerMemberId: "member_owner",
        createdByMemberId: "member_owner",
      })),
    });
    const owner = await loginAs("OWNER");
    const refused = await call(salesExport, "/api/sales/export?type=leads&search=AUD08B-CAP-", owner);
    const body = expectRefusedWithoutFile(refused, 422, "EXPORT_LIMIT_EXCEEDED");
    expect(body.error.message).toBe("Too many records to export. Narrow your filters to 1,000 records or fewer.");
    expect(await prisma.auditEvent.count({ where: { entityType: "export", entityId: "sales", actorUserId: owner.userId, occurredAt: { gte: startedAt } } })).toBe(0);

    await prisma.lead.delete({ where: { id: `${PREFIX}_cap_0000` } });
    const full = await call(salesExport, "/api/sales/export?type=leads&search=AUD08B-CAP-&sort=name-asc", owner);
    expect(full.status).toBe(200);
    const rows = full.csv().rows;
    expect(rows).toHaveLength(1000);
    expect(full.headers.get("x-export-row-count")).toBe("1000");
    expect(rows.map((row) => row[1])).toEqual(Array.from({ length: 1000 }, (_, i) => `${PREFIX}_cap_${pad(i + 1, 4)}`));
    // The export that left is recorded — who and which, not the rows.
    expect(await prisma.auditEvent.count({ where: { entityType: "export", entityId: "sales", actorUserId: owner.userId, occurredAt: { gte: startedAt } } })).toBe(1);
  }, 60_000);
});

/* -------------------------------------------------------------------------- */
/* DT-16: one snapshot, with a real concurrent writer                          */
/* -------------------------------------------------------------------------- */

/**
 * Holds an exclusive lock on `table` in a writer transaction, starts the
 * export, waits until the export is blocked reading that table — after its
 * earlier statements have run — then writes `change` and commits. The export
 * resumes afterwards; everything it returns must come from one moment.
 */
async function exportDuringWrite(table: string, start: () => Promise<Called>, change: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<unknown>): Promise<Called> {
  let locked!: () => void;
  const lockHeld = new Promise<void>((resolve) => (locked = resolve));
  let exporting: Promise<Called> | null = null;
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`LOCK TABLE "${table}" IN ACCESS EXCLUSIVE MODE`);
      locked();
      await lockHeld;
      exporting = start();
      const deadline = Date.now() + 10_000;
      for (;;) {
        const [{ waiting }] = await prisma.$queryRawUnsafe<Array<{ waiting: number }>>(
          `SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%FROM "public"."${table}"%'`,
        );
        if (waiting > 0) break;
        if (Date.now() > deadline) throw new Error(`the export never reached "${table}"`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await change(tx);
    },
    { timeout: 20_000, maxWait: 5_000 },
  );
  return exporting!;
}

describe("DT-16 an export is one consistent snapshot under a concurrent writer", () => {
  it("leads: the rows, their count and the owner names all come from before the write", async () => {
    await prisma.lead.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({ id: `${PREFIX}_snap_${i}`, companyId: COMPANY.a, name: `AUD08B-SNAP-${i}`, source: "OTHER" as const, currency: "XTS", ownerMemberId: "member_owner", createdByMemberId: "member_owner" })),
    });
    const owner = await loginAs("OWNER");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: owner.userId }, select: { firstName: true, lastName: true } });
    restore.push(() => prisma.user.update({ where: { id: owner.userId }, data: { lastName: user.lastName } }));

    const response = await exportDuringWrite(
      "users",
      () => call(salesExport, "/api/sales/export?type=leads&currency=XTS&sort=name-asc", owner),
      async (tx) => {
        await tx.lead.create({ data: { id: `${PREFIX}_snap_new`, companyId: COMPANY.a, name: "AUD08B-SNAP-9", source: "OTHER", currency: "XTS", ownerMemberId: "member_owner", createdByMemberId: "member_owner" } });
        await tx.lead.update({ where: { id: `${PREFIX}_snap_0` }, data: { status: "CONTACTED" } });
        await tx.user.update({ where: { id: owner.userId }, data: { lastName: "Renamed-AUD08B" } });
      },
    );
    expect(response.status).toBe(200);
    const rows = byHeader(response.csv());
    expect(rows.map((row) => row["Lead ID"])).toEqual([0, 1, 2, 3, 4].map((i) => `${PREFIX}_snap_${i}`));
    expect(rows.map((row) => row.Status)).toEqual(["New", "New", "New", "New", "New"]);
    expect(new Set(rows.map((row) => row.Owner))).toEqual(new Set([`${user.firstName} ${user.lastName}`]));
    expect(response.headers.get("x-export-row-count")).toBe("5");

    // Positive control: the write did happen, and the next export sees all of it.
    const after = byHeader((await call(salesExport, "/api/sales/export?type=leads&currency=XTS&sort=name-asc", owner)).csv());
    expect(after).toHaveLength(6);
    expect(after[0]!.Status).toBe("Contacted");
    expect(after[0]!.Owner).toBe(`${user.firstName} Renamed-AUD08B`);
  }, 30_000);

  it("invoices: rows, row count, settlement and client names agree with each other while a payment and an invoice land", async () => {
    const creator = await prisma.companyMember.findUniqueOrThrow({ where: { id: "member_finance" }, select: { userId: true } });
    await prisma.client.create({ data: { id: `${PREFIX}_client`, companyId: COMPANY.a, name: "AUD08B Snapshot Client", createdBy: creator.userId } });
    const invoice = (i: number) => ({
      id: `${PREFIX}_inv_${i}`,
      companyId: COMPANY.a,
      invoiceNumber: `AUD08B-INV-${i}`,
      clientId: `${PREFIX}_client`,
      projectId: PROJECT.a,
      issueDate: new Date(Date.UTC(2026, 4, 10 + i)),
      dueDate: new Date(Date.UTC(2030, 0, 1)),
      currency: "EUR",
      subtotal: "100.00",
      taxAmount: "0.00",
      totalAmount: "100.00",
      status: "SENT" as const,
      createdByMemberId: "member_finance",
    });
    await prisma.invoice.createMany({ data: [0, 1, 2].map(invoice) });
    const finance = await loginAs("FINANCE");

    const response = await exportDuringWrite(
      "clients",
      () => call(invoicesExport, `/api/finance/invoices/export?clientId=${PREFIX}_client&sort=issue-desc`, finance),
      async (tx) => {
        await tx.client.update({ where: { id: `${PREFIX}_client` }, data: { name: "AUD08B Renamed Client" } });
        await tx.invoice.create({ data: invoice(3) });
        await tx.payment.create({ data: { id: `${PREFIX}_pay`, companyId: COMPANY.a, direction: "RECEIPT", clientId: `${PREFIX}_client`, amount: "100.00", currency: "EUR", paymentDate: new Date(Date.UTC(2026, 4, 30)), method: "BANK_TRANSFER", createdByMemberId: "member_finance" } });
        await tx.paymentAllocation.create({ data: { companyId: COMPANY.a, paymentId: `${PREFIX}_pay`, invoiceId: `${PREFIX}_inv_0`, amount: "100.00", createdByMemberId: "member_finance" } });
      },
    );
    expect(response.status).toBe(200);
    const rows = byHeader(response.csv());
    expect(rows.map((row) => row["Invoice ID"])).toEqual([2, 1, 0].map((i) => `${PREFIX}_inv_${i}`));
    expect(response.headers.get("x-export-row-count")).toBe("3");
    expect(new Set(rows.map((row) => row.Client))).toEqual(new Set(["AUD08B Snapshot Client"]));
    expect(rows.map((row) => [row.Paid, row.Outstanding, row.Settlement])).toEqual([
      ["0.00", "100.00", "Unpaid"],
      ["0.00", "100.00", "Unpaid"],
      ["0.00", "100.00", "Unpaid"],
    ]);

    const after = byHeader((await call(invoicesExport, `/api/finance/invoices/export?clientId=${PREFIX}_client&sort=issue-desc`, finance)).csv());
    expect(after.map((row) => row["Invoice ID"])).toEqual([3, 2, 1, 0].map((i) => `${PREFIX}_inv_${i}`));
    expect(after[3]).toMatchObject({ Client: "AUD08B Renamed Client", Paid: "100.00", Outstanding: "0.00", Settlement: "Paid" });
  }, 30_000);
});

/* -------------------------------------------------------------------------- */
/* DT-02: the section and the page's own filters reach the export              */
/* -------------------------------------------------------------------------- */

describe("DT-02 section and page filters survive into the file", () => {
  it("contracts: the archived and active sections export only their own contracts", async () => {
    const legal = await loginAs("LEGAL");
    const archivedIds = (await prisma.contract.findMany({ where: { companyId: COMPANY.a, archivedAt: { not: null } }, select: { id: true } })).map((row) => row.id).sort();
    const activeIds = (await prisma.contract.findMany({ where: { companyId: COMPANY.a, archivedAt: null, status: "ACTIVE" }, select: { id: true } })).map((row) => row.id).sort();
    const liveIds = (await prisma.contract.findMany({ where: { companyId: COMPANY.a, archivedAt: null }, select: { id: true } })).map((row) => row.id).sort();
    expect(archivedIds.length).toBeGreaterThan(0);
    expect(activeIds.length).toBeGreaterThan(0);

    const ids = async (query: string) => byHeader((await call(contractsExport, `/api/contracts/export?${query}`, legal)).csv()).map((row) => row["Contract ID"]!).sort();
    expect(await ids("type=contracts&view=archived")).toEqual(archivedIds);
    expect(await ids("type=contracts&view=active")).toEqual(activeIds);
    expect(await ids("type=contracts")).toEqual(liveIds);
    expectRefusedWithoutFile(await call(contractsExport, "/api/contracts/export?type=contracts&view=binned", legal), 422, "EXPORT_FILTER_INVALID");
  });

  it("QA/QC inspections: the list's `type` filter narrows the file, as it narrows the page", async () => {
    const qaqc = await loginAs("QAQC");
    const work = (await prisma.qualityInspection.findMany({ where: { companyId: COMPANY.a, inspectionType: "WORK" }, select: { id: true } })).map((row) => row.id).sort();
    expect(work.length).toBeGreaterThan(0);
    const response = await call(qaqcExport, "/api/qaqc/export?kind=inspections&type=WORK", qaqc);
    expect(response.status).toBe(200);
    const rows = byHeader(response.csv());
    expect(rows.map((row) => row["Inspection ID"]!).sort()).toEqual(work);
    expect(new Set(rows.map((row) => row.Type))).toEqual(new Set(["Work"]));
    expectRefusedWithoutFile(await call(qaqcExport, "/api/qaqc/export?kind=inspections&type=WROK", qaqc), 422, "VALIDATION_ERROR");
  });
});

/* -------------------------------------------------------------------------- */
/* DT-15: redaction                                                            */
/* -------------------------------------------------------------------------- */

describe("DT-15 the file never carries a column the reader may not see", () => {
  it("contracts: value and currency for a commercial reader, absent — not blank — without the permission", async () => {
    const legal = await loginAs("LEGAL");
    const full = (await call(contractsExport, "/api/contracts/export?type=contracts", legal)).csv();
    expect(full.header.slice(-2)).toEqual(["Currency", "Value"]);
    for (const row of byHeader(full)) {
      expect(row.Value).toMatch(/^(-?\d+\.\d{2})?$/);
      expect(row["Company ID"]).toBe(COMPANY.a);
    }
    // The same person under a role without `legal.commercial.view` (AUD-06 custom roles).
    const narrowed: UserContext = { ...legal, permissions: legal.permissions.filter((permission) => permission !== "legal.commercial.view") };
    const limited = await call(contractsExport, "/api/contracts/export?type=contracts", narrowed);
    expect(limited.status).toBe(200);
    expect(limited.csv().header).not.toContain("Value");
    expect(limited.csv().header).not.toContain("Currency");
    expect(limited.csv().rows).toHaveLength(full.rows.length);
  });
});

/* -------------------------------------------------------------------------- */
/* DT-22: foreign project and record ids                                       */
/* -------------------------------------------------------------------------- */

describe("DT-22 a foreign project or record id exports nothing, never everything", () => {
  it("QA/QC and HSE: another company's project matches no rows; the reader's own project does", async () => {
    const qaqc = await loginAs("QAQC");
    const foreign = await call(qaqcExport, `/api/qaqc/export?kind=inspections&projectId=${PROJECT.b}`, qaqc);
    expect(foreign.status).toBe(200);
    expect(foreign.csv().rows).toHaveLength(0);
    const own = byHeader((await call(qaqcExport, `/api/qaqc/export?kind=inspections&projectId=${PROJECT.a}`, qaqc)).csv());
    expect(own.length).toBeGreaterThan(0);
    expect(new Set(own.map((row) => row["Project ID"]))).toEqual(new Set([PROJECT.a]));

    const foreignNcr = await prisma.nonConformanceReport.findFirst({ where: { companyId: { not: COMPANY.a } }, select: { id: true } });
    if (foreignNcr) {
      const actions = await call(qaqcExport, `/api/qaqc/export?kind=corrective-actions&ncrId=${foreignNcr.id}`, qaqc);
      expect(actions.status).toBe(200);
      expect(actions.csv().rows).toHaveLength(0);
    }

    const hse = await loginAs("HSE");
    const hazardsElsewhere = await call(hseExport, `/api/hse/export?kind=hazards&projectId=${PROJECT.b}`, hse);
    expect(hazardsElsewhere.status).toBe(200);
    expect(hazardsElsewhere.csv().rows).toHaveLength(0);
    const hazards = byHeader((await call(hseExport, `/api/hse/export?kind=hazards&projectId=${PROJECT.a}`, hse)).csv());
    expect(hazards.length).toBeGreaterThan(0);
    expect(new Set(hazards.map((row) => row["Project ID"]))).toEqual(new Set([PROJECT.a]));
    expectRefusedWithoutFile(await call(hseExport, "/api/hse/export?kind=hazards&projectId=a%20b", hse), 422, "EXPORT_FILTER_INVALID");
  });

  it("refuses an export to a reader without the export grant, however the query is shaped", async () => {
    const ceo = await loginAs("CEO");
    for (const [route, path] of [
      [salesExport, "/api/sales/export?type=leads"],
      [qaqcExport, "/api/qaqc/export?kind=inspections"],
    ] as const) {
      const response = await call(route, path, ceo);
      expect(response.status, path).toBe(403);
      expect(response.headers.get("content-disposition"), path).toBeNull();
    }
  });
});
