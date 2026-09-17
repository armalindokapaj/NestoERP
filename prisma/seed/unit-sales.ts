import { Prisma, type PrismaClient, type UnitCommercialStatus } from "@prisma/client";

import { STRUCTURE_SEED } from "./structure";

/**
 * Selling units (E-05E §13-§31, §58).
 *
 * The published units of Riverside Residences in every commercial state, and one
 * in Munich so isolation has something to hold on both sides:
 *
 * - A-101 For Sale at €185,000, raised from €179,000 last week.
 * - A-102 Reserved for ACME Developments on "Riverside phase 2", five days left,
 *   at an agreed €126,500 against an asking €129,500.
 * - A-201 Sold to Nova Living on "Nova Living block A"; the reservation
 *   converted to the sale.
 * - A-202 On Hold for the developer, with a reason and a date.
 * - A-203 Reserved on the same ACME deal, extended once: a deal with two units.
 * - A-204 Published and still Not For Sale — no profile row, as every unit starts.
 * - OF-001 (Company B) Reserved for Isarwerk Holding.
 *
 * Every other unit stays Not For Sale (§58). Re-running replaces all of it.
 */

const COMPANY_A = "company_demo_a";
const FIXTURE_TENANT = "company_fixture_tenant";
const EUR = "EUR";
const DAY = 86_400_000;
const days = (offset: number) => new Date(Date.now() + offset * DAY);
const dec = (value: string) => new Prisma.Decimal(value);

type Member = (userId: string) => string;

/** Clears what this seed writes, so the structure seed can replace the units under it. */
export async function clearUnitSales(prisma: PrismaClient, projectIds: string[]) {
  const where = { projectId: { in: projectIds } };
  const reservations = await prisma.unitReservation.findMany({ where, select: { id: true } });
  await prisma.unitReservationExtension.deleteMany({ where: { reservationId: { in: reservations.map((row) => row.id) } } });
  await prisma.unitReservation.deleteMany({ where });
  await prisma.opportunityUnit.deleteMany({ where });
  await prisma.unitPriceHistory.deleteMany({ where });
  await prisma.unitCommercialStatusHistory.deleteMany({ where });
  await prisma.unitCommercialProfile.deleteMany({ where });
  const units = await prisma.projectUnit.findMany({ where, select: { id: true } });
  await prisma.activity.deleteMany({ where: { module: "sales", entityType: "ProjectUnit", entityId: { in: units.map((row) => row.id) } } });
}

export async function seedUnitSalesRecords(prisma: PrismaClient, memberId: Member) {
  const sales = memberId("user_sales");
  const manager = memberId("user_sales_manager");
  const ownerB = memberId("user_owner_b");
  const riverside = STRUCTURE_SEED.riverside;
  const munich = STRUCTURE_SEED.companyBProject;

  const codes = await prisma.projectUnit.findMany({ where: { projectId: riverside, unitCode: { in: ["A-101", "A-102", "A-201", "A-202", "A-203"] } }, select: { id: true, unitCode: true } });
  const unit = new Map(codes.map((row) => [row.unitCode, row.id]));

  // Company B's first deal, so a reservation there has one to belong to.
  await prisma.opportunity.upsert({
    where: { id: "opportunity_b_001" },
    update: {},
    create: { id: "opportunity_b_001", companyId: FIXTURE_TENANT, name: "Isarwerk office purchase", clientId: "client_b_muc", ownerMemberId: ownerB, stage: "NEGOTIATION", estimatedValue: dec("640000"), currency: EUR, createdByMemberId: ownerB, stageChangedAt: days(-12), createdAt: days(-30) },
  });

  const users = await prisma.companyMember.findMany({ where: { id: { in: [sales, manager, ownerB] } }, select: { id: true, userId: true } });
  const userOf = new Map(users.map((row) => [row.id, row.userId]));

  type Step = { from: UnitCommercialStatus | null; to: UnitCommercialStatus; at: number; by: string; reason?: string; reservationId?: string; opportunityId?: string };
  const offer = async (input: {
    companyId?: string;
    projectId?: string;
    unitId: string;
    code: string;
    status: UnitCommercialStatus;
    prices: Array<{ price: string; at: number; by: string; reason?: string }>;
    steps: Step[];
    hold?: { reason: string; until: number; by: string };
    notes?: string;
  }) => {
    const companyId = input.companyId ?? COMPANY_A;
    const projectId = input.projectId ?? riverside;
    const last = input.prices[input.prices.length - 1]!;
    await prisma.unitCommercialProfile.create({
      data: {
        companyId,
        projectId,
        unitId: input.unitId,
        status: input.status,
        askingPrice: dec(last.price),
        currency: EUR,
        priceBasis: "SALEABLE_AREA",
        holdReason: input.hold?.reason ?? null,
        holdUntil: input.hold ? days(input.hold.until) : null,
        heldByMemberId: input.hold?.by ?? null,
        salesNotes: input.notes ?? null,
        statusChangedAt: days(input.steps[input.steps.length - 1]!.at),
        version: input.prices.length + input.steps.length,
        updatedByMemberId: last.by,
        createdAt: days(input.prices[0]!.at),
      },
    });
    let previous: string | null = null;
    for (const price of input.prices) {
      await prisma.unitPriceHistory.create({
        data: { companyId, projectId, unitId: input.unitId, oldPrice: previous ? dec(previous) : null, newPrice: dec(price.price), oldCurrency: previous ? EUR : null, currency: EUR, oldPriceBasis: previous ? "SALEABLE_AREA" : null, priceBasis: "SALEABLE_AREA", reason: price.reason ?? null, changedByMemberId: price.by, changedAt: days(price.at) },
      });
      const shown = `€${Number(price.price).toLocaleString("en-US")}`;
      await trail(companyId, projectId, input.unitId, "UNIT_PRICE_CHANGED", previous ? `changed the asking price of ${input.code} from €${Number(previous).toLocaleString("en-US")} to ${shown}` : `set the asking price of ${input.code} to ${shown}`, price.by, price.at);
      previous = price.price;
    }
    for (const step of input.steps) {
      await prisma.unitCommercialStatusHistory.create({
        data: { companyId, projectId, unitId: input.unitId, fromStatus: step.from, toStatus: step.to, reason: step.reason ?? null, source: "USER", actorMemberId: step.by, reservationId: step.reservationId ?? null, opportunityId: step.opportunityId ?? null, changedAt: days(step.at) },
      });
    }
  };

  const trail = async (companyId: string, projectId: string, unitId: string, action: string, message: string, by: string, at: number) => {
    await prisma.activity.create({
      data: { companyId, module: "sales", entityType: "ProjectUnit", entityId: unitId, action, message, actorMemberId: by, actorUserId: userOf.get(by)!, metadata: { projectId }, createdAt: days(at) },
    });
  };

  const reserve = async (input: { companyId?: string; projectId?: string; unitId: string; code: string; clientId: string; opportunityId: string; at: number; expires: number; agreed: string; by: string; status?: "ACTIVE" | "CONVERTED_TO_SALE"; closedAt?: number; notes?: string }) => {
    const companyId = input.companyId ?? COMPANY_A;
    const projectId = input.projectId ?? riverside;
    const reservation = await prisma.unitReservation.create({
      data: {
        companyId,
        projectId,
        unitId: input.unitId,
        clientId: input.clientId,
        opportunityId: input.opportunityId,
        status: input.status ?? "ACTIVE",
        reservedAt: days(input.at),
        expiresAt: days(input.expires),
        closedAt: input.closedAt === undefined ? null : days(input.closedAt),
        closedByMemberId: input.closedAt === undefined ? null : input.by,
        agreedPrice: dec(input.agreed),
        currency: EUR,
        notes: input.notes ?? null,
        createdByMemberId: input.by,
        createdAt: days(input.at),
      },
      select: { id: true },
    });
    await prisma.opportunityUnit.create({ data: { companyId, projectId, opportunityId: input.opportunityId, unitId: input.unitId, agreedPrice: dec(input.agreed), currency: EUR, createdByMemberId: input.by, createdAt: days(input.at) } });
    await trail(companyId, projectId, input.unitId, "UNIT_RESERVED", `reserved ${input.code} until ${days(input.expires).toISOString().slice(0, 10)}`, input.by, input.at);
    return reservation.id;
  };

  /* A-101: for sale, price raised ---------------------------------------------- */
  const a101 = unit.get("A-101")!;
  await offer({
    unitId: a101,
    code: "A-101",
    status: "FOR_SALE",
    prices: [
      { price: "179000", at: -15, by: manager, reason: "Launch price list" },
      { price: "185000", at: -5, by: manager, reason: "River-view corners repriced after the first two sales" },
    ],
    steps: [{ from: "NOT_FOR_SALE", to: "FOR_SALE", at: -15, by: manager }],
  });
  await trail(COMPANY_A, riverside, a101, "UNIT_COMMERCIAL_STATUS_CHANGED", "put A-101 on sale", manager, -15);

  /* A-102: reserved for ACME --------------------------------------------------------- */
  const a102 = unit.get("A-102")!;
  const a102Reservation = await reserve({ unitId: a102, code: "A-102", clientId: "client_acme", opportunityId: "opportunity_001", at: -2, expires: 5, agreed: "126500", by: sales, notes: "Deposit expected with the signed reservation form." });
  await offer({
    unitId: a102,
    code: "A-102",
    status: "RESERVED",
    prices: [{ price: "129500", at: -14, by: manager, reason: "Launch price list" }],
    steps: [
      { from: "NOT_FOR_SALE", to: "FOR_SALE", at: -14, by: manager },
      { from: "FOR_SALE", to: "RESERVED", at: -2, by: sales, reservationId: a102Reservation, opportunityId: "opportunity_001" },
    ],
  });

  /* A-201: sold to Nova Living ------------------------------------------------------------ */
  const a201 = unit.get("A-201")!;
  const a201Reservation = await reserve({ unitId: a201, code: "A-201", clientId: "client_nova", opportunityId: "opportunity_006", at: -12, expires: -5, agreed: "176000", by: sales, status: "CONVERTED_TO_SALE", closedAt: -6 });
  await offer({
    unitId: a201,
    code: "A-201",
    status: "SOLD",
    prices: [{ price: "182000", at: -30, by: manager, reason: "Launch price list" }],
    steps: [
      { from: "NOT_FOR_SALE", to: "FOR_SALE", at: -30, by: manager },
      { from: "FOR_SALE", to: "RESERVED", at: -12, by: sales, reservationId: a201Reservation, opportunityId: "opportunity_006" },
      { from: "RESERVED", to: "SOLD", at: -6, by: sales, reservationId: a201Reservation, opportunityId: "opportunity_006" },
    ],
  });
  await trail(COMPANY_A, riverside, a201, "UNIT_MARKED_SOLD", "marked A-201 Sold", sales, -6);

  /* A-202: on hold ------------------------------------------------------------------------ */
  const a202 = unit.get("A-202")!;
  const holdReason = "Held for the developer's family until the second price list is signed off.";
  await offer({
    unitId: a202,
    code: "A-202",
    status: "ON_HOLD",
    prices: [{ price: "131000", at: -20, by: manager, reason: "Launch price list" }],
    steps: [
      { from: "NOT_FOR_SALE", to: "FOR_SALE", at: -20, by: manager },
      { from: "FOR_SALE", to: "ON_HOLD", at: -3, by: manager, reason: holdReason },
    ],
    hold: { reason: holdReason, until: 10, by: manager },
  });
  await trail(COMPANY_A, riverside, a202, "UNIT_COMMERCIAL_STATUS_CHANGED", "put A-202 on hold", manager, -3);

  /* A-203: a second unit on the ACME deal, extended once -------------------------------------------- */
  const a203 = unit.get("A-203")!;
  const a203Reservation = await reserve({ unitId: a203, code: "A-203", clientId: "client_acme", opportunityId: "opportunity_001", at: -8, expires: 2, agreed: "118000", by: sales });
  await prisma.unitReservationExtension.create({ data: { companyId: COMPANY_A, reservationId: a203Reservation, oldExpiresAt: days(-1), newExpiresAt: days(2), reason: "ACME's board meets on Thursday to approve the second apartment.", extendedByMemberId: sales, extendedAt: days(-2) } });
  await prisma.unitReservation.update({ where: { id: a203Reservation }, data: { version: 2 } });
  await trail(COMPANY_A, riverside, a203, "UNIT_RESERVATION_EXTENDED", `extended the reservation of A-203 to ${days(2).toISOString().slice(0, 10)}`, sales, -2);
  await offer({
    unitId: a203,
    code: "A-203",
    status: "RESERVED",
    prices: [{ price: "121500", at: -20, by: manager, reason: "Launch price list" }],
    steps: [
      { from: "NOT_FOR_SALE", to: "FOR_SALE", at: -20, by: manager },
      { from: "FOR_SALE", to: "RESERVED", at: -8, by: sales, reservationId: a203Reservation, opportunityId: "opportunity_001" },
    ],
  });

  /* Company B: OF-001 reserved ------------------------------------------------------------------------ */
  const of001 = STRUCTURE_SEED.units.munichOffice1;
  const of001Reservation = await reserve({ companyId: FIXTURE_TENANT, projectId: munich, unitId: of001, code: "OF-001", clientId: "client_b_muc", opportunityId: "opportunity_b_001", at: -1, expires: 6, agreed: "612000", by: ownerB });
  await offer({
    companyId: FIXTURE_TENANT,
    projectId: munich,
    unitId: of001,
    code: "OF-001",
    status: "RESERVED",
    prices: [{ price: "640000", at: -7, by: ownerB }],
    steps: [
      { from: "NOT_FOR_SALE", to: "FOR_SALE", at: -7, by: ownerB },
      { from: "FOR_SALE", to: "RESERVED", at: -1, by: ownerB, reservationId: of001Reservation, opportunityId: "opportunity_b_001" },
    ],
  });

  const count = async (status: UnitCommercialStatus) => prisma.unitCommercialProfile.count({ where: { companyId: COMPANY_A, status } });
  return { forSale: await count("FOR_SALE"), onHold: await count("ON_HOLD"), reserved: await count("RESERVED"), sold: await count("SOLD") };
}
