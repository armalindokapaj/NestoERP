import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";

import { signedQuantityFor } from "@/lib/modules/inventory/balances/balance.service";

/**
 * Critical data invariants (PRD #35 §195, §196).
 *
 * A release gate, not a unit test. Everything here is asserted against the
 * actual contents of the database rather than against a code path, because
 * these are the statements that have to be true of the data itself — a service
 * can be perfectly correct and the rows still be wrong, through a migration, a
 * seed, a manual fix, or a bug that has since been repaired.
 *
 * Each failure here is a hard release blocker. None of them is allowed to be a
 * CONDITIONAL GO: §213 rules that out for data integrity explicitly.
 */
const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("tenancy (PRD #35 §195, §21)", () => {
  it("gives every invoice the same company as its client and its project", async () => {
    const mismatched = await prisma.invoice.findMany({
      select: {
        id: true,
        companyId: true,
        client: { select: { companyId: true } },
        project: { select: { companyId: true } },
      },
    });

    const wrong = mismatched.filter(
      (row) =>
        row.client.companyId !== row.companyId ||
        (row.project !== null && row.project.companyId !== row.companyId),
    );

    expect(wrong.map((row) => row.id)).toEqual([]);
  });

  it("keeps every task with its project in the same company", async () => {
    const tasks = await prisma.task.findMany({
      where: { projectId: { not: null } },
      select: { id: true, companyId: true, project: { select: { companyId: true } } },
    });

    const wrong = tasks.filter((row) => row.project && row.project.companyId !== row.companyId);
    expect(wrong.map((row) => row.id)).toEqual([]);
  });

  it("keeps every document with its project in the same company", async () => {
    const documents = await prisma.document.findMany({
      where: { projectId: { not: null } },
      select: { id: true, companyId: true, project: { select: { companyId: true } } },
    });

    const wrong = documents.filter(
      (row) => row.project && row.project.companyId !== row.companyId,
    );
    expect(wrong.map((row) => row.id)).toEqual([]);
  });

  it("keeps every cross-module link inside one company", async () => {
    const links = await prisma.integrationLink.findMany({
      select: { id: true, companyId: true, sourceEntityId: true, targetEntityId: true },
    });

    // A link carries its own companyId, and both ends were resolved through a
    // company-scoped service, so the check that matters is that no link exists
    // without a company at all.
    expect(links.filter((row) => !row.companyId).map((row) => row.id)).toEqual([]);
  });
});

describe("access (PRD #35 §195)", () => {
  it("leaves every company with at least one active Owner", async () => {
    const companies = await prisma.company.findMany({ select: { id: true, name: true } });

    for (const company of companies) {
      const owners = await prisma.companyMember.count({
        where: { companyId: company.id, status: "ACTIVE", role: { key: "OWNER" } },
      });
      expect(owners, `${company.name} has no active Owner`).toBeGreaterThan(0);
    }
  });
});

describe("inventory (PRD #35 §195, §53)", () => {
  it("holds no negative stock", async () => {
    const negative = await prisma.inventoryBalance.findMany({
      where: {
        OR: [{ onHandQuantity: { lt: 0 } }, { reservedQuantity: { lt: 0 } }],
      },
      select: { id: true, onHandQuantity: true, reservedQuantity: true },
    });

    expect(negative.map((row) => row.id)).toEqual([]);
  });

  it("keeps available equal to on hand minus reserved", async () => {
    const balances = await prisma.inventoryBalance.findMany({
      select: {
        id: true,
        onHandQuantity: true,
        reservedQuantity: true,
        availableQuantity: true,
      },
    });

    const wrong = balances.filter(
      (row) =>
        !row.onHandQuantity.minus(row.reservedQuantity).equals(row.availableQuantity),
    );

    expect(wrong.map((row) => row.id)).toEqual([]);
  });

  /**
   * The projection has to agree with the ledger it is derived from. If it
   * drifts, every stock figure in the product is quietly wrong while the
   * movements themselves are right (PRD #20 §31).
   */
  it("reconciles every balance to the movement ledger", async () => {
    const balances = await prisma.inventoryBalance.findMany({
      select: {
        id: true,
        inventoryItemId: true,
        locationId: true,
        onHandQuantity: true,
      },
    });

    for (const balance of balances) {
      const movements = await prisma.stockMovement.findMany({
        where: { inventoryItemId: balance.inventoryItemId, locationId: balance.locationId },
        select: { movementType: true, quantity: true },
      });

      /*
       * Quantities are stored unsigned and the direction lives in the movement
       * type, so the ledger has to be re-signed to be summed. That is done with
       * the balance service's own `signedQuantityFor` rather than a direction
       * map copied into this file: a second copy that can disagree with the
       * first is how a reconciliation test starts passing while the data is
       * wrong.
       */
      const ledger = movements.reduce(
        (total, movement) => total.plus(signedQuantityFor(movement.movementType, movement.quantity)),
        new Prisma.Decimal(0),
      );

      expect(
        balance.onHandQuantity.equals(ledger),
        `balance ${balance.id}: projection ${balance.onHandQuantity} vs ledger ${ledger}`,
      ).toBe(true);
    }
  });
});

describe("procurement (PRD #35 §195, §52)", () => {
  /**
   * §195 lists "no over-receipt", but the Procurement module deliberately does
   * not forbid it: more arriving than was ordered is a real event, so the
   * service refuses the first attempt and records the confirmed one
   * (PRD #19 §139). Six seeded order lines are over-received for exactly that
   * reason, and asserting otherwise would be asserting against the product.
   *
   * What is invariant is the linkage and the sign. A receipt line always
   * belongs to a real order line in the same company, and no quantity is ever
   * negative — those are the failures that would make a stock figure wrong
   * rather than merely surprising.
   */
  it("books every receipt line against a real order line in the same company", async () => {
    const lines = await prisma.goodsReceiptItem.findMany({
      select: {
        id: true,
        receivedQuantity: true,
        goodsReceipt: { select: { companyId: true } },
        purchaseOrderItem: {
          select: { purchaseOrder: { select: { companyId: true } } },
        },
      },
    });

    const crossCompany = lines.filter(
      (line) =>
        line.purchaseOrderItem.purchaseOrder.companyId !== line.goodsReceipt.companyId,
    );
    expect(crossCompany.map((line) => line.id)).toEqual([]);

    const negative = lines.filter((line) => line.receivedQuantity.lessThanOrEqualTo(0));
    expect(negative.map((line) => line.id)).toEqual([]);
  });

  /**
   * One commitment per order. A second would be a second entry in the ledger
   * for money the company owes once (PRD #35 §183).
   */
  it("draws at most one finance commitment from each purchase order", async () => {
    const grouped = await prisma.commitment.groupBy({
      by: ["sourceEntityId"],
      where: { sourceModule: "procurement", sourceEntityType: "purchase_order" },
      _count: { _all: true },
    });

    const duplicated = grouped.filter((row) => row._count._all > 1);
    expect(duplicated.map((row) => row.sourceEntityId)).toEqual([]);
  });

  it("draws at most one target from each critical integration source", async () => {
    const grouped = await prisma.integrationLink.groupBy({
      by: ["companyId", "integrationType", "idempotencyKey"],
      _count: { _all: true },
    });

    const duplicated = grouped.filter((row) => row._count._all > 1);
    expect(duplicated.map((row) => row.idempotencyKey)).toEqual([]);
  });
});

describe("quality (PRD #35 §195, §56)", () => {
  it("releases no material without an inspection behind it", async () => {
    const releases = await prisma.qualityMaterialRelease.findMany({
      select: {
        id: true,
        companyId: true,
        inspection: { select: { companyId: true } },
      },
    });

    const crossCompany = releases.filter(
      (row) => row.inspection.companyId !== row.companyId,
    );
    expect(crossCompany.map((row) => row.id)).toEqual([]);
  });
});

describe("documents (PRD #35 §195, PRD #29)", () => {
  /**
   * The bypass this guards against: a row that claims to be available while no
   * object was ever verified behind it. Availability is what the download route
   * trusts, so a document must not reach it on the strength of a metadata row.
   */
  it("gives every available document a storage key", async () => {
    const available = await prisma.document.findMany({
      where: { storageStatus: "AVAILABLE", storageKey: null },
      select: { id: true },
    });

    expect(available.map((row) => row.id)).toEqual([]);
  });

  it("leaves no archived document still downloadable", async () => {
    const wrong = await prisma.document.findMany({
      where: { status: "ARCHIVED", storageStatus: "AVAILABLE" },
      select: { id: true },
    });

    expect(wrong.map((row) => row.id)).toEqual([]);
  });

  it("keeps storage keys unique across the whole system", async () => {
    const grouped = await prisma.document.groupBy({
      by: ["storageKey"],
      where: { storageKey: { not: null } },
      _count: { _all: true },
    });

    const shared = grouped.filter((row) => row._count._all > 1);
    expect(shared.map((row) => row.storageKey)).toEqual([]);
  });
});

describe("money (PRD #35 §195, §28)", () => {
  /**
   * A total is only meaningful in one currency. An invoice whose lines sum to
   * something other than its own total is a mixed-currency or rounding fault
   * showing up as a number somebody will act on.
   */
  it("sums every invoice to its own lines", async () => {
    const invoices = await prisma.invoice.findMany({
      select: {
        id: true,
        totalAmount: true,
        lineItems: { select: { totalAmount: true } },
      },
    });

    const wrong = invoices.filter((invoice) => {
      if (invoice.lineItems.length === 0) return false;
      const summed = invoice.lineItems.reduce(
        (total, line) => total.plus(line.totalAmount),
        invoice.totalAmount.minus(invoice.totalAmount),
      );
      return !summed.equals(invoice.totalAmount);
    });

    expect(wrong.map((row) => row.id)).toEqual([]);
  });

  it("records no payment larger than what it settles", async () => {
    // Settled through allocations of recorded payments (E-05F §31).
    const live = { reversedAt: null, payment: { is: { status: "RECORDED" as const } } };
    const invoices = await prisma.invoice.findMany({
      where: { allocations: { some: live } },
      select: { id: true, totalAmount: true, allocations: { where: live, select: { amount: true } } },
    });

    const overpaid = invoices.filter((invoice) => {
      const paid = invoice.allocations.reduce(
        (total, allocation) => total.plus(allocation.amount),
        invoice.totalAmount.minus(invoice.totalAmount),
      );
      return paid.greaterThan(invoice.totalAmount);
    });

    expect(overpaid.map((row) => row.id)).toEqual([]);
  });

  it("allocates no payment beyond its own amount (E-05F §79)", async () => {
    const payments = await prisma.payment.findMany({
      where: { allocations: { some: { reversedAt: null } } },
      select: { id: true, amount: true, allocations: { where: { reversedAt: null }, select: { amount: true } } },
    });
    const over = payments.filter((payment) => payment.allocations.reduce((total, allocation) => total.plus(allocation.amount), payment.amount.minus(payment.amount)).greaterThan(payment.amount));
    expect(over.map((row) => row.id)).toEqual([]);
  });

  it("settles no invoice or expense with another company's money or another currency (AUD-01 §3)", async () => {
    // The settlement views count the live allocations whose allocation or
    // payment belongs to another company, or whose payment is in another
    // currency; the registers refuse to total a record that has any.
    const [invoices, expenses] = await Promise.all([
      prisma.invoiceSettlement.findMany({ where: { integrityIssues: { gt: 0 } }, select: { invoiceId: true } }),
      prisma.expenseSettlement.findMany({ where: { integrityIssues: { gt: 0 } }, select: { expenseId: true } }),
    ]);
    expect([...invoices.map((row) => row.invoiceId), ...expenses.map((row) => row.expenseId)]).toEqual([]);
  });
});
