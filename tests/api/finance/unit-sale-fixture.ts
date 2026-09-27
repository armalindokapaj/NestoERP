import { expect } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";
import { createUnitContractSchema } from "@/lib/modules/contracts/units/unit-contract.schema";
import { createUnitContract, requestUnitContract } from "@/lib/modules/contracts/units/unit-contract.service";
import { activateScheduleSchema, createScheduleSchema } from "@/lib/modules/finance/units/unit-finance.schema";
import { activatePaymentSchedule, createPaymentSchedule } from "@/lib/modules/finance/units/unit-finance.service";
import { commercialDetailsSchema, reserveSchema } from "@/lib/modules/sales/units/unit-sales.schema";
import { changeSaleStatus, reserveUnit, updateCommercialDetails } from "@/lib/modules/sales/units/unit-sales.service";
import { DEMO_EMAIL, loginAs, loginAsEmail, loginAsMembership, PROJECT, prisma } from "../../helpers";
import { shownCycle } from "../approvals/aud10-cycles";

/**
 * A unit sale from reservation to schedule, against the real database (E-05F
 * §116), shared by the contract and finance suites. Everything it makes carries
 * the suite's prefix — the building, its units, the clients and deals the
 * reservations open — and `cleanup` removes it, contracts, schedules, invoices,
 * payments and their trails included.
 */

export const COMPANY_A = "company_demo_a";
export const RIVERSIDE = PROJECT.a;
const DAY = 86_400_000;

export type Roles = {
  owner: UserContext;
  sales: UserContext;
  manager: UserContext;
  legal: UserContext;
  finance: UserContext;
  architect: UserContext;
  pm: UserContext;
  viewer: UserContext;
  ownerB: UserContext;
};

export async function loginRoles(): Promise<Roles> {
  const [owner, sales, legal, finance, architect, pm, viewer] = await Promise.all((["OWNER", "SALES", "LEGAL", "FINANCE", "ARCHITECT", "PROJECT_MANAGER", "VIEWER"] as const).map((role) => loginAs(role)));
  return { owner, sales, manager: await loginAsEmail(DEMO_EMAIL.salesHead), legal, finance, architect, pm, viewer, ownerB: await loginAsMembership("member_owner_b") };
}

export async function refused(promise: Promise<unknown>, code: string, detail?: string): Promise<AccessError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, `expected ${code}${detail ? ` / ${detail}` : ""}, but it succeeded`).toBeInstanceOf(AccessError);
  expect((error as AccessError).code, (error as Error).message).toBe(code);
  if (detail) expect((error as AccessError).details, (error as Error).message).toMatchObject({ code: detail });
  return error as AccessError;
}

export function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
}

export class SaleFixture {
  private serial = 0;
  private floorId = "";
  private apartmentType = "";

  constructor(
    private readonly prefix: string,
    private readonly roles: () => Roles,
  ) {}

  async setUp() {
    this.apartmentType = (await prisma.projectUnitType.findFirstOrThrow({ where: { companyId: COMPANY_A, code: "APARTMENT" }, select: { id: true } })).id;
    const building = await prisma.projectBuilding.create({ data: { companyId: COMPANY_A, projectId: RIVERSIDE, name: `${this.prefix} Block`, nameKey: `${this.prefix} BLOCK`, sortOrder: 91, createdBy: "test" } });
    this.floorId = (await prisma.projectFloor.create({ data: { companyId: COMPANY_A, projectId: RIVERSIDE, buildingId: building.id, levelType: "STANDARD", number: 1, name: "Floor 1", floorKey: "STANDARD:1", sortOrder: 1, createdBy: "test" } })).id;
  }

  async unit(options: { code?: string } = {}) {
    this.serial += 1;
    const code = options.code ?? `${this.prefix}-${String(this.serial).padStart(3, "0")}`;
    return prisma.projectUnit.create({
      data: { companyId: COMPANY_A, projectId: RIVERSIDE, floorId: this.floorId, unitCode: code, unitCodeKey: code, unitTypeId: this.apartmentType, saleableArea: "100.00", sortOrder: this.serial, createdBy: "test", publicationStatus: "PUBLISHED" },
      select: { id: true, unitCode: true },
    });
  }

  /** A published unit on sale and reserved: for a new client and deal, or the given ones. */
  async reserved(agreedPrice = "300000.00", with_?: { clientId: string; opportunityId: string }) {
    const { sales } = this.roles();
    const unit = await this.unit();
    await updateCommercialDetails(sales, unit.id, commercialDetailsSchema.parse({ askingPrice: "310000.00", currency: "EUR", priceBasis: "SALEABLE_AREA" }));
    await changeSaleStatus(sales, unit.id, { action: "put_on_sale", reason: null });
    const reservation = await reserveUnit(
      sales,
      unit.id,
      reserveSchema.parse(with_ ? { ...with_, agreedPrice } : { newClient: { name: `${this.prefix} Buyer ${this.serial}`, type: "INDIVIDUAL", acceptDuplicate: true }, newDeal: { name: `${this.prefix} Deal ${this.serial}` }, agreedPrice }),
    );
    return { ...unit, reservationId: reservation.reservationId, clientId: reservation.clientId, opportunityId: reservation.opportunityId };
  }

  /** Sales asks, Legal drafts — with more units of the same client and deal if given. */
  async contract(unitId: string, options: { additionalUnitIds?: string[]; values?: Array<{ unitId: string; value: string; valueNote?: string }> } = {}) {
    const { sales, legal } = this.roles();
    await requestUnitContract(sales, unitId, { notes: null });
    return createUnitContract(legal, unitId, createUnitContractSchema.parse({ contractNumber: `${this.prefix}-CT-${++this.serial}`, additionalUnitIds: options.additionalUnitIds ?? [], values: options.values ?? [] }));
  }

  /** Through review, approval, sending and signature; active when asked. */
  async sign(contractId: string, options: { activate?: boolean } = {}) {
    const { legal, owner } = this.roles();
    await contracts.submitForReview(legal, contractId);
    await contracts.submitForApproval(legal, contractId);
    await contracts.approveContract(owner, contractId, null, await shownCycle("contracts", contractId));
    await contracts.markSent(legal, contractId);
    await contracts.markSigned(legal, contractId, { signedDate: new Date(), acknowledgeMissingDocument: true });
    if (options.activate) await contracts.activateContract(legal, contractId, new Date());
  }

  /** An active schedule of the given installments. */
  async schedule(contractId: string, installments: Array<{ label: string; type?: string; amount: string; due: number }>) {
    const { finance } = this.roles();
    const { scheduleId } = await createPaymentSchedule(finance, contractId, createScheduleSchema.parse({ installments: installments.map((row) => ({ label: row.label, type: row.type ?? "INSTALLMENT", amount: row.amount, dueDate: isoDay(row.due) })) }));
    await activatePaymentSchedule(finance, scheduleId, activateScheduleSchema.parse({}));
    const rows = await prisma.paymentInstallment.findMany({ where: { scheduleId }, orderBy: { sequence: "asc" }, select: { id: true, label: true } });
    return { scheduleId, installments: rows };
  }

  async cleanup() {
    const buildings = await prisma.projectBuilding.findMany({ where: { projectId: RIVERSIDE, nameKey: { startsWith: this.prefix } }, select: { id: true } });
    const floors = await prisma.projectFloor.findMany({ where: { buildingId: { in: buildings.map((row) => row.id) } }, select: { id: true } });
    const units = await prisma.projectUnit.findMany({ where: { floorId: { in: floors.map((row) => row.id) } }, select: { id: true } });
    const unitIds = units.map((row) => row.id);
    const contractIds = (await prisma.contractUnit.findMany({ where: { unitId: { in: unitIds } }, select: { contractId: true } })).map((row) => row.contractId);
    const payments = await prisma.payment.findMany({ where: { contractId: { in: contractIds } }, select: { id: true } });
    const paymentIds = payments.map((row) => row.id);
    const invoices = await prisma.invoice.findMany({ where: { contractId: { in: contractIds } }, select: { id: true } });
    const invoiceIds = invoices.map((row) => row.id);

    await prisma.paymentAllocation.deleteMany({ where: { OR: [{ paymentId: { in: paymentIds } }, { contractId: { in: contractIds } }, { invoiceId: { in: invoiceIds } }] } });
    await prisma.payment.updateMany({ where: { id: { in: paymentIds } }, data: { replacesPaymentId: null } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.financeApproval.deleteMany({ where: { recordId: { in: invoiceIds } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.paymentInstallment.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.paymentSchedule.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.unitContractRequest.deleteMany({ where: { unitId: { in: unitIds } } });
    await prisma.contractUnit.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.contractApproval.deleteMany({ where: { recordId: { in: contractIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.unitSaleApproval.deleteMany({ where: { recordId: { in: unitIds } } });

    const reservations = await prisma.unitReservation.findMany({ where: { unitId: { in: unitIds } }, select: { id: true } });
    await prisma.unitReservationExtension.deleteMany({ where: { reservationId: { in: reservations.map((row) => row.id) } } });
    await prisma.unitReservation.deleteMany({ where: { unitId: { in: unitIds } } });
    await prisma.opportunityUnit.deleteMany({ where: { unitId: { in: unitIds } } });
    await prisma.unitPriceHistory.deleteMany({ where: { unitId: { in: unitIds } } });
    await prisma.unitCommercialStatusHistory.deleteMany({ where: { unitId: { in: unitIds } } });
    await prisma.unitCommercialProfile.deleteMany({ where: { unitId: { in: unitIds } } });
    const deals = await prisma.opportunity.findMany({ where: { companyId: COMPANY_A, name: { startsWith: this.prefix } }, select: { id: true } });
    const clients = await prisma.client.findMany({ where: { companyId: COMPANY_A, name: { startsWith: this.prefix } }, select: { id: true } });
    const trail = [...unitIds, ...contractIds, ...paymentIds, ...invoiceIds, ...deals.map((row) => row.id), ...clients.map((row) => row.id)];
    await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: trail } } });
    await prisma.attentionItem.deleteMany({ where: { entityId: { in: trail } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: trail } } });
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: trail } } });
    await prisma.opportunity.deleteMany({ where: { id: { in: deals.map((row) => row.id) } } });
    await prisma.contact.deleteMany({ where: { clientId: { in: clients.map((row) => row.id) } } });
    await prisma.client.deleteMany({ where: { id: { in: clients.map((row) => row.id) } } });
    await prisma.projectUnit.deleteMany({ where: { id: { in: unitIds } } });
    await prisma.projectFloor.deleteMany({ where: { id: { in: floors.map((row) => row.id) } } });
    await prisma.projectBuilding.deleteMany({ where: { id: { in: buildings.map((row) => row.id) } } });
  }
}
