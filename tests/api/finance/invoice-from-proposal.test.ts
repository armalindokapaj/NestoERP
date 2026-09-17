import { Prisma } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { IntegrationType } from "@/lib/core/integrations/integration.registry";
import {
  createInvoiceFromProposal,
  listInvoicesForProposal,
} from "@/lib/modules/finance/invoices/invoice.service";
import { cleanupSessions, loginAsMembership, prisma } from "../../helpers";

/**
 * Workflow L — Sales quote to invoice (PRD #35 §180).
 *
 * The 2026-09-13 release review found this workflow had no implementation at
 * all: `Invoice` carried no link back to Sales, and nothing could raise one
 * from an accepted proposal, even though the integration registry declared
 * SALES_PROPOSAL_FINANCE_INVOICE.
 *
 * The rule that matters most is the snapshot. Once an invoice exists it is
 * what the client owes, and editing the proposal afterwards must not change
 * it — a quote and a demand for money are different documents.
 */
const createdInvoices: string[] = [];

/** The demo's accepted quote is Nova's, so Finance works in Nova: the group head's membership there. */
function financeInNova() {
  return loginAsMembership("member_finance__e");
}

async function acceptedProposal(companyId: string) {
  const proposal = await prisma.proposal.findFirst({
    where: { companyId, status: "ACCEPTED", archivedAt: null, lineItems: { some: {} } },
    select: { id: true, proposalNumber: true, currency: true, clientId: true, totalAmount: true },
  });
  expect(proposal, "the seed must contain an accepted proposal with lines").not.toBeNull();
  return proposal!;
}

afterEach(async () => {
  if (createdInvoices.length > 0) {
    await prisma.integrationAttempt.deleteMany({
      where: { integrationType: IntegrationType.SALES_PROPOSAL_FINANCE_INVOICE },
    });
    await prisma.integrationLink.deleteMany({
      where: { targetEntityId: { in: createdInvoices } },
    });
    await prisma.activity.deleteMany({ where: { entityId: { in: createdInvoices } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: createdInvoices } } });
    await prisma.invoice.deleteMany({ where: { id: { in: createdInvoices } } });
    createdInvoices.length = 0;
  }
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("raising the invoice (PRD #35 §180)", () => {
  it("copies the accepted lines, the client and the currency", async () => {
    const finance = await financeInNova();
    const proposal = await acceptedProposal(finance.companyId);

    const lines = await prisma.proposalLineItem.findMany({
      where: { proposalId: proposal.id },
      orderBy: { sortOrder: "asc" },
    });

    const invoice = await createInvoiceFromProposal(finance, proposal.id);
    createdInvoices.push(invoice.id);

    expect(invoice.status).toBe("DRAFT");
    expect(invoice.currency).toBe(proposal.currency);
    expect(invoice.client.id).toBe(proposal.clientId);
    expect(invoice.lineItems).toHaveLength(lines.length);
    expect(invoice.totalAmount).toBe(proposal.totalAmount.toFixed(2));

    const row = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      select: { sourceProposalId: true },
    });
    expect(row.sourceProposalId).toBe(proposal.id);
  });

  /**
   * The snapshot rule. The proposal is a quote; the invoice is what is owed.
   * Changing the quote afterwards must not rewrite the demand.
   */
  it("does not follow the proposal if the proposal changes afterwards", async () => {
    const finance = await financeInNova();
    const proposal = await acceptedProposal(finance.companyId);

    const invoice = await createInvoiceFromProposal(finance, proposal.id);
    createdInvoices.push(invoice.id);
    const billed = invoice.totalAmount;

    const line = await prisma.proposalLineItem.findFirstOrThrow({
      where: { proposalId: proposal.id },
    });
    const originalUnitPrice = line.unitPrice;

    try {
      await prisma.proposalLineItem.update({
        where: { id: line.id },
        data: { unitPrice: new Prisma.Decimal(originalUnitPrice).plus(1000) },
      });

      const after = await prisma.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
        select: { totalAmount: true },
      });
      expect(after.totalAmount.toFixed(2)).toBe(billed);
    } finally {
      await prisma.proposalLineItem.update({
        where: { id: line.id },
        data: { unitPrice: originalUnitPrice },
      });
    }
  });

  it("records the handoff as an integration link", async () => {
    const finance = await financeInNova();
    const proposal = await acceptedProposal(finance.companyId);

    const invoice = await createInvoiceFromProposal(finance, proposal.id);
    createdInvoices.push(invoice.id);

    const link = await prisma.integrationLink.findFirst({
      where: {
        companyId: finance.companyId,
        integrationType: IntegrationType.SALES_PROPOSAL_FINANCE_INVOICE,
        sourceEntityId: proposal.id,
      },
    });
    expect(link).not.toBeNull();
    expect(link!.targetEntityId).toBe(invoice.id);
  });

  /**
   * Staged billing against one accepted quote is ordinary, so a second invoice
   * is allowed — and listed, so a second click meets the first rather than
   * making a duplicate by accident (the rule Legal already applies).
   */
  it("allows a second invoice and lists what was already raised", async () => {
    const finance = await financeInNova();
    const proposal = await acceptedProposal(finance.companyId);

    const first = await createInvoiceFromProposal(finance, proposal.id);
    createdInvoices.push(first.id);
    const second = await createInvoiceFromProposal(finance, proposal.id);
    createdInvoices.push(second.id);

    expect(second.id).not.toBe(first.id);
    expect(second.invoiceNumber).not.toBe(first.invoiceNumber);

    const raised = await listInvoicesForProposal(finance, proposal.id);
    expect(raised.map((row) => row.id).sort()).toEqual([first.id, second.id].sort());
  });
});

describe("what it refuses (PRD #35 §180)", () => {
  it("refuses a proposal the client has not accepted", async () => {
    const finance = await financeInNova();

    const draft = await prisma.proposal.findFirst({
      where: { companyId: finance.companyId, status: { not: "ACCEPTED" }, archivedAt: null },
      select: { id: true },
    });
    if (!draft) return;

    await expect(createInvoiceFromProposal(finance, draft.id)).rejects.toBeInstanceOf(AccessError);
  });

  it("refuses somebody without finance.invoice.create", async () => {
    // An engineer in Nova, where the accepted quote is: the group Engineering head's membership there.
    const engineer = await loginAsMembership("member_group_engineering__e");
    const proposal = await acceptedProposal(engineer.companyId);

    await expect(createInvoiceFromProposal(engineer, proposal.id)).rejects.toBeInstanceOf(
      AccessError,
    );
  });

  it("refuses a proposal belonging to another company", async () => {
    const finance = await financeInNova();

    const foreign = await prisma.proposal.findFirst({
      where: { companyId: { not: finance.companyId } },
      select: { id: true },
    });
    if (!foreign) return;

    // Not found rather than forbidden: the endpoint must not confirm that
    // another company's proposal exists.
    await expect(createInvoiceFromProposal(finance, foreign.id)).rejects.toBeInstanceOf(
      AccessError,
    );
  });
});
