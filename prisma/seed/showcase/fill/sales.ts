/**
 * Selling the units: a price list on every project, and the buyers who
 * reserved, signed and paid. Each sold unit has a won deal, a reservation that
 * converted, a sale contract (often with a parking space or storage on the same
 * contract), a payment schedule, invoices for what fell due and the payments
 * against them, a few of them late. Reserved units wait at every step: just
 * reserved, a contract asked of Legal, a contract in review. Kodra Villas is
 * sold out and paid; Rinas is still in design, so nothing there is for sale.
 */
import type { ContractStatus, Prisma, PrismaClient, UnitCommercialStatus, UnitPriceBasis } from "@prisma/client";

import { normalizeName } from "../../../../lib/modules/clients/client.duplicate";
import { BuyerPool, type Buyer } from "./people-pool";
import { at, businessDay, castOf, dec, EUR, Numbers, priceOf, random, round2, type Cast, type Clock } from "./kit";

type Plan = {
  projectId: string;
  companyId: string;
  /** Unit id prefix (units.ts key), or null for Kalaja's standard-seed units. */
  key: string | null;
  /** Days from the reset the price list went out, per building code. */
  launch: Record<string, number>;
  /** Days from the reset the project hands over, when the balance falls due. */
  handover: number;
  /** €/m² of sale area, per unit type, before floor and corner premiums. */
  rates: Record<string, [number, number]>;
  /** Fixed prices for parking, storage, truck bays. */
  fixed: Record<string, number>;
  /** Share of each building's main stock in each state. */
  mix: Record<string, { sold: number; reserved: number; hold: number; notForSale?: number }>;
  /** Buildings or floors kept off the market. */
  heldBack?: (code: string, building: string) => boolean;
  /** Who buys: people (with a share abroad) or firms. */
  buyers: { firms: number; abroad: number };
  schedule: "offPlan" | "commercial" | "complete";
  /** Units whose state the project's story fixes, by code. */
  force?: Record<string, "SOLD" | "RESERVED" | "ON_HOLD" | "FOR_SALE">;
  holdReasons?: Record<string, string>;
};

export const PLANS: Plan[] = [
  {
    projectId: "project_a", companyId: "company_demo_a", key: null,
    launch: { A: -300, B: -240, C: -120 }, handover: 240,
    rates: { APARTMENT: [1580, 1760], SHOP: [2450, 2700] }, fixed: { PARKING: 14000, STORAGE: 5500 },
    mix: { A: { sold: 0.55, reserved: 0.1, hold: 0.04 }, B: { sold: 0.35, reserved: 0.1, hold: 0.02 }, C: { sold: 0.08, reserved: 0.06, hold: 0 } },
    heldBack: (code, building) => building === "C" && /^C-[78]0/.test(code),
    buyers: { firms: 0.05, abroad: 0.25 }, schedule: "offPlan",
  },
  {
    projectId: "project_b", companyId: "company_demo_b", key: "prt",
    launch: { PT: -280 }, handover: 420,
    rates: { OFFICE: [1720, 2020], SHOP: [2300, 2500] }, fixed: { PARKING: 11000, STORAGE: 4500 },
    mix: { PT: { sold: 0.36, reserved: 0.12, hold: 0.02 } },
    buyers: { firms: 0.8, abroad: 0.05 }, schedule: "offPlan",
    force: { "PT-1201": "SOLD", "PT-901": "RESERVED", "PT-903": "RESERVED", "PT-1004": "RESERVED", "PT-1801": "ON_HOLD" },
    holdReasons: { "PT-1801": "Held while a bank negotiates the whole floor for its regional head office." },
  },
  {
    projectId: "project_c", companyId: "company_demo_c", key: "nyj",
    launch: { WA: -200, SB: -150, TY: -150 }, handover: 200,
    rates: { WAREHOUSE: [690, 760], OFFICE: [1100, 1200], SHOP: [1250, 1350] }, fixed: { PARKING: 9000 },
    mix: { WA: { sold: 0.25, reserved: 0.25, hold: 0 }, SB: { sold: 0.25, reserved: 0.1, hold: 0 }, TY: { sold: 0.25, reserved: 0.1, hold: 0 } },
    heldBack: (_code, building) => building === "WB",
    buyers: { firms: 1, abroad: 0 }, schedule: "commercial",
    force: { "WA-01": "SOLD", "WA-02": "SOLD", "WA-03": "RESERVED", "WA-05": "RESERVED" },
  },
  {
    projectId: "project_d", companyId: "company_demo_d", key: "lgm",
    launch: { A: -360, B: -210 }, handover: 300,
    rates: { APARTMENT: [2250, 2650], PENTHOUSE: [3000, 3200], SHOP: [2500, 2700] }, fixed: { PARKING: 12000, STORAGE: 5000 },
    mix: { A: { sold: 0.6, reserved: 0.12, hold: 0.04 }, B: { sold: 0.3, reserved: 0.1, hold: 0.02 } },
    buyers: { firms: 0.04, abroad: 0.35 }, schedule: "offPlan",
    force: { "A-1001": "SOLD", "A-1002": "RESERVED" },
  },
  {
    projectId: "project_e", companyId: "company_demo_e", key: "ksb",
    launch: { R1: -250, R2: -45, SR: -200 }, handover: 450,
    rates: { APARTMENT: [2850, 3250], PENTHOUSE: [3800, 4000], SHOP: [3100, 3300] }, fixed: { PARKING: 15000 },
    mix: { R1: { sold: 0.72, reserved: 0.06, hold: 0 }, R2: { sold: 0.05, reserved: 0.18, hold: 0.04 }, SR: { sold: 0.34, reserved: 0.17, hold: 0 } },
    heldBack: (_code, building) => building === "HT",
    buyers: { firms: 0.03, abroad: 0.6 }, schedule: "offPlan",
    force: { "R2-501": "ON_HOLD", "R2-502": "ON_HOLD", "R2-G02": "RESERVED", "R2-102": "RESERVED", "R2-104": "RESERVED", "R2-203": "RESERVED", "R2-205": "RESERVED", "R2-301": "RESERVED" },
    holdReasons: { "R2-501": "Off the list until the second-release price list is approved.", "R2-502": "Off the list until the second-release price list is approved." },
  },
  {
    projectId: "project_showcase_promenada", companyId: "company_demo_b", key: "prd",
    launch: { A: -500, B: -150 }, handover: 600,
    rates: { APARTMENT: [1780, 2120], PENTHOUSE: [2650, 2800], SHOP: [2400, 2600] }, fixed: { PARKING: 10500 },
    mix: { A: { sold: 0.5, reserved: 0.1, hold: 0.02 }, B: { sold: 0.2, reserved: 0.08, hold: 0.02 } },
    buyers: { firms: 0.04, abroad: 0.3 }, schedule: "offPlan",
    force: { "A-901": "SOLD" },
  },
  {
    projectId: "project_showcase_kodra", companyId: "company_demo_b", key: "kdv",
    launch: { A: -1700, B: -1650, C: -1600 }, handover: -1100,
    rates: { VILLA: [1350, 1600] }, fixed: {},
    mix: { A: { sold: 1, reserved: 0, hold: 0 }, B: { sold: 1, reserved: 0, hold: 0 }, C: { sold: 1, reserved: 0, hold: 0 } },
    buyers: { firms: 0, abroad: 0.3 }, schedule: "complete",
  },
];

/** Handover dates and the place each project stands in its life. */
export const PROJECT_DATES: Record<string, { start: number; end: number; priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" }> = {
  project_a: { start: -420, end: 240 },
  project_b: { start: -330, end: 420 },
  project_c: { start: -260, end: 200 },
  project_d: { start: -390, end: 300 },
  project_e: { start: -300, end: 450 },
  project_showcase_promenada: { start: -560, end: 600, priority: "HIGH" },
  project_showcase_kodra: { start: -1800, end: -1100, priority: "LOW" },
  project_showcase_rinas: { start: 150, end: 900, priority: "MEDIUM" },
};

type UnitRow = { id: string; unitCode: string; building: string; floor: number | null; type: string; position: string | null; area: number | null };

type Deal = { buyer: Buyer; units: UnitRow[]; prices: number[]; agreed: number[] };

export async function seedShowcaseSales(prisma: PrismaClient, clock: Clock) {
  const numbers = new Numbers(prisma);
  const totals = { forSale: 0, reserved: 0, sold: 0, contracts: 0, invoices: 0, payments: 0, buyers: 0 };
  let phoneBase = 3000;
  for (const plan of PLANS) {
    const result = await sellProject(prisma, clock, numbers, plan, phoneBase);
    phoneBase += 400;
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += result[key];
  }
  return { ...totals, leads: await seedLeads(prisma, clock) };
}

const LEAD_INTERESTS: Record<string, string[]> = {
  company_demo_a: ["a two-bedroom flat in Kalaja Block C", "a shop on Rruga e Durrësit", "two flats for rental"],
  company_demo_b: ["an office floor in Porta Tower", "a sea-view flat on the Durrës promenade", "a showroom at Rinas Business Park"],
  company_demo_c: ["a 1,500 m² bay at Nyja", "truck parking and an office at Nyja", "a cold-store bay for phase 2"],
  company_demo_d: ["a penthouse on the Lungomare", "a one-bedroom flat for holiday rental", "a shop on the promenade"],
  company_demo_e: ["a serviced residence in Ksamil", "a residence with a sea view for summer", "a shop on the beach road"],
};

/** New enquiries every week: from the website, referrals, the property fair, social media. */
async function seedLeads(prisma: PrismaClient, clock: Clock) {
  let written = 0;
  for (const [companyIndex, [companyId, interests]] of Object.entries(LEAD_INTERESTS).entries()) {
    const cast = await castOf(prisma, companyId);
    const rand = random(`leads:${companyId}`);
    const pool = new BuyerPool(rand, 6000 + companyIndex * 60);
    const clients = await prisma.client.findMany({ where: { companyId, id: { startsWith: "client_" } }, select: { id: true }, take: 3 });
    for (let index = 0; index < 12; index += 1) {
      const firm = rand.chance(companyId === "company_demo_c" ? 0.9 : 0.15);
      const buyer = firm ? pool.firm() : pool.person(0.3);
      const created = -rand.int(1, 75);
      const status = index < 4 ? "NEW" : index < 7 ? "CONTACTED" : index < 9 ? "QUALIFIED" : index === 9 ? "DISQUALIFIED" : "CONVERTED";
      const converted = status === "CONVERTED" ? clients[index - 10] : undefined;
      await prisma.lead.create({
        data: {
          companyId, name: buyer.kind === "COMPANY" ? `${buyer.firstName} ${buyer.lastName}` : buyer.name, companyName: buyer.kind === "COMPANY" ? buyer.legalName : null, email: buyer.email, phone: buyer.phone,
          source: rand.pick(["WEBSITE", "WEBSITE", "REFERRAL", "EVENT", "SOCIAL", "DIRECT", "PARTNER"] as const), status: status === "CONVERTED" && !converted ? "QUALIFIED" : status,
          ownerMemberId: cast.member("sales"), notes: `Interested in ${rand.pick(interests)}.${buyer.abroad ? ` Lives in ${buyer.city}; prefers video calls.` : ""}`, estimatedValue: dec(priceOf(rand.int(90, 420) * 1000)), currency: EUR,
          disqualifyReason: status === "DISQUALIFIED" ? "Budget well below the price list." : null, convertedAt: converted ? at(clock, created + 10) : null, convertedClientId: converted?.id ?? null,
          createdByMemberId: cast.member("sales"), createdAt: at(clock, index < 4 ? -rand.int(0, 9) : created),
        },
      });
      written += 1;
    }
  }
  return written;
}

async function sellProject(prisma: PrismaClient, clock: Clock, numbers: Numbers, plan: Plan, phoneBase: number) {
  const rand = random(`sales:${plan.projectId}`);
  const cast = await castOf(prisma, plan.companyId);
  const company = await prisma.company.findUniqueOrThrow({ where: { id: plan.companyId }, select: { name: true, legalName: true, registrationNumber: true, address: true } });
  const pool = new BuyerPool(rand, phoneBase);
  const totals = { forSale: 0, reserved: 0, sold: 0, contracts: 0, invoices: 0, payments: 0, buyers: 0 };

  // Units with no price yet: Kalaja's standard-seed stock keeps the ones it already sells.
  const rows = await prisma.projectUnit.findMany({
    where: { projectId: plan.projectId, commercialProfile: null },
    orderBy: [{ floor: { building: { sortOrder: "asc" } } }, { floor: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    select: { id: true, unitCode: true, position: true, saleableArea: true, floor: { select: { number: true, building: { select: { code: true } } } }, unitType: { select: { code: true } } },
  });
  const units: UnitRow[] = rows.map((row) => ({ id: row.id, unitCode: row.unitCode, building: row.floor.building.code ?? "", floor: row.floor.number, type: row.unitType.code, position: row.position, area: row.saleableArea === null ? null : Number(row.saleableArea) }));

  const isExtra = (unit: UnitRow) => unit.type === "PARKING" || unit.type === "STORAGE";
  const onMarket = (unit: UnitRow) => plan.launch[unit.building] !== undefined && !(plan.heldBack?.(unit.unitCode, unit.building) ?? false);
  const priceOfUnit = (unit: UnitRow): { price: number; basis: UnitPriceBasis } => {
    if (plan.fixed[unit.type] !== undefined) return { price: plan.fixed[unit.type]!, basis: "FIXED_UNIT_PRICE" };
    const [low, high] = plan.rates[unit.type] ?? plan.rates.APARTMENT ?? [1500, 1700];
    const floorPremium = 1 + Math.max(0, (unit.floor ?? 0) - 1) * 0.012;
    const corner = unit.position === "CORNER" ? 1.03 : 1;
    const rate = (low + (high - low) * rand.next()) * floorPremium * corner;
    return { price: priceOf(rate * (unit.area ?? 50)), basis: "SALEABLE_AREA" };
  };

  // Extras (parking, storage) wait to be bundled with a home or an office.
  const extras = new Map<string, UnitRow[]>();
  for (const unit of units.filter((row) => isExtra(row) && onMarket(row))) extras.set(unit.building, [...(extras.get(unit.building) ?? []), unit]);
  const takeExtra = (building: string, type: string) => {
    const list = extras.get(building) ?? [...extras.values()][0] ?? [];
    const index = list.findIndex((unit) => unit.type === type);
    return index === -1 ? null : list.splice(index, 1)[0]!;
  };

  const profiles: Prisma.UnitCommercialProfileCreateManyInput[] = [];
  const priceRows: Prisma.UnitPriceHistoryCreateManyInput[] = [];
  const statusRows: Prisma.UnitCommercialStatusHistoryCreateManyInput[] = [];
  const activities: Prisma.ActivityCreateManyInput[] = [];
  const launchOf = (unit: UnitRow) => plan.launch[unit.building] ?? -100;

  /** The price list entry every unit on the market gets, and its history. */
  const list = (unit: UnitRow, status: UnitCommercialStatus, changedAt: number, extra: Partial<Prisma.UnitCommercialProfileCreateManyInput> = {}) => {
    const { price, basis } = priceOfUnit(unit);
    const launch = launchOf(unit);
    // A third of the stock was repriced once, after the first sales.
    const repriced = rand.chance(0.33) && launch < -90;
    const launchPrice = repriced ? priceOf(price / 1.04) : price;
    priceRows.push({ companyId: plan.companyId, projectId: plan.projectId, unitId: unit.id, oldPrice: null, newPrice: dec(launchPrice), oldCurrency: null, currency: EUR, oldPriceBasis: null, priceBasis: basis, reason: "Launch price list", changedByMemberId: cast.member("salesHead"), changedAt: at(clock, launch) });
    if (repriced) {
      const when = Math.round(launch / 2);
      priceRows.push({ companyId: plan.companyId, projectId: plan.projectId, unitId: unit.id, oldPrice: dec(launchPrice), newPrice: dec(price), oldCurrency: EUR, currency: EUR, oldPriceBasis: basis, priceBasis: basis, reason: "Second price list, after the first releases sold", changedByMemberId: cast.member("salesHead"), changedAt: at(clock, when) });
    }
    statusRows.push({ companyId: plan.companyId, projectId: plan.projectId, unitId: unit.id, fromStatus: "NOT_FOR_SALE", toStatus: "FOR_SALE", source: "USER", actorMemberId: cast.member("salesHead"), changedAt: at(clock, launch) });
    profiles.push({ companyId: plan.companyId, projectId: plan.projectId, unitId: unit.id, status, askingPrice: dec(price), currency: EUR, priceBasis: basis, statusChangedAt: at(clock, changedAt), version: (repriced ? 2 : 1) + 1, updatedByMemberId: cast.member("salesHead"), createdAt: at(clock, launch), ...extra });
    return price;
  };

  const mains = units.filter((unit) => !isExtra(unit));
  for (const unit of mains) {
    if (!onMarket(unit)) continue;
    const mix = plan.mix[unit.building] ?? { sold: 0.2, reserved: 0.1, hold: 0 };
    // The units the project conversations talk about keep their story; the rest fall where the mix puts them.
    const forced = plan.force?.[unit.unitCode];
    const roll = forced === "SOLD" ? 0 : forced === "RESERVED" ? mix.sold : forced === "ON_HOLD" ? mix.sold + mix.reserved : forced === "FOR_SALE" ? 1 : rand.next();
    if (forced === "ON_HOLD" || (forced === undefined && roll >= mix.sold + mix.reserved && roll < mix.sold + mix.reserved + mix.hold)) {
      const changed = rand.int(-30, -3);
      const reason = plan.holdReasons?.[unit.unitCode] ?? rand.pick(HOLD_REASONS);
      list(unit, "ON_HOLD", changed, { holdReason: reason, holdUntil: at(clock, rand.int(7, 40)), heldByMemberId: cast.member("salesHead") });
      statusRows.push({ companyId: plan.companyId, projectId: plan.projectId, unitId: unit.id, fromStatus: "FOR_SALE", toStatus: "ON_HOLD", reason, source: "USER", actorMemberId: cast.member("salesHead"), changedAt: at(clock, changed) });
    } else if (roll < mix.sold) {
      const deal = makeDeal(unit);
      const soldAt = rand.int(launchOf(unit) + 10, plan.schedule === "complete" ? plan.handover - 30 : -6);
      await sell(deal, soldAt);
    } else if (roll < mix.sold + mix.reserved) {
      const deal = makeDeal(unit);
      // The second release of Ksamil reserved this month, mostly from abroad.
      await reserve(deal, rand.int(Math.max(launchOf(unit), -28), -1));
    } else {
      list(unit, "FOR_SALE", launchOf(unit));
      totals.forSale += 1;
      if (rand.chance(0.08)) await lapsedReservation(unit);
    }
  }
  // Extras nobody bundled stay on the price list.
  for (const unit of [...extras.values()].flat()) {
    list(unit, "FOR_SALE", launchOf(unit));
    totals.forSale += 1;
  }

  await prisma.unitCommercialProfile.createMany({ data: profiles });
  await prisma.unitPriceHistory.createMany({ data: priceRows });
  await prisma.unitCommercialStatusHistory.createMany({ data: statusRows });
  await prisma.activity.createMany({ data: activities });
  return totals;

  /* ------------------------------------------------------------------------ */

  function makeDeal(unit: UnitRow): Deal {
    const commercial = unit.type === "OFFICE" || unit.type === "WAREHOUSE" || unit.type === "SHOP";
    const buyer = rand.chance(commercial ? Math.max(plan.buyers.firms, 0.6) : plan.buyers.firms) ? pool.firm() : pool.person(plan.buyers.abroad);
    const deal: Deal = { buyer, units: [unit], prices: [], agreed: [] };
    const homeOrOffice = ["APARTMENT", "PENTHOUSE", "OFFICE", "VILLA", "WAREHOUSE"].includes(unit.type);
    if (homeOrOffice && rand.chance(unit.type === "WAREHOUSE" ? 0.8 : 0.55)) {
      const space = takeExtra(unit.building, "PARKING");
      if (space) deal.units.push(space);
    }
    if (homeOrOffice && rand.chance(0.25)) {
      const store = takeExtra(unit.building, "STORAGE");
      if (store) deal.units.push(store);
    }
    // A bay's mezzanine office goes with the bay.
    if (unit.type === "WAREHOUSE") {
      const mezzanine = mains.find((row) => row.unitCode === unit.unitCode.replace(/^WA-/, "WA-M"));
      if (mezzanine) {
        mains.splice(mains.indexOf(mezzanine), 1);
        deal.units.push(mezzanine);
      }
    }
    return deal;
  }

  async function client(buyer: Buyer, createdAt: number) {
    const id = `client_${plan.key ?? "kal"}_${totals.buyers + 1}`;
    totals.buyers += 1;
    await prisma.client.create({
      data: {
        id,
        companyId: plan.companyId,
        name: buyer.name,
        legalName: buyer.legalName,
        normalizedName: normalizeName(buyer.name),
        type: buyer.kind,
        email: buyer.email,
        phone: buyer.phone,
        city: buyer.city,
        country: buyer.country,
        createdBy: cast.user("sales"),
        createdAt: at(clock, createdAt),
        contacts:
          buyer.kind === "COMPANY"
            ? { create: [{ companyId: plan.companyId, firstName: buyer.firstName, lastName: buyer.lastName, jobTitle: "Managing Director", email: `${buyer.firstName.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}@${buyer.email.split("@")[1]}`, phone: buyer.phone, isPrimary: true, createdBy: cast.user("sales"), createdAt: at(clock, createdAt) }] }
            : undefined,
      },
    });
    return id;
  }

  function dealName(deal: Deal) {
    return `${deal.buyer.name} — ${deal.units.map((unit) => unit.unitCode).join(" + ")}`;
  }

  async function opportunity(deal: Deal, clientId: string, opened: number, stage: "WON" | "NEGOTIATION" | "LOST", closed?: number) {
    const id = `opp_${clientId.replace(/^client_/, "")}`;
    const value = deal.agreed.reduce((sum, amount) => sum + amount, 0);
    await prisma.opportunity.create({
      data: {
        id,
        companyId: plan.companyId,
        clientId,
        ownerMemberId: cast.member("sales"),
        name: dealName(deal),
        stage,
        currency: EUR,
        estimatedValue: dec(value),
        expectedCloseDate: stage === "NEGOTIATION" ? businessDay(clock, rand.int(5, 40)) : null,
        actualCloseDate: closed === undefined ? null : businessDay(clock, closed),
        wonReason: stage === "WON" ? rand.pick(WON_REASONS) : null,
        lostReason: stage === "LOST" ? "PRICE" : null,
        lostNote: stage === "LOST" ? "Bought elsewhere after the reservation lapsed." : null,
        nextStep: stage === "NEGOTIATION" ? rand.pick(NEXT_STEPS) : null,
        stageChangedAt: at(clock, closed ?? opened),
        createdByMemberId: cast.member("sales"),
        createdAt: at(clock, opened),
      },
    });
    return id;
  }

  async function reservationsFor(deal: Deal, clientId: string, opportunityId: string, reservedAt: number, status: "ACTIVE" | "CONVERTED_TO_SALE" | "EXPIRED", closedAt?: number) {
    const ids: string[] = [];
    for (const [index, unit] of deal.units.entries()) {
      const id = `res_${unit.id.replace(/^unit_/, "")}_${reservedAt < 0 ? -reservedAt : reservedAt}`;
      const expires = status === "ACTIVE" ? rand.int(3, 21) : reservedAt + 14;
      await prisma.unitReservation.create({
        data: {
          id,
          companyId: plan.companyId,
          projectId: plan.projectId,
          unitId: unit.id,
          clientId,
          opportunityId,
          status,
          reservedAt: at(clock, reservedAt),
          expiresAt: at(clock, expires, 18),
          closedAt: closedAt === undefined ? null : at(clock, closedAt),
          closedByMemberId: closedAt === undefined ? null : cast.member("sales"),
          closeReason: status === "EXPIRED" ? "The reservation lapsed without a deposit." : null,
          agreedPrice: dec(deal.agreed[index]!),
          currency: EUR,
          notes: index === 0 && status === "ACTIVE" ? rand.pick(RESERVATION_NOTES) : null,
          createdByMemberId: cast.member("sales"),
          createdAt: at(clock, reservedAt),
        },
      });
      ids.push(id);
      if (status !== "EXPIRED") {
        await prisma.opportunityUnit.create({ data: { companyId: plan.companyId, projectId: plan.projectId, opportunityId, unitId: unit.id, agreedPrice: dec(deal.agreed[index]!), currency: EUR, createdByMemberId: cast.member("sales"), createdAt: at(clock, reservedAt) } });
      }
      activities.push(activity(unit.id, "sales", "UNIT_RESERVED", `reserved ${unit.unitCode} until ${at(clock, expires).toISOString().slice(0, 10)}`, cast, reservedAt));
    }
    return ids;
  }

  function priceDeal(deal: Deal, status: UnitCommercialStatus, changedAt: number) {
    for (const unit of deal.units) {
      const price = list(unit, status, changedAt);
      deal.prices.push(price);
      // Agreed a little under asking on the bigger units.
      deal.agreed.push(unit.type === "PARKING" || unit.type === "STORAGE" ? price : priceOf(price * (1 - rand.int(0, 4) / 100)));
    }
  }

  async function reserve(deal: Deal, reservedAt: number) {
    priceDeal(deal, "RESERVED", reservedAt);
    const opened = reservedAt - rand.int(10, 40);
    const clientId = await client(deal.buyer, opened);
    const opportunityId = await opportunity(deal, clientId, opened, "NEGOTIATION");
    const reservations = await reservationsFor(deal, clientId, opportunityId, reservedAt, "ACTIVE");
    for (const unit of deal.units) statusRows.push({ companyId: plan.companyId, projectId: plan.projectId, unitId: unit.id, fromStatus: "FOR_SALE", toStatus: "RESERVED", source: "USER", actorMemberId: cast.member("sales"), reservationId: reservations[deal.units.indexOf(unit)]!, opportunityId, changedAt: at(clock, reservedAt) });
    totals.reserved += deal.units.length;

    // Some wait on Legal: a contract asked for, or one already in review.
    const step = rand.next();
    if (step < 0.3) {
      await prisma.unitContractRequest.create({ data: { id: `ucr_${reservations[0]!}`, companyId: plan.companyId, projectId: plan.projectId, unitId: deal.units[0]!.id, reservationId: reservations[0]!, clientId, opportunityId, notes: deal.units.length > 1 ? `${deal.units.map((unit) => unit.unitCode).join(", ")} on one contract.` : null, requestedByMemberId: cast.member("sales"), requestedAt: at(clock, Math.min(-1, reservedAt + 1)) } });
      activities.push(activity(deal.units[0]!.id, "contracts", "UNIT_CONTRACT_REQUESTED", `asked Legal for a contract for ${deal.units[0]!.unitCode}`, cast, Math.min(-1, reservedAt + 1)));
    } else if (step < 0.55) {
      const contractId = await contract(deal, clientId, opportunityId, Math.min(-1, reservedAt + 2), rand.chance(0.5) ? "IN_REVIEW" : "PENDING_APPROVAL");
      await prisma.unitContractRequest.create({ data: { id: `ucr_${reservations[0]!}`, companyId: plan.companyId, projectId: plan.projectId, unitId: deal.units[0]!.id, reservationId: reservations[0]!, clientId, opportunityId, status: "FULFILLED", requestedByMemberId: cast.member("sales"), requestedAt: at(clock, reservedAt), contractId, closedByMemberId: cast.member("legal"), closedAt: at(clock, Math.min(-1, reservedAt + 2)) } });
    }
  }

  async function lapsedReservation(unit: UnitRow) {
    const deal: Deal = { buyer: pool.person(plan.buyers.abroad), units: [unit], prices: [], agreed: [] };
    const reservedAt = rand.int(Math.max(launchOf(unit) + 5, -120), -30);
    deal.agreed.push(Number(profiles[profiles.length - 1]!.askingPrice));
    const clientId = await client(deal.buyer, reservedAt - 7);
    const opportunityId = await opportunity(deal, clientId, reservedAt - 7, "LOST", reservedAt + 15);
    const [reservationId] = await reservationsFor(deal, clientId, opportunityId, reservedAt, "EXPIRED", reservedAt + 14);
    statusRows.push(
      { companyId: plan.companyId, projectId: plan.projectId, unitId: unit.id, fromStatus: "FOR_SALE", toStatus: "RESERVED", source: "USER", actorMemberId: cast.member("sales"), reservationId, opportunityId, changedAt: at(clock, reservedAt) },
      { companyId: plan.companyId, projectId: plan.projectId, unitId: unit.id, fromStatus: "RESERVED", toStatus: "FOR_SALE", reason: "Reservation expired", source: "SYSTEM_EXPIRY", reservationId, changedAt: at(clock, reservedAt + 14) },
    );
  }

  async function sell(deal: Deal, soldAt: number) {
    const reservedAt = soldAt - rand.int(7, 21);
    priceDeal(deal, "SOLD", soldAt);
    const opened = reservedAt - rand.int(10, 45);
    const clientId = await client(deal.buyer, opened);
    const opportunityId = await opportunity(deal, clientId, opened, "WON", soldAt);
    const reservations = await reservationsFor(deal, clientId, opportunityId, reservedAt, "CONVERTED_TO_SALE", soldAt);
    for (const [index, unit] of deal.units.entries()) {
      statusRows.push(
        { companyId: plan.companyId, projectId: plan.projectId, unitId: unit.id, fromStatus: "FOR_SALE", toStatus: "RESERVED", source: "USER", actorMemberId: cast.member("sales"), reservationId: reservations[index]!, opportunityId, changedAt: at(clock, reservedAt) },
        { companyId: plan.companyId, projectId: plan.projectId, unitId: unit.id, fromStatus: "RESERVED", toStatus: "SOLD", source: "USER", actorMemberId: cast.member("sales"), reservationId: reservations[index]!, opportunityId, changedAt: at(clock, soldAt) },
      );
      activities.push(activity(unit.id, "sales", "UNIT_MARKED_SOLD", `marked ${unit.unitCode} Sold`, cast, soldAt));
    }
    totals.sold += deal.units.length;
    const complete = plan.schedule === "complete";
    const contractId = await contract(deal, clientId, opportunityId, soldAt, complete ? "COMPLETED" : "ACTIVE");
    if (soldAt > -200) {
      await prisma.unitContractRequest.create({ data: { id: `ucr_${reservations[0]!}`, companyId: plan.companyId, projectId: plan.projectId, unitId: deal.units[0]!.id, reservationId: reservations[0]!, clientId, opportunityId, status: "FULFILLED", requestedByMemberId: cast.member("sales"), requestedAt: at(clock, reservedAt + 1), contractId, closedByMemberId: cast.member("legal"), closedAt: at(clock, soldAt - 2) } });
    }
    await collect(deal, clientId, contractId, soldAt);
  }

  async function contract(deal: Deal, clientId: string, opportunityId: string, when: number, status: ContractStatus) {
    const value = deal.agreed.reduce((sum, amount) => sum + amount, 0);
    const signed = status === "ACTIVE" || status === "COMPLETED";
    const number = await numbers.take({ companyId: plan.companyId, table: "contracts", column: "contractNumber", prefix: "CTR", year: at(clock, when).getUTCFullYear() });
    const id = `contract_${number.toLowerCase().replace(/-/g, "_")}_${plan.companyId.slice(-1)}`;
    const codes = deal.units.map((unit) => unit.unitCode).join(", ");
    await prisma.contract.create({
      data: {
        id,
        companyId: plan.companyId,
        contractNumber: number,
        title: `Sale agreement — ${codes}`,
        contractType: "SALE_AGREEMENT",
        clientId,
        projectId: plan.projectId,
        opportunityId,
        ownerMemberId: cast.member("legal"),
        status,
        counterpartyName: deal.buyer.legalName ?? deal.buyer.name,
        currency: EUR,
        contractValue: dec(value),
        governingLaw: "Albania",
        jurisdiction: "Tirana District Court",
        sentAt: signed ? at(clock, when - 3) : null,
        signedDate: signed ? businessDay(clock, when) : null,
        effectiveDate: signed ? businessDay(clock, when) : null,
        completedAt: status === "COMPLETED" ? at(clock, plan.handover + 20) : null,
        completedByMemberId: status === "COMPLETED" ? cast.member("legal") : null,
        summary: `The sale of ${codes} to ${deal.buyer.name}, notarised in ${status === "COMPLETED" ? "full" : "line with the payment schedule"}.`,
        createdByMemberId: cast.member("legal"),
        createdAt: at(clock, when - 6),
      },
    });
    for (const [index, unit] of deal.units.entries()) {
      await prisma.contractUnit.create({ data: { companyId: plan.companyId, projectId: plan.projectId, contractId: id, unitId: unit.id, value: dec(deal.agreed[index]!), currency: EUR, createdByMemberId: cast.member("legal"), createdAt: at(clock, when - 6) } });
    }
    await prisma.contractParty.createMany({
      data: [
        { companyId: plan.companyId, contractId: id, partyRole: "OUR_COMPANY", partyType: "COMPANY", name: company.name, legalName: company.legalName, registrationNumber: company.registrationNumber, address: company.address, country: "Albania", signatoryName: cast.name("ceo"), signatoryTitle: "Administrator", isPrimaryCounterparty: false },
        { companyId: plan.companyId, contractId: id, partyRole: "CLIENT", partyType: deal.buyer.kind, name: deal.buyer.name, legalName: deal.buyer.legalName, clientId, city: deal.buyer.city, country: deal.buyer.country, signatoryName: `${deal.buyer.firstName} ${deal.buyer.lastName}`, signatoryTitle: deal.buyer.kind === "COMPANY" ? "Administrator" : null, isPrimaryCounterparty: true },
      ],
    });
    if (signed) {
      await prisma.contractObligation.createMany({
        data: [
          { companyId: plan.companyId, contractId: id, title: `Hand over ${codes}`, description: "Keys, the as-built plans and the occupancy certificate.", obligationType: "DELIVERABLE", responsibleMemberId: cast.member("pm"), dueDate: businessDay(clock, plan.handover), status: status === "COMPLETED" ? "COMPLETED" : "OPEN", completedAt: status === "COMPLETED" ? at(clock, plan.handover) : null, createdByMemberId: cast.member("legal"), createdAt: at(clock, when) },
          { companyId: plan.companyId, contractId: id, title: "Register the title with the cadastre", description: "File the notarised contract with ASHK once the balance is paid.", obligationType: "COMPLIANCE", responsibleMemberId: cast.member("legal"), dueDate: businessDay(clock, plan.handover + 30), status: status === "COMPLETED" ? "COMPLETED" : "OPEN", completedAt: status === "COMPLETED" ? at(clock, plan.handover + 25) : null, createdByMemberId: cast.member("legal"), createdAt: at(clock, when) },
        ],
      });
      activities.push(activity(deal.units[0]!.id, "contracts", "UNIT_CONTRACT_MARK_SIGNED", `recorded sale contract ${number} as signed`, cast, when, "legal"));
    }
    if (status === "PENDING_APPROVAL") {
      await prisma.contractApproval.create({ data: { companyId: plan.companyId, recordType: "CONTRACT", recordId: id, status: "PENDING", submittedByMemberId: cast.member("legal"), submittedAt: at(clock, when) } });
    }
    totals.contracts += 1;
    return id;
  }

  /** The payment schedule, the invoices for what fell due, and what was paid. */
  async function collect(deal: Deal, clientId: string, contractId: string, signedAt: number) {
    const value = deal.agreed.reduce((sum, amount) => sum + amount, 0);
    const shares =
      plan.schedule === "commercial"
        ? [
            { label: "Deposit", type: "DEPOSIT" as const, share: 0.2, due: signedAt + 5 },
            { label: "Balance", type: "BALANCE" as const, share: 0.8, due: plan.handover },
          ]
        : plan.schedule === "complete"
          ? [
              { label: "Deposit", type: "DEPOSIT" as const, share: 0.2, due: signedAt + 5 },
              { label: "Installment 1", type: "INSTALLMENT" as const, share: 0.4, due: Math.round((signedAt + plan.handover) / 2) },
              { label: "Balance", type: "BALANCE" as const, share: 0.4, due: plan.handover },
            ]
          : [
              { label: "Deposit", type: "DEPOSIT" as const, share: 0.1, due: signedAt + 5 },
              { label: "Installment 1 — structure", type: "INSTALLMENT" as const, share: 0.3, due: Math.min(signedAt + 150, plan.handover - 120) },
              { label: "Installment 2 — envelope", type: "INSTALLMENT" as const, share: 0.3, due: Math.min(signedAt + 300, plan.handover - 30) },
              { label: "Balance — handover", type: "BALANCE" as const, share: 0.3, due: plan.handover },
            ];
    // Due dates never run backwards, even for a late sale.
    for (let index = 1; index < shares.length; index += 1) shares[index]!.due = Math.max(shares[index]!.due, shares[index - 1]!.due + 30);

    const complete = plan.schedule === "complete";
    const scheduleId = `sched_${contractId}`;
    await prisma.paymentSchedule.create({
      data: { id: scheduleId, companyId: plan.companyId, contractId, versionNumber: 1, status: complete ? "COMPLETED" : "ACTIVE", currency: EUR, activatedAt: at(clock, signedAt + 1), activatedByMemberId: cast.member("finance"), completedAt: complete ? at(clock, plan.handover + 5) : null, createdByMemberId: cast.member("finance"), createdAt: at(clock, signedAt + 1) },
    });
    let allocated = 0;
    const late = !complete && rand.chance(0.12);
    for (const [index, part] of shares.entries()) {
      const amount = index === shares.length - 1 ? round2(value - allocated) : round2(value * part.share);
      allocated = round2(allocated + amount);
      const installmentId = `inst_${contractId}_${index + 1}`;
      await prisma.paymentInstallment.create({ data: { id: installmentId, companyId: plan.companyId, contractId, scheduleId, sequence: index + 1, label: part.label, type: part.type, amount: dec(amount), currency: EUR, dueDate: businessDay(clock, part.due), createdAt: at(clock, signedAt + 1) } });

      // Invoiced two weeks before it falls due, once that day has come.
      const issued = Math.max(signedAt + 1, part.due - 14);
      if (issued > 0) continue;
      const invoiceNumber = await numbers.take({ companyId: plan.companyId, table: "invoices", column: "invoiceNumber", prefix: "INV", year: at(clock, issued).getUTCFullYear() });
      const invoiceId = `invoice_${installmentId}`;
      await prisma.invoice.create({
        data: {
          id: invoiceId,
          companyId: plan.companyId,
          invoiceNumber,
          clientId,
          projectId: plan.projectId,
          contractId,
          installmentId,
          issueDate: businessDay(clock, issued),
          dueDate: businessDay(clock, part.due),
          currency: EUR,
          subtotal: dec(amount),
          taxAmount: dec(0),
          totalAmount: dec(amount),
          status: "SENT",
          sentAt: at(clock, issued),
          notes: `${part.label} of the payment schedule, contract for ${deal.units.map((unit) => unit.unitCode).join(", ")}.`,
          createdByMemberId: cast.member("finance"),
          createdAt: at(clock, issued),
          lineItems: { create: [{ description: `${part.label} — ${deal.units.map((unit) => unit.unitCode).join(", ")}`, quantity: dec(1), unitPrice: dec(amount), taxRate: dec(0), subtotal: dec(amount), taxAmount: dec(0), totalAmount: dec(amount), sortOrder: 0 }] },
        },
      });
      totals.invoices += 1;

      // Paid around the due date — but one buyer in eight is behind on the latest installment.
      if (part.due > -1) continue;
      const lastDue = shares.filter((row) => row.due <= -1).length - 1 === index;
      if (late && lastDue) {
        if (rand.chance(0.5)) await pay(contractId, clientId, installmentId, invoiceId, round2(amount * 0.4), part.due - 2);
        continue;
      }
      await pay(contractId, clientId, installmentId, invoiceId, amount, Math.min(-1, part.due + rand.int(-5, 6)));
    }
  }

  async function pay(contractId: string, clientId: string, installmentId: string, invoiceId: string, amount: number, when: number) {
    const id = `pay_${installmentId}_${when < 0 ? -when : when}`;
    await prisma.payment.create({ data: { id, companyId: plan.companyId, direction: "RECEIPT", clientId, contractId, projectId: plan.projectId, amount: dec(amount), currency: EUR, paymentDate: businessDay(clock, when), method: rand.chance(0.92) ? "BANK_TRANSFER" : "CHECK", reference: `TR-${installmentId.slice(-12).toUpperCase()}`, status: "RECORDED", createdByMemberId: cast.member("finance"), createdAt: at(clock, when) } });
    await prisma.paymentAllocation.create({ data: { id: `alloc_${id}`, companyId: plan.companyId, paymentId: id, contractId, installmentId, invoiceId, amount: dec(amount), createdByMemberId: cast.member("finance"), createdAt: at(clock, when) } });
    totals.payments += 1;
  }

  function activity(unitId: string, module: string, action: string, message: string, who: Cast, when: number, part: "sales" | "legal" = "sales"): Prisma.ActivityCreateManyInput {
    return { companyId: plan.companyId, module, entityType: "ProjectUnit", entityId: unitId, action, message, actorMemberId: who.member(part), actorUserId: who.user(part), metadata: { projectId: plan.projectId }, createdAt: at(clock, when) };
  }
}

const HOLD_REASONS = [
  "Held for the show apartment until handover.",
  "Kept back for the owner's family.",
  "Held while the bank values the floor for a bulk purchase.",
  "Held for a buyer who is selling a flat in Tirana first.",
  "Off the list until the façade samples are approved.",
];
const WON_REASONS = ["Sea view and the payment plan", "Price per m² against the neighbourhood", "Parking on the same contract", "Handover date fits the buyer's move", "Bank financing approved"];
const NEXT_STEPS = ["Deposit by bank transfer this week", "Second viewing with the family on Saturday", "Waiting on the bank's valuation", "Contract draft to the buyer's notary", "Buyer flying in to sign next week"];
const RESERVATION_NOTES = ["Deposit expected with the signed reservation form.", "Buyer abroad; signing by power of attorney.", "Wants the parking space next to the lift.", "Bank pre-approval attached to the reservation.", "Asked for the kitchen upgrade quote."];

