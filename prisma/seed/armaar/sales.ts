/**
 * Selling Tirana Lake and Square 21 (D-01 §21, §53, §54, §103; E-05E, E-05F).
 *
 * The whole chain the product runs, reused, never a second sales engine:
 * a price and its history, a client, a deal, a reservation, a sale agreement in
 * Legal on the unit, a payment schedule in Finance, payments allocated to its
 * installments by the one allocation engine's rules (§57, §103).
 *
 * - Square 21, completed: nearly sold out. Most sales long paid off (contract
 *   and schedule COMPLETED); four still paying; two reserved; two shops left.
 * - Tirana Lake, on site: a third sold, contracts ACTIVE and paying — one
 *   installment in every five missed and now overdue; reservations waiting,
 *   two of them with a contract asked of Legal; two units held; the rest on
 *   sale; the penthouse and the 4+1s not yet published.
 *
 * Buyers, prices and payments are synthetic (§77). Idempotent: a unit that
 * already has its commercial profile is left as it is.
 */
import { Prisma, type PrismaClient, type UnitCommercialStatus } from "@prisma/client";

import { normalizeName } from "../../../lib/modules/clients/client.duplicate";
import { memberId } from "./access";
import { companyId } from "./organization";
import { userId } from "./people";
import { projectId } from "./projects";
import type { SeededUnit } from "./units";

const BCI = "BUILDING_CONSTRUCTION_INVEST" as const;
const EUR = "EUR";
const DAY = 86_400_000;
const days = (offset: number) => new Date(Date.now() + offset * DAY);
const businessDay = (offset: number) => {
  const date = days(offset);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
};
const dec = (value: number) => new Prisma.Decimal(value.toFixed(2));
const round500 = (value: number) => Math.round(value / 500) * 500;

type Outcome = "SOLD_PAID" | "SOLD_PAYING" | "RESERVED" | "RESERVED_REQUESTED" | "ON_HOLD" | "FOR_SALE" | "NOT_FOR_SALE";

const FIRST = ["Ardit", "Besa", "Blerta", "Dorina", "Elion", "Endrit", "Fjona", "Gerti", "Holta", "Ilda", "Jetmir", "Kejsi", "Laura", "Mario", "Nora", "Orges", "Pranvera", "Rei", "Sara", "Tedi", "Uendi", "Valon", "Xhoana", "Ylli", "Zamira", "Ergi", "Ana", "Bledar", "Dafina", "Enea"];
const LAST = ["Hoxha", "Shehu", "Leka", "Gjoni", "Krasniqi", "Mehmeti", "Prifti", "Dervishi", "Kodra", "Luli", "Pepa", "Zeneli", "Hysa", "Dema", "Cela", "Koci", "Bejko", "Tahiri", "Musaj", "Gashi", "Lika", "Pllumi", "Sinani", "Xhafa", "Vata", "Bardhi", "Toska", "Qama", "Brahimi"];
/** Companies that buy offices and shops. Synthetic names for the demo. */
const COMPANY_BUYERS = ["Liqeni Retail sh.p.k.", "Vista Office Partners sh.p.k.", "Adria Pharma Stores sh.p.k.", "Nord Coffee Co. sh.p.k.", "Metro Dental Clinics sh.p.k.", "Blu Fitness sh.p.k."];

/** What happens to each sellable unit, in the order the units are listed. */
function outcomeOf(unit: SeededUnit, index: number): Outcome {
  if (!unit.publish) return "NOT_FOR_SALE";
  if (unit.project === "SQUARE_21") {
    if (unit.type === "SHOP") return unit.code.endsWith("01") ? "SOLD_PAID" : "FOR_SALE";
    if (unit.floor >= 6 && unit.code.endsWith("04")) return "RESERVED";
    if (unit.floor === 5 && unit.code.endsWith("01")) return "SOLD_PAYING";
    if (unit.floor === 6 && unit.code.endsWith("01")) return "SOLD_PAYING";
    return "SOLD_PAID";
  }
  if (unit.type === "OFFICE") return unit.floor === 1 ? "SOLD_PAYING" : unit.floor === 2 && unit.code.endsWith("01") ? "RESERVED" : "FOR_SALE";
  if (unit.type === "SHOP") return unit.code === "SH-A01" || unit.code === "SH-P05" ? "SOLD_PAYING" : unit.code === "SH-P01" ? "RESERVED" : "FOR_SALE";
  if (unit.floor <= 4) return index % 8 === 5 ? "RESERVED" : "SOLD_PAYING";
  if (unit.floor <= 7) return unit.code.endsWith("01") ? "SOLD_PAYING" : unit.code.endsWith("02") ? (unit.floor % 2 ? "RESERVED_REQUESTED" : "RESERVED") : unit.code.endsWith("03") && unit.floor === 6 ? "RESERVED" : "FOR_SALE";
  if (unit.floor === 10 && (unit.code.endsWith("01") || unit.code.endsWith("04"))) return "ON_HOLD";
  return "FOR_SALE";
}

function askingPrice(unit: SeededUnit, saleable: number): number {
  const lake = unit.project === "TIRANA_LAKE";
  const rate = unit.type === "SHOP" ? (lake ? 3000 : 2600) : unit.type === "OFFICE" ? 2100 : (lake ? 2400 : 1650) * (1 + unit.floor * (lake ? 0.015 : 0.01));
  return round500(saleable * rate);
}

export async function seedArmaarSales(prisma: PrismaClient, units: SeededUnit[]) {
  const company = companyId(BCI);
  const manager = memberId("bci.sales", BCI);
  const agentLake = memberId("bci.sales-agent", BCI);
  const agentSquare = memberId("bci.sales-agent2", BCI);
  const legal = memberId("bci.legal", BCI);
  const finance = memberId("bci.finance-specialist", BCI);
  const userOf: Record<string, string> = {
    [manager]: userId("bci.sales"),
    [agentLake]: userId("bci.sales-agent"),
    [agentSquare]: userId("bci.sales-agent2"),
    [legal]: userId("bci.legal"),
    [finance]: userId("bci.finance-specialist"),
  };

  const trail = async (unitId: string, project: string, module: string, action: string, message: string, by: string, at: number) => {
    if (at < -45) return; // The feed shows the recent weeks; older history lives in the records themselves.
    await prisma.activity.create({ data: { companyId: company, module, entityType: "ProjectUnit", entityId: unitId, action, message, actorMemberId: by, actorUserId: userOf[by]!, metadata: { projectId: project }, createdAt: days(at) } });
  };

  let buyer = 0;
  let companyBuyer = 0;
  let contractSequence = 0;

  for (const [index, unit] of units.entries()) {
    const outcome = outcomeOf(unit, index);
    if (outcome === "NOT_FOR_SALE") continue;
    if (await prisma.unitCommercialProfile.findUnique({ where: { unitId: unit.id }, select: { id: true } })) continue;

    const project = projectId(unit.project);
    const lake = unit.project === "TIRANA_LAKE";
    const agent = lake ? agentLake : agentSquare;
    const row = await prisma.projectUnit.findUniqueOrThrow({ where: { id: unit.id }, select: { saleableArea: true } });
    const asking = askingPrice(unit, Number(row.saleableArea));
    const launch = lake ? -540 : -1560;
    const slug = unit.id.replace(/^armaar_unit_/, "");

    // When it sold: Square 21 over its three selling years, Tirana Lake over the last eighteen months.
    // Square 21's last few sold after completion and are still paying.
    const soldAt = lake ? -520 + ((index * 23) % 500) : outcome === "SOLD_PAYING" ? -150 - (index % 60) : -1480 + ((index * 37) % 1050);
    const sold = outcome === "SOLD_PAID" || outcome === "SOLD_PAYING";
    const reserved = outcome === "RESERVED" || outcome === "RESERVED_REQUESTED";
    const reservedAt = sold ? soldAt - 10 : -2 - (index % 9);

    /* The buyer and the deal ------------------------------------------------ */
    let clientId: string | null = null;
    let clientName = "";
    let opportunityId: string | null = null;
    let agreed = asking;
    if (sold || reserved) {
      const corporate = unit.type === "OFFICE" || unit.type === "SHOP";
      clientName = corporate ? COMPANY_BUYERS[companyBuyer++ % COMPANY_BUYERS.length]! : `${FIRST[buyer % FIRST.length]} ${LAST[(buyer * 7) % LAST.length]}`;
      if (!corporate) buyer += 1;
      // A company that buys twice is one client (PRD #12 §55); each person buys once.
      const clientKey = corporate ? normalizeName(clientName).replace(/[^a-z0-9]+/g, "_") : slug;
      clientId = `armaar_client_${clientKey}`;
      await prisma.client.upsert({
        where: { id: clientId },
        update: {},
        create: {
          id: clientId,
          companyId: company,
          code: `BCI-C-${clientKey.toUpperCase().slice(0, 20)}`,
          name: clientName,
          legalName: corporate ? clientName : null,
          type: corporate ? "COMPANY" : "INDIVIDUAL",
          status: "ACTIVE",
          email: `${clientKey}@buyer.armaar-demo.test`,
          phone: `+355 69 001 ${String(1000 + index).slice(-4)}`,
          city: "Tirana",
          country: "Albania",
          normalizedName: normalizeName(clientName),
          createdBy: userOf[agent]!,
          createdAt: days(reservedAt - 14),
        },
      });
      agreed = round500(asking * (0.97 + (index % 3) * 0.01));
      opportunityId = `armaar_opp_${slug}`;
      await prisma.opportunity.upsert({
        where: { id: opportunityId },
        update: {},
        create: {
          id: opportunityId,
          companyId: company,
          name: `${clientName} — ${unit.code}`,
          clientId,
          ownerMemberId: agent,
          stage: sold ? "WON" : "NEGOTIATION",
          stageChangedAt: days(sold ? soldAt : reservedAt),
          estimatedValue: dec(agreed),
          currency: EUR,
          expectedCloseDate: sold ? null : businessDay(20),
          actualCloseDate: sold ? businessDay(soldAt) : null,
          wonReason: sold ? "Signed the sale agreement." : null,
          createdByMemberId: agent,
          createdAt: days(reservedAt - 14),
        },
      });
    }

    /* The reservation ------------------------------------------------------- */
    let reservationId: string | null = null;
    if (sold || reserved) {
      reservationId = `armaar_res_${slug}`;
      await prisma.unitReservation.create({
        data: {
          id: reservationId,
          companyId: company,
          projectId: project,
          unitId: unit.id,
          clientId: clientId!,
          opportunityId: opportunityId!,
          status: sold ? "CONVERTED_TO_SALE" : "ACTIVE",
          reservedAt: days(reservedAt),
          expiresAt: days(sold ? reservedAt + 14 : reservedAt + 14),
          closedAt: sold ? days(soldAt) : null,
          closedByMemberId: sold ? agent : null,
          agreedPrice: dec(agreed),
          currency: EUR,
          createdByMemberId: agent,
          createdAt: days(reservedAt),
        },
      });
      await prisma.opportunityUnit.create({ data: { companyId: company, projectId: project, opportunityId: opportunityId!, unitId: unit.id, agreedPrice: dec(agreed), currency: EUR, createdByMemberId: agent, createdAt: days(reservedAt) } });
      await trail(unit.id, project, "sales", "UNIT_RESERVED", `reserved ${unit.code} until ${days(reservedAt + 14).toISOString().slice(0, 10)}`, agent, reservedAt);
    }

    /* The price, its status and their history ------------------------------- */
    const status: UnitCommercialStatus = sold ? "SOLD" : reserved ? "RESERVED" : outcome === "ON_HOLD" ? "ON_HOLD" : "FOR_SALE";
    const holdReason = "Held for the developer's own use until the penthouse floor is priced.";
    const steps: Array<{ from: UnitCommercialStatus | null; to: UnitCommercialStatus; at: number; by: string; reason?: string }> = [{ from: "NOT_FOR_SALE", to: "FOR_SALE", at: launch, by: manager }];
    if (reserved || sold) steps.push({ from: "FOR_SALE", to: "RESERVED", at: reservedAt, by: agent });
    if (sold) steps.push({ from: "RESERVED", to: "SOLD", at: soldAt, by: agent });
    if (outcome === "ON_HOLD") steps.push({ from: "FOR_SALE", to: "ON_HOLD", at: -6, by: manager, reason: holdReason });
    const repriced = lake && !sold && unit.floor >= 5;
    const prices = repriced ? [{ price: round500(asking * 0.95), at: launch, reason: "Launch price list" }, { price: asking, at: -60, reason: "Upper floors repriced after the first phase sold" }] : [{ price: asking, at: launch, reason: "Launch price list" }];

    await prisma.unitCommercialProfile.create({
      data: {
        companyId: company,
        projectId: project,
        unitId: unit.id,
        status,
        askingPrice: dec(asking),
        currency: EUR,
        priceBasis: "SALEABLE_AREA",
        holdReason: outcome === "ON_HOLD" ? holdReason : null,
        holdUntil: outcome === "ON_HOLD" ? days(30) : null,
        heldByMemberId: outcome === "ON_HOLD" ? manager : null,
        statusChangedAt: days(steps[steps.length - 1]!.at),
        version: prices.length + steps.length,
        updatedByMemberId: steps[steps.length - 1]!.by,
        createdAt: days(launch),
      },
    });
    let previous: number | null = null;
    for (const price of prices) {
      await prisma.unitPriceHistory.create({ data: { companyId: company, projectId: project, unitId: unit.id, oldPrice: previous === null ? null : dec(previous), newPrice: dec(price.price), oldCurrency: previous === null ? null : EUR, currency: EUR, oldPriceBasis: previous === null ? null : "SALEABLE_AREA", priceBasis: "SALEABLE_AREA", reason: price.reason, changedByMemberId: manager, changedAt: days(price.at) } });
      previous = price.price;
    }
    for (const step of steps) {
      await prisma.unitCommercialStatusHistory.create({ data: { companyId: company, projectId: project, unitId: unit.id, fromStatus: step.from, toStatus: step.to, reason: step.reason ?? null, source: "USER", actorMemberId: step.by, reservationId: step.to === "RESERVED" || step.to === "SOLD" ? reservationId : null, opportunityId: step.to === "RESERVED" || step.to === "SOLD" ? opportunityId : null, changedAt: days(step.at) } });
    }
    if (outcome === "ON_HOLD") await trail(unit.id, project, "sales", "UNIT_COMMERCIAL_STATUS_CHANGED", `put ${unit.code} on hold`, manager, -6);

    /* Legal asked for a contract, not yet drafted ---------------------------- */
    if (outcome === "RESERVED_REQUESTED") {
      await prisma.unitContractRequest.create({ data: { id: `armaar_ucr_${slug}`, companyId: company, projectId: project, unitId: unit.id, reservationId: reservationId!, clientId: clientId!, opportunityId: opportunityId!, notes: "Buyer ready to sign; bank letter attached to the deal.", requestedByMemberId: agent, requestedAt: days(reservedAt + 1) } });
      await trail(unit.id, project, "contracts", "UNIT_CONTRACT_REQUESTED", `asked Legal for a contract for ${unit.code}`, agent, reservedAt + 1);
    }
    if (!sold) continue;

    /* The sale agreement ------------------------------------------------------ */
    contractSequence += 1;
    const contractId = `armaar_ctr_${slug}`;
    const signedAt = soldAt - 1;
    const year = days(signedAt).getUTCFullYear();
    const number = `BCI-SA-${year}-${String(contractSequence).padStart(3, "0")}`;
    const complete = outcome === "SOLD_PAID";
    await prisma.contract.create({
      data: {
        id: contractId,
        companyId: company,
        contractNumber: number,
        title: `Sale agreement — ${unit.code}`,
        contractType: "SALE_AGREEMENT",
        clientId: clientId!,
        projectId: project,
        opportunityId: opportunityId!,
        ownerMemberId: legal,
        status: complete ? "COMPLETED" : "ACTIVE",
        counterpartyName: clientName,
        currency: EUR,
        contractValue: dec(agreed),
        sentAt: days(signedAt - 3),
        signedDate: businessDay(signedAt),
        effectiveDate: businessDay(signedAt + 1),
        summary: `The sale of unit ${unit.code}.`,
        createdByMemberId: legal,
        createdAt: days(signedAt - 7),
      },
    });
    await prisma.contractUnit.create({ data: { companyId: company, projectId: project, contractId, unitId: unit.id, value: dec(agreed), currency: EUR, createdByMemberId: legal, createdAt: days(signedAt - 7) } });
    await prisma.unitContractRequest.create({ data: { id: `armaar_ucr_${slug}`, companyId: company, projectId: project, unitId: unit.id, reservationId: reservationId!, clientId: clientId!, opportunityId: opportunityId!, status: "FULFILLED", requestedByMemberId: agent, requestedAt: days(reservedAt + 1), contractId, closedByMemberId: legal, closedAt: days(signedAt - 7) } });
    await trail(unit.id, project, "contracts", "UNIT_CONTRACT_MARK_SIGNED", `recorded sale contract ${number} as signed`, legal, signedAt);
    await trail(unit.id, project, "sales", "UNIT_MARKED_SOLD", `marked ${unit.code} Sold`, agent, soldAt);

    /* Its schedule and what has been paid ------------------------------------ */
    const scheduleId = `armaar_sch_${slug}`;
    await prisma.paymentSchedule.create({ data: { id: scheduleId, companyId: company, contractId, versionNumber: 1, status: complete ? "COMPLETED" : "ACTIVE", currency: EUR, activatedAt: days(signedAt + 1), activatedByMemberId: finance, createdByMemberId: finance, createdAt: days(signedAt + 1) } });
    const deposit = round500(agreed * 0.1);
    const each = round500((agreed - deposit) / 3);
    const parts = [
      { label: "Deposit", type: "DEPOSIT" as const, amount: deposit, due: signedAt + 5 },
      { label: "Installment 1", type: "INSTALLMENT" as const, amount: each, due: signedAt + 120 },
      { label: "Installment 2", type: "INSTALLMENT" as const, amount: each, due: signedAt + 240 },
      { label: "Balance", type: "BALANCE" as const, amount: agreed - deposit - 2 * each, due: signedAt + 400 },
    ];
    // One buyer in five has missed the installment that fell due most recently.
    const lastDue = parts.filter((part) => part.due < 0).length - 1;
    const misses = !complete && contractSequence % 5 === 0 && lastDue >= 1;
    for (const [sequence, part] of parts.entries()) {
      const installmentId = `armaar_inst_${slug}_${sequence + 1}`;
      await prisma.paymentInstallment.create({ data: { id: installmentId, companyId: company, contractId, scheduleId, sequence: sequence + 1, label: part.label, type: part.type, amount: dec(part.amount), currency: EUR, dueDate: businessDay(part.due) } });
      const paid = complete || (part.due < 0 && !(misses && sequence === lastDue));
      if (!paid) continue;
      const paidAt = Math.min(part.due - (sequence % 2) * 3, -1);
      const paymentId = `armaar_pay_${slug}_${sequence + 1}`;
      await prisma.payment.create({ data: { id: paymentId, companyId: company, direction: "RECEIPT", clientId: clientId!, contractId, projectId: project, amount: dec(part.amount), currency: EUR, paymentDate: businessDay(paidAt), method: "BANK_TRANSFER", reference: `TR-${unit.code}-${sequence + 1}`, status: "RECORDED", createdByMemberId: finance, createdAt: days(paidAt) } });
      await prisma.paymentAllocation.create({ data: { id: `armaar_alloc_${slug}_${sequence + 1}`, companyId: company, paymentId, contractId, installmentId, amount: dec(part.amount), createdByMemberId: finance, createdAt: days(paidAt) } });
      await trail(unit.id, project, "finance", "PAYMENT_RECORDED", `recorded a payment of EUR ${part.amount.toLocaleString("en-US")}.00 against contract ${number}`, finance, paidAt);
    }
  }

  // Read back rather than counted, so a rerun that adds nothing still says what is there.
  const status = (value: UnitCommercialStatus) => prisma.unitCommercialProfile.count({ where: { companyId: company, status: value } });
  return {
    sold: await status("SOLD"),
    reserved: await status("RESERVED"),
    onHold: await status("ON_HOLD"),
    forSale: await status("FOR_SALE"),
    contracts: await prisma.contract.count({ where: { companyId: company, contractType: "SALE_AGREEMENT" } }),
  };
}
