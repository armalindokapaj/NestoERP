/**
 * ARMAAR's sales, lived in (D-04 enrichment, sales and units).
 *
 * sales.ts sells Tirana Lake and Square 21 the way D-01 fixed them. This stage
 * adds the traffic around them, through the same chain the product runs (a
 * client, a deal, a reservation, a sale agreement on the unit, its payment
 * schedule, payments allocated to installments), and never a new unit:
 *
 * - The units still on sale, and only those — never one sales.ts sold,
 *   reserved or held — take a share of the last six months' business: some
 *   sold (contract ACTIVE and paying, a few installments missed, one part-paid),
 *   some reserved now (a few with a contract asked of Legal), the rest still on
 *   sale after reservations that expired, were released or were cancelled.
 * - The autumn price list: the units still on sale and those reserved since
 *   are repriced, with the history the product keeps.
 * - A pipeline of enquiries that have not reached a reservation — Tirana Lake,
 *   Square 21's last shops and Gran Melia's branded residences — in every
 *   stage, lost ones with their reason.
 *
 * Contract numbers continue each company's own sale-agreement series after
 * the highest number already there. Buyers, prices and payments are
 * synthetic. Stable ids with the `armaar_d04_` prefix; a rerun adds nothing.
 */
import { Prisma, type LostReason, type OpportunityStage, type PrismaClient, type UnitCommercialStatus, type UnitReservationStatus } from "@prisma/client";

import { normalizeName } from "../../../lib/modules/clients/client.duplicate";
import { memberId } from "./access";
import { companyId } from "./organization";
import { userId } from "./people";
import type { CompanyCode } from "./public-facts";
import { ARMAAR_GROUP_ID } from "./records";

const P = "armaar_d04";
const EUR = "EUR";
const DAY = 86_400_000;
const days = (offset: number) => new Date(Date.now() + offset * DAY);
const businessDay = (offset: number) => {
  const date = days(offset);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
};
const dec = (value: number) => new Prisma.Decimal(value.toFixed(2));
const round500 = (value: number) => Math.round(value / 500) * 500;
const pad = (value: number, width: number) => String(value).padStart(width, "0");
type Db = Prisma.TransactionClient | PrismaClient;
const pick = <T>(list: readonly T[], index: number): T => list[((index % list.length) + list.length) % list.length]!;

/** Who sells in each company, as sales.ts has them, and the agents who take the enquiries. */
const SELLERS: Partial<Record<CompanyCode, { prefix: string; manager: string; agents: string[]; legal: string; finance: string; pad: number }>> = {
  BUILDING_CONSTRUCTION_INVEST: { prefix: "BCI", manager: "bci.sales", agents: ["bci.sales-agent", "bci.sales-agent2"], legal: "bci.legal", finance: "bci.finance-specialist", pad: 3 },
  ARLIS_NDERTIM: { prefix: "ALN", manager: "armaar.sales", agents: ["bci.sales-agent2"], legal: "arlis.legal", finance: "arlis.accountant", pad: 4 },
  SARANDA_MARINA_INVEST: { prefix: "SMI", manager: "smi.sales", agents: ["smi.sales-agent", "smi.sales"], legal: "armaar.legal", finance: "smi.finance", pad: 4 },
};
const PROJECT_COMPANY: Record<string, CompanyCode> = { armaar_prj_tirana_lake: "BUILDING_CONSTRUCTION_INVEST", armaar_prj_square_21: "ARLIS_NDERTIM" };
/** sales.ts holds these for the developer's own use: never offered here. */
const HELD = new Set(["armaar_unit_tl_a1001", "armaar_unit_tl_a1004"]);

const FIRST = ["Alketa", "Arben", "Brikena", "Dritan", "Eriona", "Fatjon", "Gentiana", "Ilir", "Klea", "Lorenc", "Mirela", "Noel", "Olsa", "Petrit", "Rudina", "Saimir", "Teuta", "Vilma", "Xhuljo", "Arlinda", "Besmir", "Erisa", "Gledis", "Julian", "Manjola", "Nikolin", "Romina", "Sokol", "Etleva", "Florjan", "Aida", "Kristian", "Lediana", "Marjus", "Anisa"];
const LAST = ["Aliaj", "Berisha", "Cani", "Dibra", "Fejzo", "Gjika", "Hasa", "Isufi", "Kapllani", "Lamaj", "Malaj", "Ndoja", "Osmani", "Paja", "Rama", "Selimi", "Tafa", "Ujka", "Vasili", "Xhelili", "Zogaj", "Bregu", "Dosti", "Kondi", "Myftiu", "Qirjako", "Rexha", "Shkurti"];
const CITIES: Array<[city: string, country: string, phone: string]> = [
  ["Tirana", "Albania", "+355 69"],
  ["Durrës", "Albania", "+355 68"],
  ["Tirana", "Albania", "+355 67"],
  ["Vlorë", "Albania", "+355 69"],
  ["Milan", "Italy", "+39 347"],
  ["Elbasan", "Albania", "+355 68"],
  ["Athens", "Greece", "+30 694"],
  ["Tirana", "Albania", "+355 69"],
  ["Korçë", "Albania", "+355 67"],
  ["London", "United Kingdom", "+44 7700"],
  ["Shkodër", "Albania", "+355 68"],
  ["Pogradec", "Albania", "+355 69"],
];
const COMPANY_BUYERS = ["Drini Logistics sh.p.k.", "Alpeta Clinics sh.p.k.", "Kodra Legal Partners sh.p.k.", "Nova Optics sh.p.k.", "Butrint Travel sh.p.k.", "Lumi Bakery Chain sh.p.k.", "Tomorr Insurance Brokers sh.p.k.", "Iliria Tech Hub sh.p.k."];

type Outcome = "SOLD" | "RESERVED" | "RESERVED_REQUESTED" | "FOR_SALE";
const OUTCOMES: Outcome[] = ["SOLD", "RESERVED", "FOR_SALE", "SOLD", "RESERVED_REQUESTED", "FOR_SALE", "SOLD", "FOR_SALE"];
const LAPSES: Array<{ status: Extract<UnitReservationStatus, "EXPIRED" | "RELEASED" | "CANCELLED">; reason: string; lost: LostReason }> = [
  { status: "EXPIRED", reason: "Expired without a signed agreement.", lost: "TIMING" },
  { status: "RELEASED", reason: "The buyer chose a lower floor in the same tower.", lost: "PRICE" },
  { status: "CANCELLED", reason: "The buyer's mortgage was refused.", lost: "NO_BUDGET" },
  { status: "RELEASED", reason: "The buyer bought elsewhere.", lost: "COMPETITOR" },
  { status: "EXPIRED", reason: "No reply after the reservation period.", lost: "NO_RESPONSE" },
];

export async function seedArmaarEnrichSales(prisma: PrismaClient) {
  let clientNumber = 0;
  /** A new client of a company; the number is stable because the order of the plan is. */
  const client = async (db: Db, code: CompanyCode, agent: string, corporate: boolean, createdAt: number) => {
    const seller = SELLERS[code]!;
    clientNumber += 1;
    const n = clientNumber;
    const id = `${P}_client_${seller.prefix.toLowerCase()}_${pad(n, 3)}`;
    const name = corporate ? pick(COMPANY_BUYERS, n) : `${pick(FIRST, n * 7)} ${pick(LAST, n * 5 + 3)}`;
    const [city, country, phone] = pick(CITIES, n);
    const existing = await db.client.findUnique({ where: { id }, select: { name: true } });
    if (!existing) {
      await db.client.create({
        data: {
          id,
          companyId: companyId(code),
          code: `${seller.prefix}-C-D04-${pad(n, 3)}`,
          name,
          legalName: corporate ? name : null,
          type: corporate ? "COMPANY" : "INDIVIDUAL",
          status: "ACTIVE",
          email: `${id.slice(P.length + 1)}@buyer.armaar-demo.test`,
          phone: `${phone} ${pad(200 + n, 3)} ${pad((n * 37) % 10000, 4)}`,
          city,
          country,
          normalizedName: normalizeName(name),
          createdBy: userId(agent),
          createdAt: days(createdAt),
        },
      });
    }
    return { id, name: existing?.name ?? name };
  };

  /* The contract series: continue after the highest number in each company ------ */
  const nextNumber = new Map<CompanyCode, number>();
  const numberFor = async (code: CompanyCode, year: number) => {
    const seller = SELLERS[code]!;
    if (!nextNumber.has(code)) {
      const numbers = await prisma.contract.findMany({ where: { companyId: companyId(code), contractNumber: { startsWith: `${seller.prefix}-SA-` } }, select: { contractNumber: true } });
      nextNumber.set(code, Math.max(0, ...numbers.map((row) => Number(row.contractNumber.split("-").at(-1)) || 0)));
    }
    const next = nextNumber.get(code)! + 1;
    nextNumber.set(code, next);
    return `${seller.prefix}-SA-${year}-${pad(next, seller.pad)}`;
  };

  /* The units still on sale ------------------------------------------------------ */
  // Only those sales.ts left on sale: published, sellable, never reserved or contracted by anyone but this file.
  const candidates = await prisma.projectUnit.findMany({
    where: {
      projectId: { in: Object.keys(PROJECT_COMPANY) },
      publicationStatus: "PUBLISHED",
      id: { notIn: [...HELD] },
      unitType: { code: { not: "PARKING" } },
      NOT: [{ id: { in: (await prisma.unitReservation.findMany({ where: { id: { not: { startsWith: `${P}_` } } }, select: { unitId: true } })).map((row) => row.unitId) } }, { id: { in: (await prisma.contractUnit.findMany({ where: { contractId: { not: { startsWith: `${P}_` } } }, select: { unitId: true } })).map((row) => row.unitId) } }],
    },
    orderBy: { id: "asc" },
    select: { id: true, unitCode: true, projectId: true, companyId: true, saleableArea: true, unitType: { select: { code: true } } },
  });

  let activity = 0;
  const trail = async (db: Db, company: string, unitId: string, project: string, module: string, action: string, message: string, by: { member: string; user: string }, at: number) => {
    if (at < -45) return;
    activity += 1;
    await db.activity.createMany({ skipDuplicates: true, data: [{ id: `${P}_act_${unitId.replace(/^armaar_unit_/, "")}_${action.toLowerCase()}_${Math.round(-at)}`, companyId: company, module, entityType: "ProjectUnit", entityId: unitId, action, message, actorMemberId: by.member, actorUserId: by.user, metadata: { projectId: project }, createdAt: days(at) }] });
  };

  let contractSequence = 0;
  for (const [index, unit] of candidates.entries()) {
    const code = PROJECT_COMPANY[unit.projectId]!;
    const seller = SELLERS[code]!;
    const company = unit.companyId;
    const project = unit.projectId;
    const slug = unit.id.replace(/^armaar_unit_/, "");
    const lake = project === "armaar_prj_tirana_lake";
    const corporate = unit.unitType.code === "OFFICE" || unit.unitType.code === "SHOP";
    const agentName = pick(seller.agents, index);
    const agent = memberId(agentName, code);
    const manager = memberId(seller.manager, code);
    const legal = memberId(seller.legal, code);
    const finance = memberId(seller.finance, code);
    const as = (member: string, username: string) => ({ member, user: userId(username) });
    const outcome = pick(OUTCOMES, index);
    const sold = outcome === "SOLD";
    const reserved = outcome === "RESERVED" || outcome === "RESERVED_REQUESTED";

    // Reservations that came to nothing: before a sale, well before; otherwise over the half-year.
    const lapses = (index % 3) + (outcome === "FOR_SALE" ? 1 : 0);
    const soldAt = -20 - ((index * 29) % 150);
    const reservedAt = sold ? soldAt - 10 : -2 - (index % 11);
    const lapseAt = (n: number) => (sold ? Math.min(soldAt - 40, -60) : -30) - 45 * n - (index % 9);

    const marker = `${P}_ucsh_${slug}_01`;
    if (await prisma.unitCommercialStatusHistory.findUnique({ where: { id: marker }, select: { id: true } })) {
      // Written before: count its contract so the series stays where it is.
      if (sold) contractSequence += 1;
      clientNumber += lapses + (sold || reserved ? 1 : 0);
      continue;
    }

    await prisma.$transaction(async (db) => {
      /* Its price now, and the autumn list for what is still on offer ------------------ */
      const latest = await db.unitPriceHistory.findFirst({ where: { unitId: unit.id }, orderBy: { changedAt: "desc" }, select: { newPrice: true } });
      const base = latest ? Number(latest.newPrice) : round500(Number(unit.saleableArea) * (corporate ? 2800 : lake ? 2500 : 1700));
      const repriced = !sold && lake;
      const price = repriced ? round500(base * 1.03) : base;

      const history: Array<{ from: UnitCommercialStatus; to: UnitCommercialStatus; at: number; by: string; reason?: string; source?: "USER" | "SYSTEM_EXPIRY"; reservationId?: string; opportunityId?: string }> = [];

        /* Lapsed reservations ------------------------------------------------------------ */
        for (let n = lapses; n >= 1; n -= 1) {
          const lapse = pick(LAPSES, index + n);
          const at = lapseAt(n);
          const buyer = await client(db, code, agentName, corporate && n % 2 === 1, at - 12);
          const opportunityId = `${P}_opp_${slug}_l${n}`;
          const reservationId = `${P}_res_${slug}_l${n}`;
          const offered = round500(base * (0.96 + (n % 3) * 0.01));
          const closedAt = lapse.status === "EXPIRED" ? at + 14 : at + 3 + (index % 7);
          await db.opportunity.create({ data: { id: opportunityId, companyId: company, name: `${buyer.name} — ${unit.unitCode}`, clientId: buyer.id, ownerMemberId: agent, stage: "LOST", stageChangedAt: days(closedAt), estimatedValue: dec(offered), currency: EUR, actualCloseDate: businessDay(closedAt), lostReason: lapse.lost, lostNote: lapse.reason, createdByMemberId: agent, createdAt: days(at - 12) } });
          await db.unitReservation.create({ data: { id: reservationId, companyId: company, projectId: project, unitId: unit.id, clientId: buyer.id, opportunityId, status: lapse.status, reservedAt: days(at), expiresAt: days(at + 14), closedAt: days(closedAt), closedByMemberId: lapse.status === "EXPIRED" ? null : agent, closeReason: lapse.reason, agreedPrice: dec(offered), currency: EUR, createdByMemberId: agent, createdAt: days(at) } });
          await db.opportunityUnit.create({ data: { companyId: company, projectId: project, opportunityId, unitId: unit.id, agreedPrice: dec(offered), currency: EUR, createdByMemberId: agent, createdAt: days(at) } });
          history.push({ from: "FOR_SALE", to: "RESERVED", at, by: agent, reservationId, opportunityId });
          history.push({ from: "RESERVED", to: "FOR_SALE", at: closedAt, by: lapse.status === "EXPIRED" ? manager : agent, reason: lapse.reason, source: lapse.status === "EXPIRED" ? "SYSTEM_EXPIRY" : "USER", reservationId });
        }


      /* The current buyer ---------------------------------------------------------------- */
      let reservationId: string | null = null;
      let opportunityId: string | null = null;
      let buyer: { id: string; name: string } | null = null;
      const agreed = round500(price * (0.97 + (index % 3) * 0.01));
      if (sold || reserved) {
        buyer = await client(db, code, agentName, corporate, reservedAt - 14);
        opportunityId = `${P}_opp_${slug}`;
        reservationId = `${P}_res_${slug}`;
        await db.opportunity.create({ data: { id: opportunityId, companyId: company, name: `${buyer.name} — ${unit.unitCode}`, clientId: buyer.id, ownerMemberId: agent, stage: sold ? "WON" : "NEGOTIATION", stageChangedAt: days(sold ? soldAt : reservedAt), estimatedValue: dec(agreed), currency: EUR, expectedCloseDate: sold ? null : businessDay(reservedAt + 20), actualCloseDate: sold ? businessDay(soldAt) : null, wonReason: sold ? "Signed the sale agreement." : null, nextStep: sold ? null : outcome === "RESERVED_REQUESTED" ? "Legal drafting the sale agreement." : "Bank letter expected this week.", createdByMemberId: agent, createdAt: days(reservedAt - 14) } });
        await db.unitReservation.create({ data: { id: reservationId, companyId: company, projectId: project, unitId: unit.id, clientId: buyer.id, opportunityId, status: sold ? "CONVERTED_TO_SALE" : "ACTIVE", reservedAt: days(reservedAt), expiresAt: days(reservedAt + 14), closedAt: sold ? days(soldAt) : null, closedByMemberId: sold ? agent : null, agreedPrice: dec(agreed), currency: EUR, createdByMemberId: agent, createdAt: days(reservedAt) } });
        await db.opportunityUnit.create({ data: { companyId: company, projectId: project, opportunityId, unitId: unit.id, agreedPrice: dec(agreed), currency: EUR, createdByMemberId: agent, createdAt: days(reservedAt) } });
        history.push({ from: "FOR_SALE", to: "RESERVED", at: reservedAt, by: agent, reservationId, opportunityId });
        await trail(db, company, unit.id, project, "sales", "UNIT_RESERVED", `reserved ${unit.unitCode} until ${days(reservedAt + 14).toISOString().slice(0, 10)}`, as(agent, agentName), reservedAt);
      }
      if (outcome === "RESERVED_REQUESTED") {
        await db.unitContractRequest.create({ data: { id: `${P}_ucr_${slug}`, companyId: company, projectId: project, unitId: unit.id, reservationId: reservationId!, clientId: buyer!.id, opportunityId: opportunityId!, notes: "Buyer ready to sign; proof of funds attached to the deal.", requestedByMemberId: agent, requestedAt: days(reservedAt + 1) } });
        await trail(db, company, unit.id, project, "contracts", "UNIT_CONTRACT_REQUESTED", `asked Legal for a contract for ${unit.unitCode}`, as(agent, agentName), reservedAt + 1);
      }

      /* The sale: agreement, schedule, payments ------------------------------------------ */
      if (sold) {
        contractSequence += 1;
        const signedAt = soldAt - 1;
        const contractId = `${P}_ctr_${slug}`;
        const number = await numberFor(code, days(signedAt).getUTCFullYear());
        await db.contract.create({ data: { id: contractId, companyId: company, contractNumber: number, title: `Sale agreement — ${unit.unitCode}`, contractType: "SALE_AGREEMENT", clientId: buyer!.id, projectId: project, opportunityId: opportunityId!, ownerMemberId: legal, status: "ACTIVE", counterpartyName: buyer!.name, currency: EUR, contractValue: dec(agreed), sentAt: days(signedAt - 3), signedDate: businessDay(signedAt), effectiveDate: businessDay(signedAt + 1), summary: `The sale of unit ${unit.unitCode}.`, createdByMemberId: legal, createdAt: days(signedAt - 7) } });
        await db.contractUnit.create({ data: { companyId: company, projectId: project, contractId, unitId: unit.id, value: dec(agreed), currency: EUR, createdByMemberId: legal, createdAt: days(signedAt - 7) } });
        await db.unitContractRequest.create({ data: { id: `${P}_ucr_${slug}`, companyId: company, projectId: project, unitId: unit.id, reservationId: reservationId!, clientId: buyer!.id, opportunityId: opportunityId!, status: "FULFILLED", requestedByMemberId: agent, requestedAt: days(reservedAt + 1), contractId, closedByMemberId: legal, closedAt: days(signedAt - 7) } });
        history.push({ from: "RESERVED", to: "SOLD", at: soldAt, by: agent, reservationId: reservationId!, opportunityId: opportunityId! });
        await trail(db, company, unit.id, project, "contracts", "UNIT_CONTRACT_MARK_SIGNED", `recorded sale contract ${number} as signed`, as(legal, seller.legal), signedAt);
        await trail(db, company, unit.id, project, "sales", "UNIT_MARKED_SOLD", `marked ${unit.unitCode} Sold`, as(agent, agentName), soldAt);

        const scheduleId = `${P}_sch_${slug}`;
        await db.paymentSchedule.create({ data: { id: scheduleId, companyId: company, contractId, versionNumber: 1, status: "ACTIVE", currency: EUR, activatedAt: days(signedAt + 1), activatedByMemberId: finance, createdByMemberId: finance, createdAt: days(signedAt + 1) } });
        // Tirana Lake: deposit, three stage payments, the balance at handover. Square 21's shops are finished: shorter.
        const deposit = round500(agreed * (lake ? 0.15 : 0.3));
        const stages = lake ? 3 : 2;
        const each = round500((agreed - deposit) * (lake ? 0.2 : 0.3));
        const parts = [
          { label: "Deposit", type: "DEPOSIT" as const, amount: deposit, due: signedAt + 5 },
          ...Array.from({ length: stages }, (_, n) => ({ label: `Installment ${n + 1}`, type: "INSTALLMENT" as const, amount: each, due: signedAt + (lake ? 60 : 45) * (n + 1) })),
          { label: "Balance", type: "BALANCE" as const, amount: agreed - deposit - stages * each, due: lake ? signedAt + 420 : signedAt + 150 },
        ];
        // One sale in four has missed the installment most recently due; another has paid half of it.
        const lastDue = parts.filter((part) => part.due < 0).length - 1;
        const misses = contractSequence % 4 === 2 && lastDue >= 1;
        const partial = contractSequence % 4 === 3 && lastDue >= 1;
        for (const [sequence, part] of parts.entries()) {
          const installmentId = `${P}_inst_${slug}_${sequence + 1}`;
          await db.paymentInstallment.create({ data: { id: installmentId, companyId: company, contractId, scheduleId, sequence: sequence + 1, label: part.label, type: part.type, amount: dec(part.amount), currency: EUR, dueDate: businessDay(part.due) } });
          if (part.due >= 0 || (misses && sequence === lastDue)) continue;
          const amount = partial && sequence === lastDue ? round500(part.amount / 2) : part.amount;
          const paidAt = Math.min(part.due - (sequence % 2) * 2, -1);
          const paymentId = `${P}_pay_${slug}_${sequence + 1}`;
          await db.payment.create({ data: { id: paymentId, companyId: company, direction: "RECEIPT", clientId: buyer!.id, contractId, projectId: project, amount: dec(amount), currency: EUR, paymentDate: businessDay(paidAt), method: sequence === 0 && index % 5 === 0 ? "CHECK" : "BANK_TRANSFER", reference: `TR-${unit.unitCode}-D${sequence + 1}`, status: "RECORDED", createdByMemberId: finance, createdAt: days(paidAt) } });
          await db.paymentAllocation.create({ data: { id: `${P}_alloc_${slug}_${sequence + 1}`, companyId: company, paymentId, contractId, installmentId, amount: dec(amount), createdByMemberId: finance, createdAt: days(paidAt) } });
          await trail(db, company, unit.id, project, "finance", "PAYMENT_RECORDED", `recorded a payment of EUR ${amount.toLocaleString("en-US")}.00 against contract ${number}`, as(finance, seller.finance), paidAt);
        }
      }

      /* Status and price history, and the profile they end in ----------------------------- */
      history.sort((a, b) => a.at - b.at);
      const status: UnitCommercialStatus = sold ? "SOLD" : reserved ? "RESERVED" : "FOR_SALE";
      const changes = history.filter((step) => step.from !== step.to);
      for (const [n, step] of changes.entries()) {
        await db.unitCommercialStatusHistory.create({ data: { id: n === 0 ? marker : `${P}_ucsh_${slug}_${pad(n + 1, 2)}`, companyId: company, projectId: project, unitId: unit.id, fromStatus: step.from, toStatus: step.to, reason: step.reason ?? null, source: step.source ?? "USER", actorMemberId: step.by, reservationId: step.reservationId ?? null, opportunityId: step.opportunityId ?? null, changedAt: days(step.at) } });
      }
      if (repriced) await db.unitPriceHistory.create({ data: { id: `${P}_uph_${slug}`, companyId: company, projectId: project, unitId: unit.id, oldPrice: dec(base), newPrice: dec(price), oldCurrency: EUR, currency: EUR, oldPriceBasis: "SALEABLE_AREA", priceBasis: "SALEABLE_AREA", reason: "Autumn price list", changedByMemberId: manager, changedAt: days(-21) } });
      const last = changes.at(-1);
      const profile = await db.unitCommercialProfile.findUnique({ where: { unitId: unit.id }, select: { version: true } });
      const state = { status, askingPrice: dec(price), statusChangedAt: last ? days(last.at) : days(-21), updatedByMemberId: last?.by ?? manager };
      if (profile) await db.unitCommercialProfile.update({ where: { unitId: unit.id }, data: { ...state, version: profile.version + changes.length + (repriced ? 1 : 0) } });
      // A database whose profiles were cleared gets this unit's back, as the product keeps it.
      else await db.unitCommercialProfile.create({ data: { companyId: company, projectId: project, unitId: unit.id, currency: EUR, priceBasis: "SALEABLE_AREA", version: 1 + changes.length + (repriced ? 1 : 0), createdAt: days(lake ? -540 : -1560), ...state } });
    }, { timeout: 120_000 });
  }

  /* The pipeline that has not reached a reservation --------------------------------- */
  const PIPELINE: Array<{ code: CompanyCode; project: string | null; label: string; value: number; count: number }> = [
    { code: "BUILDING_CONSTRUCTION_INVEST", project: "armaar_prj_tirana_lake", label: "Tirana Lake", value: 230000, count: 22 },
    { code: "ARLIS_NDERTIM", project: "armaar_prj_square_21", label: "Square 21 shop", value: 190000, count: 6 },
    { code: "SARANDA_MARINA_INVEST", project: null, label: "Gran Melia branded residence", value: 420000, count: 14 },
  ];
  const STAGES: OpportunityStage[] = ["PROSPECTING", "QUALIFIED", "DISCOVERY", "PROPOSAL", "NEGOTIATION", "LOST", "PROSPECTING", "QUALIFIED", "LOST", "DISCOVERY"];
  const onOffer = await prisma.projectUnit.findMany({ where: { id: { in: candidates.filter((_, index) => pick(OUTCOMES, index) === "FOR_SALE").map((unit) => unit.id) } }, orderBy: { id: "asc" }, select: { id: true, unitCode: true, projectId: true } });
  let enquiry = 0;
  for (const line of PIPELINE) {
    const seller = SELLERS[line.code]!;
    const company = companyId(line.code);
    const units = onOffer.filter((unit) => unit.projectId === line.project);
    for (let n = 0; n < line.count; n += 1) {
      enquiry += 1;
      const stage = pick(STAGES, n + enquiry);
      const agentName = pick(seller.agents, n);
      const agent = memberId(agentName, line.code);
      const created = -170 + Math.round(((n + 0.5) * 165) / line.count);
      const buyer = await client(prisma, line.code, agentName, line.label.includes("shop") && n % 2 === 0, created);
      const id = `${P}_opp_${seller.prefix.toLowerCase()}_enq_${pad(n + 1, 3)}`;
      if (await prisma.opportunity.findUnique({ where: { id }, select: { id: true } })) continue;
      const unit = units.length ? pick(units, n) : null;
      const value = round500(line.value * (0.8 + ((n * 7) % 5) * 0.1));
      const lost = stage === "LOST";
      await prisma.opportunity.create({
        data: {
          id,
          companyId: company,
          name: `${buyer.name} — ${unit ? unit.unitCode : line.label}`,
          clientId: buyer.id,
          ownerMemberId: agent,
          stage,
          stageChangedAt: days(Math.min(created + 10, -1)),
          estimatedValue: dec(value),
          currency: EUR,
          expectedCloseDate: lost ? null : businessDay(15 + ((n * 11) % 75)),
          actualCloseDate: lost ? businessDay(Math.min(created + 25, -1)) : null,
          description: unit ? `Interested in ${unit.unitCode}; asked for the floor plan and the payment plan.` : `Enquiry for a ${line.label.toLowerCase()} off-plan.`,
          nextStep: lost ? null : pick(["Send the price list and payment plan.", "Book a visit to the show apartment.", "Call back after the bank's pre-approval.", "Prepare a written offer."], n),
          lostReason: lost ? pick<LostReason>(["PRICE", "TIMING", "COMPETITOR", "NO_RESPONSE"], n) : null,
          lostNote: lost ? "Closed after two follow-ups." : null,
          createdByMemberId: agent,
          createdAt: days(created),
        },
      });
      if (unit && stage !== "PROSPECTING") {
        await prisma.opportunityUnit.createMany({ skipDuplicates: true, data: [{ companyId: company, projectId: unit.projectId, opportunityId: id, unitId: unit.id, agreedPrice: null, currency: EUR, createdByMemberId: agent, createdAt: days(created) }] });
      }
    }
  }

  const inGroup = { company: { parentGroupId: ARMAAR_GROUP_ID } };
  const reservations = await prisma.unitReservation.groupBy({ by: ["status"], where: { companyId: { startsWith: "armaar_" } }, _count: { _all: true } });
  return {
    clients: await prisma.client.count({ where: inGroup }),
    opportunities: await prisma.opportunity.count({ where: inGroup }),
    reservations: Object.fromEntries(reservations.map((row) => [row.status, row._count._all])),
    saleContracts: await prisma.contract.count({ where: { ...inGroup, contractType: "SALE_AGREEMENT" } }),
    installments: await prisma.paymentInstallment.count({ where: { companyId: { startsWith: "armaar_" } } }),
    payments: await prisma.payment.count({ where: inGroup }),
    priceChanges: await prisma.unitPriceHistory.count({ where: { companyId: { startsWith: "armaar_" } } }),
    activity,
  };
}
