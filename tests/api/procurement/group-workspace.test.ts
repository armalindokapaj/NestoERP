import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Permission } from "@/config/permissions";
import { AccessError } from "@/lib/access/guards";
import { resolveModuleExperience } from "@/lib/access/module-access";
import type { UserContext } from "@/lib/context/types";
import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import * as orders from "@/lib/modules/procurement/orders/order.service";
import {
  procurementAttentionForWorkspace,
  procurementOverview,
  procurementOverviewForWorkspace,
} from "@/lib/modules/procurement/overview/overview.service";
import {
  orderListQuerySchema,
  requestListQuerySchema,
  supplierListQuerySchema,
} from "@/lib/modules/procurement/procurement.schema";
import {
  mergeCurrencyTotals,
  narrowToCompany,
  resolveProcurementExperience,
} from "@/lib/modules/procurement/procurement.workspace";
import { procurementReports, procurementReportsForWorkspace } from "@/lib/modules/procurement/reports/reports.service";
import * as requests from "@/lib/modules/procurement/requests/request.service";
import * as suppliers from "@/lib/modules/procurement/suppliers/supplier.service";
import { cleanupSessions, COMPANY, loginAs, prisma } from "../../helpers";

/**
 * Procurement in the Group workspace (Workspace Context §38, §41, §45, §72).
 *
 * Real sessions, real resolver, real database. The demo group's Owner and its
 * Group Procurement head hold group standing; the demo Project Manager does not.
 * Only Aurelia (A) has a buying book in the seed, so the tests add a small one
 * to Meridian (B) and Forma (D) and remove it again: a supplier that shares a
 * name with Aurelia's, a request each, and an order each, the one in B in lek
 * and the one in D in euro like Aurelia's.
 */

const TAG = "VtWsPc";
const created = { orders: [] as string[], requests: [] as string[], suppliers: [] as string[] };
const restore: Array<() => Promise<unknown>> = [];

const all = { limit: 100 };
const requestAll = requestListQuerySchema.parse(all);
const orderAll = orderListQuerySchema.parse(all);
const supplierAll = supplierListQuerySchema.parse(all);

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

const group = (role: Parameters<typeof loginAs>[0]) => loginAs(role, { workspace: "GROUP" });

async function memberIn(companyId: string, userId: string): Promise<string> {
  return (await prisma.companyMember.findFirstOrThrow({ where: { companyId, userId }, select: { id: true } })).id;
}

/** A supplier, a request and an order in one company, all named so the test can find them. */
async function seedBook(companyId: string, userId: string, spec: { currency: string; total: string; supplierName: string }) {
  const memberId = await memberIn(companyId, userId);
  const supplier = await prisma.supplier.create({
    data: {
      companyId,
      code: `${TAG}-${companyId.slice(-1)}`,
      name: spec.supplierName,
      normalizedName: spec.supplierName.toLowerCase(),
      createdByMemberId: memberId,
    },
  });
  const request = await prisma.purchaseRequest.create({
    data: {
      companyId,
      requestNumber: `${TAG}-PR-${companyId.slice(-1)}`,
      title: `${TAG} request in ${companyId}`,
      requestedByMemberId: memberId,
      createdByMemberId: memberId,
      currency: spec.currency,
      estimatedTotal: spec.total,
      status: "PENDING_APPROVAL",
      items: { create: [{ description: `${TAG} line`, quantity: "1", unit: "pc", estimatedAmount: spec.total }] },
    },
  });
  const order = await prisma.purchaseOrder.create({
    data: {
      companyId,
      poNumber: `${TAG}-PO-${companyId.slice(-1)}`,
      supplierId: supplier.id,
      orderDate: new Date(),
      // In the past, so it is overdue and reaches the attention panel.
      requiredDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      currency: spec.currency,
      subtotal: spec.total,
      taxAmount: "0",
      totalAmount: spec.total,
      status: "ISSUED",
      createdByMemberId: memberId,
      items: {
        create: [
          { description: `${TAG} line`, quantity: "1", unit: "pc", unitPrice: spec.total, taxRate: "0", subtotal: spec.total, taxAmount: "0", totalAmount: spec.total },
        ],
      },
    },
  });
  created.suppliers.push(supplier.id);
  created.requests.push(request.id);
  created.orders.push(order.id);
  return { supplier, request, order };
}

let book: {
  b: Awaited<ReturnType<typeof seedBook>>;
  d: Awaited<ReturnType<typeof seedBook>>;
};

beforeAll(async () => {
  const owner = await loginAs("OWNER");
  book = {
    // Aurelia already has an "Atlas Materials"; Meridian's is the same legal entity, a separate row.
    b: await seedBook(COMPANY.b, owner.userId, { currency: "ALL", total: "1000000.00", supplierName: "Atlas Materials" }),
    d: await seedBook(COMPANY.d, owner.userId, { currency: "EUR", total: "2500.00", supplierName: `${TAG} Forma Supplies` }),
  };
});

afterEach(async () => {
  for (const undo of restore.splice(0).reverse()) await undo();
});

afterAll(async () => {
  await prisma.purchaseOrder.deleteMany({ where: { id: { in: created.orders } } });
  await prisma.purchaseRequest.deleteMany({ where: { id: { in: created.requests } } });
  await prisma.supplier.deleteMany({ where: { id: { in: created.suppliers } } });
  await cleanupSessions();
  await prisma.$disconnect();
});

/** The person's real context in every company the group workspace reads for this action. */
const contextsFor = (session: UserContext, permission: Permission) =>
  resolveWorkspaceContexts(session, { module: "procurement", permission });

describe("requests (§38, §45)", () => {
  it("lists every authorised company's requests, each labelled with its company", async () => {
    const owner = await group("OWNER");
    expect(owner.workspace.scopeType).toBe("GROUP");

    const result = await requests.listRequestsForWorkspace(owner, requestAll);
    const companies = new Set(result.data.map((row) => row.company?.id));
    expect(companies).toContain(COMPANY.a);
    expect(companies).toContain(COMPANY.b);
    expect(companies).toContain(COMPANY.d);

    // Every row names its own company, and the name is that company's.
    const names = new Map((await prisma.company.findMany({ select: { id: true, name: true } })).map((row) => [row.id, row.name]));
    for (const row of result.data) {
      expect(row.company).toBeDefined();
      expect(row.company!.name).toBe(names.get(row.company!.id));
    }
    expect(ids(result.data)).toContain(book.b.request.id);
    expect(ids(result.data)).toContain(book.d.request.id);
  });

  it("is exactly the union of what each company's own page shows", async () => {
    const owner = await group("OWNER");
    const contexts = await contextsFor(owner, "procurement.request.view");
    expect(contexts.length).toBeGreaterThanOrEqual(3);

    const union = new Set<string>();
    for (const context of contexts) for (const id of ids((await requests.listRequests(context, requestAll)).data)) union.add(id);

    const result = await requests.listRequestsForWorkspace(owner, requestAll);
    expect(new Set(ids(result.data))).toEqual(union);
    expect(result.pagination.total).toBe(union.size);
  });

  it("answers a company workspace with that company only, unlabelled and unchanged", async () => {
    const owner = await loginAs("OWNER");
    expect(owner.workspace.scopeType).toBe("COMPANY");

    const viaWorkspace = await requests.listRequestsForWorkspace(owner, requestAll);
    expect(viaWorkspace).toEqual(await requests.listRequests(owner, requestAll));
    expect(viaWorkspace.data.every((row) => row.company === undefined)).toBe(true);
    // Whichever company the session is in, the other test company's request is not in it.
    const other = owner.companyId === COMPANY.b ? book.d.request.id : book.b.request.id;
    expect(ids(viaWorkspace.data)).not.toContain(other);
  });

  it("narrows to the company chosen in the filter", async () => {
    const owner = await group("OWNER");
    const result = await requests.listRequestsForWorkspace(owner, requestListQuerySchema.parse({ ...all, companyId: COMPANY.b }));
    expect(result.data.length).toBeGreaterThan(0);
    expect(new Set(result.data.map((row) => row.company?.id))).toEqual(new Set([COMPANY.b]));
    expect(ids(result.data)).toContain(book.b.request.id);
  });

  it("ignores a company filter it may not read, without saying whether it exists", async () => {
    const owner = await group("OWNER");
    const unfiltered = await requests.listRequestsForWorkspace(owner, requestAll);

    // Another group's company, and one that does not exist: both are simply not a narrowing.
    for (const companyId of [COMPANY.tenant, "company_that_does_not_exist"]) {
      const result = await requests.listRequestsForWorkspace(owner, requestListQuerySchema.parse({ ...all, companyId }));
      expect(ids(result.data)).toEqual(ids(unfiltered.data));
      expect(result.pagination.total).toBe(unfiltered.pagination.total);
    }
  });

  it("leaves out a company where the module is off, and narrowing to it does not bring it back", async () => {
    const row = await prisma.companyModule.findFirstOrThrow({ where: { companyId: COMPANY.d, module: { key: "procurement" } } });
    await prisma.companyModule.update({ where: { id: row.id }, data: { enabled: false } });
    restore.push(() => prisma.companyModule.update({ where: { id: row.id }, data: { enabled: true } }));

    const owner = await group("OWNER");
    const result = await requests.listRequestsForWorkspace(owner, requestAll);
    const seen = new Set(result.data.map((entry) => entry.company?.id));
    expect(seen).toContain(COMPANY.a);
    expect(seen).toContain(COMPANY.b);
    expect(seen).not.toContain(COMPANY.d);
    expect(ids(result.data)).not.toContain(book.d.request.id);

    const narrowed = await requests.listRequestsForWorkspace(owner, requestListQuerySchema.parse({ ...all, companyId: COMPANY.d }));
    expect(narrowed.data.some((entry) => entry.company?.id === COMPANY.d)).toBe(false);

    const options = await requests.requestFilterOptionsForWorkspace(owner);
    expect(options.companies.map((option) => option.value)).not.toContain(COMPANY.d);
  });

  it("pages and sorts over the whole group, not one company at a time", async () => {
    const owner = await group("OWNER");
    const full = await requests.listRequestsForWorkspace(owner, requestListQuerySchema.parse({ ...all, sort: "number-asc" }));
    const first = await requests.listRequestsForWorkspace(owner, requestListQuerySchema.parse({ limit: 4, page: 1, sort: "number-asc" }));
    const second = await requests.listRequestsForWorkspace(owner, requestListQuerySchema.parse({ limit: 4, page: 2, sort: "number-asc" }));

    expect(ids(first.data)).toEqual(ids(full.data).slice(0, 4));
    expect(ids(second.data)).toEqual(ids(full.data).slice(4, 8));
    expect(first.pagination.total).toBe(full.pagination.total);
    const numbers = full.data.map((row) => row.requestNumber);
    expect(numbers).toEqual([...numbers].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it("reads 'mine' as the person's own requests in each company", async () => {
    const owner = await group("OWNER");
    const contexts = await contextsFor(owner, "procurement.request.view");
    const expected = new Set<string>();
    for (const context of contexts) {
      for (const id of ids((await requests.listRequests(context, requestListQuerySchema.parse({ ...all, view: "mine" }))).data)) expected.add(id);
    }
    const result = await requests.listRequestsForWorkspace(owner, requestListQuerySchema.parse({ ...all, view: "mine" }));
    expect(new Set(ids(result.data))).toEqual(expected);
    expect(ids(result.data)).toContain(book.b.request.id);
  });

  it("gives a person without group standing nothing extra", async () => {
    // The Project Manager asks for the group and is answered in their own company (§16, §82).
    const pm = await group("PROJECT_MANAGER");
    expect(pm.workspace.scopeType).toBe("COMPANY");
    const result = await requests.listRequestsForWorkspace(pm, requestAll);
    expect(result).toEqual(await requests.listRequests(pm, requestAll));
    expect(ids(result.data)).not.toContain(book.b.request.id);
    expect(ids(result.data)).not.toContain(book.d.request.id);
    expect(result.data.every((row) => row.company === undefined)).toBe(true);
  });

  it("refuses a group session that holds Procurement in none of its companies", async () => {
    const it = await group("GROUP_IT");
    expect(it.workspace.scopeType).toBe("GROUP");
    await expect(requests.listRequestsForWorkspace(it, requestAll)).rejects.toBeInstanceOf(AccessError);
  });
});

describe("orders (§38, §45, §72)", () => {
  it("lists every company's orders with their own currency, never a combined value", async () => {
    const owner = await group("OWNER");
    const result = await orders.listOrdersForWorkspace(owner, orderAll);

    const b = result.data.find((row) => row.id === book.b.order.id)!;
    const d = result.data.find((row) => row.id === book.d.order.id)!;
    expect(b.company).toEqual({ id: COMPANY.b, name: expect.any(String) });
    expect(d.company).toEqual({ id: COMPANY.d, name: expect.any(String) });
    expect([b.currency, b.totalAmount]).toEqual(["ALL", "1000000.00"]);
    expect([d.currency, d.totalAmount]).toEqual(["EUR", "2500.00"]);
    expect(result.data.some((row) => row.company?.id === COMPANY.a)).toBe(true);
  });

  it("is exactly the union of what each company's own page shows, and filters by currency across them", async () => {
    const owner = await group("OWNER");
    const contexts = await contextsFor(owner, "procurement.order.view");

    const union = new Set<string>();
    for (const context of contexts) for (const id of ids((await orders.listOrders(context, orderAll)).data)) union.add(id);
    expect(new Set(ids((await orders.listOrdersForWorkspace(owner, orderAll)).data))).toEqual(union);

    const lek = await orders.listOrdersForWorkspace(owner, orderListQuerySchema.parse({ ...all, currency: "ALL" }));
    expect(ids(lek.data)).toEqual([book.b.order.id]);
  });

  it("narrows by company and keeps a company workspace to its own company", async () => {
    const owner = await group("OWNER");
    const narrowed = await orders.listOrdersForWorkspace(owner, orderListQuerySchema.parse({ ...all, companyId: COMPANY.d }));
    expect(new Set(narrowed.data.map((row) => row.company?.id))).toEqual(new Set([COMPANY.d]));

    const inB = await loginAs("OWNER");
    const company = await orders.listOrdersForWorkspace(inB, orderListQuerySchema.parse({ ...all, companyId: COMPANY.d }));
    // The filter is not read in a company workspace: this is the session's own company, whatever it asks.
    expect(company).toEqual(await orders.listOrders(inB, orderAll));
    expect(company.data.every((row) => row.company === undefined)).toBe(true);
  });

  it("offers the group's suppliers with their company, and the currencies of every company", async () => {
    const owner = await group("OWNER");
    const options = await orders.orderFilterOptionsForWorkspace(owner);
    expect(options.currencies).toEqual(expect.arrayContaining(["ALL", "EUR"]));
    expect(options.companies.map((option) => option.value)).toEqual(expect.arrayContaining([COMPANY.a, COMPANY.b, COMPANY.d]));
    const atlas = options.suppliers.filter((supplier) => supplier.name === "Atlas Materials");
    expect(atlas.map((supplier) => supplier.company?.name).length).toBe(2);
  });
});

describe("suppliers (§38, §45)", () => {
  it("lists the same supplier in two companies as two rows, each with its company", async () => {
    const owner = await group("OWNER");
    const result = await suppliers.listSuppliersForWorkspace(owner, supplierAll);
    const atlas = result.data.filter((row) => row.name === "Atlas Materials");

    expect(atlas.length).toBe(2);
    expect(new Set(atlas.map((row) => row.id)).size).toBe(2);
    expect(new Set(atlas.map((row) => row.company?.id))).toEqual(new Set([COMPANY.a, COMPANY.b]));
    // Each row counts its own company's open orders only.
    expect(atlas.find((row) => row.company?.id === COMPANY.b)!.openOrders).toBe(1);
  });

  it("is the union of each company's directory and narrows by company", async () => {
    const owner = await group("OWNER");
    const contexts = await contextsFor(owner, "procurement.supplier.view");
    const union = new Set<string>();
    for (const context of contexts) for (const id of ids((await suppliers.listSuppliers(context, supplierAll)).data)) union.add(id);
    expect(new Set(ids((await suppliers.listSuppliersForWorkspace(owner, supplierAll)).data))).toEqual(union);

    const narrowed = await suppliers.listSuppliersForWorkspace(owner, supplierListQuerySchema.parse({ ...all, companyId: COMPANY.d }));
    expect(ids(narrowed.data)).toEqual([book.d.supplier.id]);
  });

  it("does not change a company workspace's answer", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    expect(await suppliers.listSuppliersForWorkspace(pm, supplierAll)).toEqual(await suppliers.listSuppliers(pm, supplierAll));
  });
});

describe("overview (§38, §72, §73)", () => {
  it("adds each company's own counts and keeps the breakdown behind the total", async () => {
    const owner = await group("OWNER");
    const contexts = await contextsFor(owner, "procurement.view");
    const perCompany = await Promise.all(contexts.map((context) => procurementOverview(context)));

    const overview = await procurementOverviewForWorkspace(owner);
    expect(overview.openRequests).toBe(perCompany.reduce((sum, row) => sum + row.openRequests, 0));
    expect(overview.ordersAwaitingReceipt).toBe(perCompany.reduce((sum, row) => sum + row.ordersAwaitingReceipt, 0));
    expect(overview.overdueOrders).toBe(perCompany.reduce((sum, row) => sum + row.overdueOrders, 0));

    expect(overview.companies!.map((row) => row.company.id)).toEqual(expect.arrayContaining([COMPANY.a, COMPANY.b, COMPANY.d]));
    const inB = overview.companies!.find((row) => row.company.id === COMPANY.b)!;
    expect(inB.openRequests).toBe(1);
    expect(inB.committedValue).toEqual([{ currency: "ALL", count: 1, value: "1000000.00" }]);
  });

  it("adds a currency across companies and never one currency into another", async () => {
    const owner = await group("OWNER");
    const contexts = await contextsFor(owner, "procurement.view");
    const perCompany = await Promise.all(contexts.map((context) => procurementOverview(context)));
    const euro = perCompany.flatMap((row) => row.committedValue ?? []).filter((total) => total.currency === "EUR");
    const expectedEuro = euro.reduce((sum, total) => sum + Number(total.value), 0);

    const { committedValue } = await procurementOverviewForWorkspace(owner);
    expect(committedValue!.map((total) => total.currency)).toEqual(["ALL", "EUR"]);
    expect(Number(committedValue!.find((total) => total.currency === "EUR")!.value)).toBeCloseTo(expectedEuro, 2);
    expect(euro.length).toBeGreaterThanOrEqual(2);
    // The lek order is a line of its own, not part of the euro figure.
    expect(committedValue!.find((total) => total.currency === "ALL")).toEqual({ currency: "ALL", count: 1, value: "1000000.00" });
  });

  it("drops a company whose module is off from the total and the breakdown", async () => {
    const before = await procurementOverviewForWorkspace(await group("OWNER"));

    const row = await prisma.companyModule.findFirstOrThrow({ where: { companyId: COMPANY.b, module: { key: "procurement" } } });
    await prisma.companyModule.update({ where: { id: row.id }, data: { enabled: false } });
    restore.push(() => prisma.companyModule.update({ where: { id: row.id }, data: { enabled: true } }));

    const after = await procurementOverviewForWorkspace(await group("OWNER"));
    expect(after.companies!.map((entry) => entry.company.id)).not.toContain(COMPANY.b);
    expect(after.openRequests).toBe(before.openRequests - 1);
    expect(after.committedValue!.map((total) => total.currency)).not.toContain("ALL");
  });

  it("is the session's own company overview in a company workspace", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const overview = await procurementOverviewForWorkspace(pm);
    expect(overview).toEqual(await procurementOverview(pm));
    expect(overview.companies).toBeUndefined();
  });

  it("puts the most pressing rows of every company on the attention panels, labelled", async () => {
    const owner = await group("OWNER");
    const attention = await procurementAttentionForWorkspace(owner);

    const awaiting = attention.awaitingApproval.map((row) => row.company?.id);
    expect(awaiting.length).toBeGreaterThan(0);
    expect(awaiting.every(Boolean)).toBe(true);
    const overdue = attention.overdueOrders.map((row) => row.company?.id);
    expect(overdue.every(Boolean)).toBe(true);
    // The enquiry register is company work; its short panel still says whose each row is.
    expect(attention.rfqsClosingSoon.every((row) => row.company !== undefined)).toBe(true);
  });
});

describe("reports (§41, §45, §72)", () => {
  it("keeps a supplier that two companies share as two rows, each with its company", async () => {
    const owner = await group("OWNER");
    const reports = await procurementReportsForWorkspace(owner);

    const atlas = reports.spendBySupplier.filter((row) => row.label === "Atlas Materials");
    expect(atlas.map((row) => row.company?.id).sort()).toEqual([COMPANY.a, COMPANY.b].sort());
    expect(atlas.find((row) => row.company?.id === COMPANY.b)!.totals).toEqual([{ currency: "ALL", count: 1, value: "1000000.00" }]);
    // Every company-owned row carries its company; keys never collide across companies.
    expect(reports.spendBySupplier.every((row) => row.company)).toBe(true);
    expect(new Set(reports.spendByProject.map((row) => row.key)).size).toBe(reports.spendByProject.length);
    expect(reports.deliveryPerformance.every((row) => row.company)).toBe(true);
  });

  it("adds money per currency across companies and shows the same figures company by company", async () => {
    const owner = await group("OWNER");
    const contexts = await contextsFor(owner, "procurement.report.view");
    const perCompany = await Promise.all(contexts.map(async (context) => ({ context, reports: await procurementReports(context) })));

    const reports = await procurementReportsForWorkspace(owner);
    const currencies = reports.openOrders.totals.map((total) => total.currency);
    expect(currencies).toEqual(expect.arrayContaining(["ALL", "EUR"]));
    expect(reports.openOrders.count).toBe(perCompany.reduce((sum, row) => sum + row.reports.openOrders.count, 0));
    const euro = perCompany.flatMap((row) => row.reports.openOrders.totals).filter((total) => total.currency === "EUR");
    expect(Number(reports.openOrders.totals.find((total) => total.currency === "EUR")!.value)).toBeCloseTo(
      euro.reduce((sum, total) => sum + Number(total.value), 0),
      2,
    );

    // A category is one shared list: it adds across companies and belongs to none of them.
    expect(reports.spendByCategory.every((row) => row.company === undefined)).toBe(true);
    const categoryCount = reports.spendByCategory.reduce((sum, row) => sum + row.count, 0);
    expect(categoryCount).toBe(perCompany.reduce((sum, row) => sum + row.reports.spendByCategory.reduce((inner, category) => inner + category.count, 0), 0));

    const inB = reports.spendByCompany!.find((row) => row.company?.id === COMPANY.b)!;
    expect(inB.totals).toEqual([{ currency: "ALL", count: 1, value: "1000000.00" }]);
    expect(inB.count).toBe(1);
  });

  it("drops a company the person may not read reports in", async () => {
    const row = await prisma.companyModule.findFirstOrThrow({ where: { companyId: COMPANY.b, module: { key: "procurement" } } });
    await prisma.companyModule.update({ where: { id: row.id }, data: { enabled: false } });
    restore.push(() => prisma.companyModule.update({ where: { id: row.id }, data: { enabled: true } }));

    const reports = await procurementReportsForWorkspace(await group("OWNER"));
    expect(reports.spendByCompany!.map((entry) => entry.company?.id)).not.toContain(COMPANY.b);
    expect(reports.openOrders.totals.map((total) => total.currency)).not.toContain("ALL");
  });

  it("is the session's own company report in a company workspace", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const reports = await procurementReportsForWorkspace(pm);
    expect(reports).toEqual(await procurementReports(pm));
    expect(reports.spendByCompany).toBeUndefined();
  });
});

describe("the section bar and the helpers (§25, §29, §86)", () => {
  it("offers only the sections that have a group answer, in the group", async () => {
    const owner = await group("OWNER");
    const experience = await resolveProcurementExperience(owner);
    expect(experience.sections.map((section) => section.key)).toEqual(["overview", "requests", "orders", "suppliers", "reports"]);
    expect(experience.canCreate).toBe(false);
  });

  it("is the person's own experience in a company workspace", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    expect(await resolveProcurementExperience(pm)).toEqual(resolveModuleExperience(pm, "procurement"));
    const keys = (await resolveProcurementExperience(await loginAs("PROCUREMENT"))).sections.map((section) => section.key);
    expect(keys).toEqual(expect.arrayContaining(["rfqs", "approvals"]));
  });

  it("narrows only to a company it already reads, and adds a currency only to itself", async () => {
    const owner = await group("OWNER");
    const contexts = await contextsFor(owner, "procurement.request.view");
    expect(narrowToCompany(contexts, COMPANY.b).map((context) => context.companyId)).toEqual([COMPANY.b]);
    expect(narrowToCompany(contexts, COMPANY.tenant)).toEqual(contexts);
    expect(narrowToCompany(contexts, undefined)).toEqual(contexts);

    expect(
      mergeCurrencyTotals(
        [{ currency: "EUR", count: 1, value: "10.00" }, { currency: "ALL", count: 1, value: "5.00" }],
        [{ currency: "EUR", count: 2, value: "2.50" }],
        null,
      ),
    ).toEqual([
      { currency: "ALL", count: 1, value: "5.00" },
      { currency: "EUR", count: 3, value: "12.50" },
    ]);
  });
});
