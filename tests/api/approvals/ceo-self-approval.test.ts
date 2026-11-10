import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { PlatformContext } from "@/lib/context/platform-context";
import type { UserContext } from "@/lib/context/types";
import { approvalQuerySchema } from "@/lib/modules/approvals/approvals.schema";
import { decideApproval, listApprovals } from "@/lib/modules/approvals/approvals.service";
import { createClient } from "@/lib/modules/clients/client.service";
import { createClientSchema } from "@/lib/modules/clients/client.schema";
import * as invoices from "@/lib/modules/finance/invoices/invoice.service";
import { createInvoiceSchema } from "@/lib/modules/finance/invoices/invoice.schema";
import { assignCompanyCeo } from "@/lib/modules/platform/company-leadership.service";
import { platformActor } from "@/lib/modules/platform/group-actor";
import { createCompany } from "@/lib/modules/platform/platform-company.service";
import { createCompanySchema } from "@/lib/modules/platform/platform.schema";
import * as requests from "@/lib/modules/procurement/requests/request.service";
import { setCeoAccess } from "@/lib/modules/team/ceo-access.service";
import { cleanupSessions, loginAsMembership, loginAsPlatformAdmin, prisma } from "../../helpers";
import { shownCycle } from "./aud10-cycles";

/**
 * Deciding your own request (2026-11), against the real database, on real
 * approval paths: a finance invoice, a purchase request, and the Approvals
 * Center in front of them. A company of one CEO decides its own and the
 * record says so; once a CEO-access holder joins, each must leave their own
 * to the other; a buyer, who is no CEO, never decides their own.
 */

const COMPANY_NAME = "TSA Solo Co";
const EMAILS = ["tsa-ceo@nesto.test", "tsa-holder@nesto.test", "tsa-buyer@nesto.test"];

let admin: PlatformContext;
let company: string;
let ceoMember: string;
let ceo: UserContext;
let clientId: string;

async function removeCompany(companyId: string) {
  const invoiceIds = (await prisma.invoice.findMany({ where: { companyId }, select: { id: true } })).map((row) => row.id);
  const requestIds = (await prisma.purchaseRequest.findMany({ where: { companyId }, select: { id: true } })).map((row) => row.id);
  await prisma.approvalStep.deleteMany({ where: { companyId } });
  await prisma.financeApproval.deleteMany({ where: { companyId } });
  await prisma.procurementApproval.deleteMany({ where: { companyId } });
  await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
  await prisma.invoice.deleteMany({ where: { companyId } });
  await prisma.purchaseRequestItem.deleteMany({ where: { purchaseRequestId: { in: requestIds } } });
  await prisma.purchaseRequest.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.client.deleteMany({ where: { companyId } });
  await prisma.attentionItem.deleteMany({ where: { companyId } });
  await prisma.notification.deleteMany({ where: { companyId } });
  await prisma.notificationEventOutbox.deleteMany({ where: { companyId } });
  await prisma.projectMember.deleteMany({ where: { companyId } });
  await prisma.auditEvent.deleteMany({ where: { OR: [{ companyId }, { entityId: companyId }] } });
  await prisma.activity.deleteMany({ where: { companyId } });
  await prisma.session.deleteMany({ where: { currentCompanyId: companyId } });
  await prisma.department.updateMany({ where: { companyId }, data: { managerMemberId: null } });
  await prisma.company.update({ where: { id: companyId }, data: { ceoMemberId: null } });
  await prisma.companyMember.deleteMany({ where: { companyId } });
  await prisma.companyNumberingScheme.deleteMany({ where: { companyId } });
  await prisma.companyStorageQuota.deleteMany({ where: { companyId } });
  await prisma.financeSettings.deleteMany({ where: { companyId } });
  await prisma.companyIntegrationSettings.deleteMany({ where: { companyId } });
  await prisma.companySettings.deleteMany({ where: { companyId } });
  await prisma.companyModule.deleteMany({ where: { companyId } });
  await prisma.departmentAssignment.deleteMany({ where: { companyId } });
  await prisma.department.deleteMany({ where: { companyId } });
  await prisma.projectType.deleteMany({ where: { companyId } });
  await prisma.projectUnitType.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
}

async function removeAll() {
  const companies = await prisma.company.findMany({ where: { name: COMPANY_NAME }, select: { id: true, parentGroupId: true } });
  for (const row of companies) await removeCompany(row.id);
  const userIds = (await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } })).map((row) => row.id);
  for (const { parentGroupId } of companies) {
    await prisma.departmentAssignment.deleteMany({ where: { parentGroupId } });
    await prisma.parentGroupMember.deleteMany({ where: { parentGroupId } });
    await prisma.auditEvent.deleteMany({ where: { parentGroupId } });
  }
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.authEvent.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  for (const { parentGroupId } of companies) {
    await prisma.personProfile.deleteMany({ where: { parentGroupId } });
    await prisma.groupDepartment.deleteMany({ where: { parentGroupId } });
    await prisma.parentGroup.delete({ where: { id: parentGroupId } });
  }
}

async function makeMember(email: string, first: string, roleKey: string): Promise<string> {
  const { parentGroupId } = await prisma.company.findUniqueOrThrow({ where: { id: company }, select: { parentGroupId: true } });
  const person = await prisma.personProfile.create({ data: { parentGroupId, firstName: first, lastName: "Test", workEmail: email, lifecycleStatus: "EMPLOYEE", createdByUserId: admin.userId }, select: { id: true } });
  const { createProvisionedUser } = await import("@/lib/auth/identity");
  const user = await prisma.$transaction((tx) => createProvisionedUser(tx, { personProfileId: person.id, firstName: first, lastName: "Test", email, phone: null, username: null, temporaryPassword: "nesto1234", expiresAt: null }));
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey }, select: { id: true } });
  return (await prisma.companyMember.create({ data: { companyId: company, userId: user.id, roleId: role.id, status: "ACTIVE", joinedAt: new Date() }, select: { id: true } })).id;
}

async function refused(promise: Promise<unknown>): Promise<AccessError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, "expected a refusal, but it succeeded").toBeInstanceOf(AccessError);
  expect((error as AccessError).code, (error as Error).message).toBe("FORBIDDEN");
  return error as AccessError;
}

async function submittedInvoice(by: UserContext): Promise<string> {
  const invoice = await invoices.createInvoice(
    by,
    createInvoiceSchema.parse({
      invoiceNumber: `TSA-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      clientId,
      issueDate: "2026-11-01",
      dueDate: "2026-11-30",
      currency: "EUR",
      lineItems: [{ description: "Design fee", quantity: "1", unitPrice: "1000", taxRate: "20" }],
    }),
  );
  await invoices.submitInvoice(by, invoice.id);
  return invoice.id;
}

async function submittedRequest(by: UserContext): Promise<string> {
  const request = await requests.createRequest(by, {
    title: "TSA scaffolding",
    priority: "MEDIUM",
    currency: "EUR",
    items: [{ description: "Scaffold boards", quantity: "10", unit: "each", estimatedUnitPrice: "25.50" }],
  } as Parameters<typeof requests.createRequest>[1]);
  await requests.submitRequest(by, request.id);
  return request.id;
}

const selfApprovals = (entityId: string) => prisma.auditEvent.count({ where: { entityId, actionKey: "APPROVAL_SELF_APPROVED" } });
const selfLines = (entityId: string) => prisma.activity.count({ where: { entityId, action: "APPROVAL_SELF_APPROVED" } });

beforeAll(async () => {
  await removeAll();
  admin = await loginAsPlatformAdmin();
  ({ companyId: company } = await createCompany(admin, createCompanySchema.parse({ name: COMPANY_NAME })));
  await assignCompanyCeo(platformActor(admin), { companyId: company, mode: "new", firstName: "Chief", lastName: "Test", email: EMAILS[0] });
  ceoMember = (await prisma.company.findUniqueOrThrow({ where: { id: company }, select: { ceoMemberId: true } })).ceoMemberId!;
  ceo = await loginAsMembership(ceoMember);
  clientId = (await createClient(ceo, createClientSchema.parse({ name: "TSA Client", type: "COMPANY" }))).id;
});

afterAll(async () => {
  await removeAll();
  await cleanupSessions();
});

describe("a CEO alone in the company", () => {
  it("raises, submits and approves their own invoice, and the record says it was self-approved", async () => {
    const invoiceId = await submittedInvoice(ceo);
    await invoices.approveInvoice(ceo, invoiceId, null, await shownCycle("finance", invoiceId));

    expect((await invoices.getInvoice(ceo, invoiceId)).status).toBe("APPROVED");
    expect(await selfApprovals(invoiceId)).toBe(1);
    expect(await selfLines(invoiceId)).toBe(1);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: invoiceId, actionKey: "APPROVAL_SELF_APPROVED" }, select: { actorMemberId: true, metadataJson: true } });
    expect(audit.actorMemberId).toBe(ceoMember);
    expect(audit.metadataJson).toMatchObject({ selfApproved: true, reason: "NO_OTHER_APPROVER", decision: "APPROVED" });
  });

  it("decides their own purchase request through the Approvals Center, which offers it to them", async () => {
    const requestId = await submittedRequest(ceo);
    const approval = await prisma.procurementApproval.findFirstOrThrow({ where: { companyId: company, recordId: requestId, status: "PENDING" }, select: { id: true } });

    const mine = await listApprovals(ceo, approvalQuerySchema.parse({ tab: "requested", limit: 100 }));
    const item = mine.items.find((row) => row.approvalId === approval.id);
    expect(item).toMatchObject({ canApprove: true, blockedReason: null });

    await expect(decideApproval(ceo, "procurement", approval.id, "APPROVE", { note: null })).resolves.toMatchObject({ outcome: "APPROVED" });
    expect(await selfApprovals(requestId)).toBe(1);
  });
});

describe("a CEO and a CEO-access holder", () => {
  let holder: UserContext;
  let holderName: string;

  beforeAll(async () => {
    const holderMember = await makeMember(EMAILS[1], "Hana", "ARCHITECT");
    await setCeoAccess(ceo, holderMember, true);
    holder = await loginAsMembership(holderMember);
    holderName = holder.fullName;
    // A fresh session: the CEO's colleagues are read once per request.
    ceo = await loginAsMembership(ceoMember);
  });

  it("refuses the CEO their own invoice, names the holder, writes nothing, and lets the holder decide it", async () => {
    const invoiceId = await submittedInvoice(ceo);
    const error = await refused(invoices.approveInvoice(ceo, invoiceId, null, await shownCycle("finance", invoiceId)));
    expect(error.details).toMatchObject({ code: "SELF_APPROVAL", approvers: [holderName] });
    expect(error.message).toContain(`${holderName} can.`);
    expect((await invoices.getInvoice(ceo, invoiceId)).status).toBe("PENDING_APPROVAL");
    expect(await selfApprovals(invoiceId)).toBe(0);

    await invoices.approveInvoice(holder, invoiceId, null, await shownCycle("finance", invoiceId));
    expect((await invoices.getInvoice(ceo, invoiceId)).status).toBe("APPROVED");
    expect(await selfApprovals(invoiceId)).toBe(0);
  });

  it("refuses the holder their own purchase request in the Center and names the CEO", async () => {
    holder = await loginAsMembership(holder.membershipId);
    const requestId = await submittedRequest(holder);
    const approval = await prisma.procurementApproval.findFirstOrThrow({ where: { companyId: company, recordId: requestId, status: "PENDING" }, select: { id: true } });

    const mine = await listApprovals(holder, approvalQuerySchema.parse({ tab: "requested", limit: 100 }));
    expect(mine.items.find((row) => row.approvalId === approval.id)).toMatchObject({ canApprove: false });
    const error = await refused(decideApproval(holder, "procurement", approval.id, "APPROVE", { note: null }));
    expect(error.message).toContain("Chief Test can.");
    expect(await selfApprovals(requestId)).toBe(0);
  });

  it("never lets a buyer, who is no CEO, decide their own request", async () => {
    const buyer = await loginAsMembership(await makeMember(EMAILS[2], "Besa", "PROCUREMENT"));
    const requestId = await submittedRequest(buyer);
    const error = await refused(requests.approveRequest(buyer, requestId, null, await shownCycle("procurement", requestId)));
    // The module's own words, naming nobody: the rule does not look for a buyer.
    expect(error.message).toBe("You submitted this, so somebody else has to decide on it.");
    expect(await selfApprovals(requestId)).toBe(0);
  });

  it("keeps another company's members out of the count", async () => {
    // The seeded demo companies hold plenty of approvers; none of them is in this company.
    const fresh = await loginAsMembership(ceoMember);
    const invoiceId = await submittedInvoice(fresh);
    const error = await refused(invoices.approveInvoice(fresh, invoiceId, null, await shownCycle("finance", invoiceId)));
    expect((error.details as { approvers: string[] }).approvers).toEqual([holderName]);
  });
});
