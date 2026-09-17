import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as contracts from "@/lib/modules/contracts/contracts/contract.service";
import { createContractSchema, updateContractSchema } from "@/lib/modules/contracts/contracts/contract.schema";
import { contractUnitValueSchema, createUnitContractSchema, parseContractRequestQuery } from "@/lib/modules/contracts/units/unit-contract.schema";
import {
  createUnitContract,
  declineContractRequest,
  getUnitLegal,
  listContractRequests,
  requestUnitContract,
  updateContractUnitValue,
  withdrawContractRequest,
} from "@/lib/modules/contracts/units/unit-contract.service";
import { runUnitReservationExpiry } from "@/lib/modules/sales/units/unit-sales.expiry";
import { releaseReservation, reopenSale } from "@/lib/modules/sales/units/unit-sales.service";
import { cleanupSessions, prisma } from "../../helpers";
import { COMPANY_A, loginRoles, refused, SaleFixture, type Roles } from "../finance/unit-sale-fixture";

/**
 * A unit's contract against the real database (E-05F §7-§17, §74, §75, §82,
 * §88-§90, §117, §120, §123): Sales asks, Legal drafts the canonical Contract
 * from the request, one live contract per unit, several units on one contract,
 * and what the contract's lifecycle does to its units.
 */

const T = "E05FC";
let roles: Roles;
const fixture = new SaleFixture(T, () => roles);

beforeAll(async () => {
  roles = await loginRoles();
  await fixture.cleanup();
});
beforeEach(() => fixture.setUp());
afterEach(() => fixture.cleanup());
afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("Sales asks, Legal drafts (§12, §13, §74)", () => {
  it("drafts the canonical contract from Sales' request, referencing the client, deal, project and unit", async () => {
    const unit = await fixture.reserved("300000.00");
    const before = await getUnitLegal(roles.sales, unit.id);
    expect(before).toMatchObject({ contract: null, openRequest: null, requestBlocked: null });
    expect(before.capabilities).toMatchObject({ canRequest: true, canCreate: false });

    const { requestId } = await requestUnitContract(roles.sales, unit.id, { notes: "Client ready to sign next week" });
    const queue = await listContractRequests(roles.legal, parseContractRequestQuery({}));
    expect(queue.items.map((row) => row.id)).toContain(requestId);
    expect(queue.items.find((row) => row.id === requestId)).toMatchObject({ status: "OPEN", agreedPrice: "300000.00", currency: "EUR", unit: { unitCode: unit.unitCode } });
    expect((await getUnitLegal(roles.legal, unit.id)).createBlocked).toBeNull();

    const created = await createUnitContract(roles.legal, unit.id, createUnitContractSchema.parse({ contractNumber: `${T}-CT-1` }));
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: created.contractId }, include: { units: true } });
    expect(contract).toMatchObject({ contractType: "SALE_AGREEMENT", status: "DRAFT", clientId: unit.clientId, opportunityId: unit.opportunityId, projectId: "project_c", currency: "EUR", ownerMemberId: roles.legal.membershipId });
    expect(contract.contractValue?.toFixed(2)).toBe("300000.00");
    expect(contract.units.map((row) => [row.unitId, row.value?.toFixed(2), row.releasedAt])).toEqual([[unit.id, "300000.00", null]]);
    expect(await prisma.unitContractRequest.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({ status: "FULFILLED", contractId: created.contractId });

    const legal = await getUnitLegal(roles.sales, unit.id);
    expect(legal.contract).toMatchObject({ number: `${T}-CT-1`, status: "DRAFT", statusLabel: "Draft", live: true, value: "300000.00" });
    expect(legal.requestBlocked).toBe("This unit already has an active primary Contract.");
    expect(await prisma.auditEvent.count({ where: { entityId: created.contractId, actionKey: "UNIT_CONTRACT_CREATED" } })).toBe(1);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: unit.id, eventType: "UNIT_CONTRACT_REQUESTED" } })).toBe(1);
  });

  it("refuses what the unit, the request or the reader cannot support, in the PRD's words", async () => {
    const free = await fixture.unit();
    await refused(requestUnitContract(roles.sales, free.id, { notes: null }), "CONFLICT", "UNIT_NOT_READY_FOR_CONTRACT");

    const noPrice = await fixture.reserved("300000.00");
    await prisma.unitReservation.update({ where: { id: noPrice.reservationId }, data: { agreedPrice: null } });
    const priceless = await refused(requestUnitContract(roles.sales, noPrice.id, { notes: null }), "CONFLICT", "UNIT_NOT_READY_FOR_CONTRACT");
    expect(priceless.message).toBe("Record the agreed price on the reservation first.");

    const unit = await fixture.reserved();
    await refused(createUnitContract(roles.legal, unit.id, createUnitContractSchema.parse({ contractNumber: `${T}-X` })), "CONFLICT", "CONTRACT_NOT_REQUESTED");
    await refused(requestUnitContract(roles.legal, unit.id, { notes: null }), "FORBIDDEN");
    await requestUnitContract(roles.sales, unit.id, { notes: null });
    await refused(requestUnitContract(roles.manager, unit.id, { notes: null }), "CONFLICT", "CONTRACT_ALREADY_REQUESTED");
    await refused(createUnitContract(roles.sales, unit.id, createUnitContractSchema.parse({ contractNumber: `${T}-Y` })), "FORBIDDEN");
    await refused(getUnitLegal(roles.architect, unit.id), "FORBIDDEN");
    await refused(getUnitLegal(roles.ownerB, unit.id), "NOT_FOUND");

    const created = await createUnitContract(roles.legal, unit.id, createUnitContractSchema.parse({ contractNumber: `${T}-Z` }));
    // One live contract per unit (§8), whatever path a second one takes.
    await refused(requestUnitContract(roles.sales, unit.id, { notes: null }), "CONFLICT", "UNIT_CONTRACT_EXISTS");
    await expect(prisma.contractUnit.create({ data: { companyId: COMPANY_A, projectId: "project_c", contractId: created.contractId, unitId: unit.id, createdByMemberId: roles.legal.membershipId } })).rejects.toThrow();

    // The Legal module's own form drafts no sale agreement, and a sale contract's terms stay its units'.
    await refused(contracts.createContract(roles.legal, createContractSchema.parse({ contractNumber: `${T}-F`, title: "Sale", contractType: "SALE_AGREEMENT", ownerMemberId: roles.legal.membershipId })), "VALIDATION_ERROR");
    const detail = await contracts.getContract(roles.legal, created.contractId);
    const edit = updateContractSchema.parse({ contractNumber: detail.contractNumber, title: "Renamed sale agreement", contractType: "SALE_AGREEMENT", ownerMemberId: roles.legal.membershipId, clientId: unit.clientId, projectId: "project_c", opportunityId: unit.opportunityId, currency: "EUR", contractValue: "300000.00" });
    await contracts.updateContract(roles.legal, created.contractId, edit);
    await refused(contracts.updateContract(roles.legal, created.contractId, { ...edit, contractValue: "1.00" }), "CONFLICT", "SALE_CONTRACT_TERMS_FIXED");
  });

  it("declines with a reason Sales is told, withdraws, and closes a request whose reservation ended", async () => {
    const unit = await fixture.reserved();
    const { requestId } = await requestUnitContract(roles.sales, unit.id, { notes: null });
    await refused(declineContractRequest(roles.sales, requestId, { reason: "Not mine" }), "FORBIDDEN");
    await declineContractRequest(roles.legal, requestId, { reason: "Buyer's identity documents are missing" });
    expect(await prisma.unitContractRequest.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({ status: "DECLINED", closeReason: "Buyer's identity documents are missing" });
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: unit.id, eventType: "UNIT_CONTRACT_REQUEST_DECLINED" } })).toBe(1);

    const again = await requestUnitContract(roles.sales, unit.id, { notes: "Documents attached" });
    await withdrawContractRequest(roles.sales, again.requestId);
    expect((await prisma.unitContractRequest.findUniqueOrThrow({ where: { id: again.requestId } })).status).toBe("CANCELLED");

    const third = await requestUnitContract(roles.sales, unit.id, { notes: null });
    await releaseReservation(roles.sales, unit.reservationId, { reason: "Client withdrew" });
    const legal = await getUnitLegal(roles.legal, unit.id);
    expect(legal.requests.find((row) => row.id === third.requestId)).toMatchObject({ status: "CANCELLED", closeReason: "The reservation ended." });
    expect((await listContractRequests(roles.legal, parseContractRequestQuery({}))).items.map((row) => row.id)).not.toContain(third.requestId);
  });
});

describe("one contract, several units (§88-§90, §120)", () => {
  it("sells an apartment and its parking on one contract, keeping the value the sum of its units", async () => {
    const apartment = await fixture.reserved("280000.00");
    const parking = await fixture.reserved("20000.00", { clientId: apartment.clientId, opportunityId: apartment.opportunityId });
    const stranger = await fixture.reserved("15000.00");

    const legal = (await requestUnitContract(roles.sales, apartment.id, { notes: null }), await getUnitLegal(roles.legal, apartment.id));
    expect(legal.candidates.map((row) => row.unitCode)).toEqual([parking.unitCode]);

    await refused(createUnitContract(roles.legal, apartment.id, createUnitContractSchema.parse({ contractNumber: `${T}-M1`, additionalUnitIds: [stranger.id] })), "VALIDATION_ERROR");
    await refused(createUnitContract(roles.legal, apartment.id, createUnitContractSchema.parse({ contractNumber: `${T}-M1`, additionalUnitIds: [parking.id], values: [{ unitId: parking.id, value: "18000.00" }] })), "VALIDATION_ERROR");

    const created = await createUnitContract(roles.legal, apartment.id, createUnitContractSchema.parse({ contractNumber: `${T}-M1`, additionalUnitIds: [parking.id], values: [{ unitId: parking.id, value: "18000.00", valueNote: "Parking discount agreed with Legal" }] }));
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: created.contractId }, include: { units: { orderBy: { createdAt: "asc" } } } });
    expect(contract.contractValue?.toFixed(2)).toBe("298000.00");
    expect(contract.units.map((row) => [row.unitId, row.value?.toFixed(2), row.valueNote])).toEqual([
      [apartment.id, "280000.00", null],
      [parking.id, "18000.00", "Parking discount agreed with Legal"],
    ]);
    // The agreed price on Sales' reservation is left as it was (§14).
    expect((await prisma.unitReservation.findUniqueOrThrow({ where: { id: parking.reservationId } })).agreedPrice?.toFixed(2)).toBe("20000.00");
    expect((await getUnitLegal(roles.sales, parking.id)).contract).toMatchObject({ number: `${T}-M1`, units: [{ unitCode: apartment.unitCode }, { unitCode: parking.unitCode }] });
    expect(await prisma.contract.count({ where: { units: { some: { unitId: { in: [apartment.id, parking.id] } } } } })).toBe(1);

    const changed = await updateContractUnitValue(roles.legal, created.contractId, parking.id, contractUnitValueSchema.parse({ value: "20000.00" }));
    expect(changed.contractValue).toBe("300000.00");
    await refused(updateContractUnitValue(roles.legal, created.contractId, parking.id, contractUnitValueSchema.parse({ value: "1.00" })), "VALIDATION_ERROR");
    await refused(updateContractUnitValue(roles.sales, created.contractId, parking.id, contractUnitValueSchema.parse({ value: "20000.00" })), "FORBIDDEN");
  });
});

describe("the contract's lifecycle and its units (§9, §10, §75, §82, §117)", () => {
  it("records the signature, keeps the unit through its reservation's expiry, and refuses releasing it", async () => {
    const unit = await fixture.reserved();
    const { contractId } = await fixture.contract(unit.id);
    // The unit's grant sits beside Legal's: Sales cannot move the contract even through Legal's routes.
    await refused(contracts.submitForReview(roles.sales, contractId), "FORBIDDEN");
    await fixture.sign(contractId);
    expect((await getUnitLegal(roles.legal, unit.id)).contract).toMatchObject({ status: "SIGNED", statusLabel: "Signed", actions: ["activate", "terminate"] });
    expect(await prisma.auditEvent.count({ where: { entityId: contractId, actionKey: "UNIT_CONTRACT_SIGNED" } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityId: contractId, actionKey: "UNIT_CONTRACT_STATUS_CHANGED" } })).toBeGreaterThanOrEqual(3);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: unit.id, eventType: "UNIT_CONTRACT_SIGNED" } })).toBe(1);

    await refused(releaseReservation(roles.sales, unit.reservationId, { reason: "Changed mind" }), "CONFLICT", "UNIT_UNDER_CONTRACT");
    await prisma.unitReservation.update({ where: { id: unit.reservationId }, data: { expiresAt: new Date(Date.now() - 60_000), reservedAt: new Date(Date.now() - 86_400_000) } });
    await runUnitReservationExpiry(new Date());
    expect((await prisma.unitReservation.findUniqueOrThrow({ where: { id: unit.reservationId } })).status).toBe("ACTIVE");
    expect((await prisma.unitCommercialProfile.findUniqueOrThrow({ where: { unitId: unit.id } })).status).toBe("RESERVED");
  });

  it("cancels or terminates with its schedules, releasing the units and keeping the history", async () => {
    const draft = await fixture.reserved();
    const first = await fixture.contract(draft.id);
    await contracts.cancelContract(roles.legal, first.contractId, "Wrong buyer entity");
    expect((await prisma.contractUnit.findFirstOrThrow({ where: { contractId: first.contractId } })).releasedAt).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { entityId: first.contractId, actionKey: "UNIT_CONTRACT_CANCELLED" } })).toBe(1);
    const legal = await getUnitLegal(roles.legal, draft.id);
    expect(legal.contract).toBeNull();
    expect(legal.history).toMatchObject([{ number: first.contractNumber, status: "CANCELLED", live: false }]);
    // Released, the unit takes a new contract.
    const second = await fixture.contract(draft.id);
    expect((await getUnitLegal(roles.legal, draft.id)).contract?.number).toBe(second.contractNumber);

    const signed = await fixture.reserved();
    const live = await fixture.contract(signed.id);
    await fixture.sign(live.contractId, { activate: true });
    const { scheduleId } = await fixture.schedule(live.contractId, [{ label: "Deposit", type: "DEPOSIT", amount: "300000.00", due: 10 }]);
    await refused(contracts.cancelContract(roles.legal, live.contractId, null), "CONFLICT");
    await contracts.terminateContract(roles.legal, live.contractId, { terminationDate: new Date(), terminationReason: "Buyer defaulted" });
    expect((await prisma.paymentSchedule.findUniqueOrThrow({ where: { id: scheduleId } })).status).toBe("CANCELLED");
    expect((await prisma.contractUnit.findFirstOrThrow({ where: { contractId: live.contractId } })).releaseReason).toBe("Buyer defaulted");
    // Terminating does not move the unit: Sales decides what happens to its reservation (§82).
    expect((await prisma.unitCommercialProfile.findUniqueOrThrow({ where: { unitId: signed.id } })).status).toBe("RESERVED");
    await releaseReservation(roles.sales, signed.reservationId, { reason: "Contract terminated" });
  });

  it("refuses archiving a draft sale contract and reopening a sale under contract", async () => {
    const unit = await fixture.reserved();
    const { contractId } = await fixture.contract(unit.id);
    await refused(contracts.archiveContract(roles.owner, contractId), "CONFLICT", "SALE_CONTRACT_NOT_CLOSED");
    await prisma.unitCommercialProfile.update({ where: { unitId: unit.id }, data: { status: "SOLD" } });
    await refused(reopenSale(roles.manager, unit.id, { to: "FOR_SALE", reason: "Test" }), "CONFLICT", "UNIT_UNDER_CONTRACT");
  });
});
