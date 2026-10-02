/**
 * ARMAAR's contracts, deepened (D-02 §21, §76).
 *
 * D-01 wrote Tirana Lake's construction contract, the steel framework, the
 * subcontracts, two employment contracts and a façade amendment waiting for
 * approval; D-02's engineering adds the new subcontracts. This file adds what
 * Legal keeps on them — who the parties are and what each side still owes —
 * and the contracts of the other working companies: a supply agreement, a lift
 * maintenance contract, an NDA, a hotel operator's services agreement waiting
 * for approval, ARSOL's power purchase agreement and module framework, a plant
 * hire framework, and the engineers UNICO engaged for its United Towers.
 *
 * Amendments move through the product's own states: one active (Tower B's two
 * extra floors, already in the construction contract's value), one approved
 * and not yet signed, one still a draft. No new Legal state machine (§21).
 * Counterparties are names on the contract, not the future external-company
 * register (§4). Every value is synthetic. Stable ids; a rerun adds nothing.
 */
import { Prisma, type ContractObligationType, type ContractRenewalType, type ContractStatus, type ContractType, type PrismaClient } from "@prisma/client";

import { addLocalDays, localDate } from "../../../lib/modules/calendar/calendar.time";
import { memberId } from "./access";
import { companyId } from "./organization";
import { projectId } from "./projects";
import type { CompanyCode, ProjectCode } from "./public-facts";
import { ARMAAR_GROUP_ID } from "./records";

const ZONE = "Europe/Tirane";
const EUR = "EUR";
const BCI = "BUILDING_CONSTRUCTION_INVEST" as const;
const money = (value: number) => new Prisma.Decimal(value.toFixed(2));

const COMPANY_NAME: Partial<Record<CompanyCode, string>> = { [BCI]: "BUILDING CONSTRUCTION INVEST", ARLIS_NDERTIM: "ARLIS - NDERTIM", IDEAL_CONSTRUCTION: "IDEAL Construction", SARANDA_MARINA_INVEST: "Saranda Marina Invest", ARSOL_ENERGY: "ARSOL ENERGY", UNICO_CONSTRUCTION: "UNICO CONSTRUCTION" };
/** Who owns contracts in each company: its counsel, or the group's. */
const LEGAL: Partial<Record<CompanyCode, string>> = { [BCI]: "bci.legal", ARLIS_NDERTIM: "arlis.legal", ARSOL_ENERGY: "arsol.legal", IDEAL_CONSTRUCTION: "armaar.legal", SARANDA_MARINA_INVEST: "armaar.legal", UNICO_CONSTRUCTION: "armaar.legal" };
const APPROVER: Partial<Record<CompanyCode, string>> = { [BCI]: "bci.director", SARANDA_MARINA_INVEST: "smi.director" };

const CONTRACTS: Array<{ key: string; company: CompanyCode; project: ProjectCode | null; number: string; title: string; type: ContractType; counterparty: string; value: number | null; status: ContractStatus; signed: number | null; term?: number; renewal?: ContractRenewalType; summary: string; pending?: true }> = [
  { key: "supply_tiles", company: BCI, project: "TIRANA_LAKE", number: "BCI-PA-2026-004", title: "Supply agreement — porcelain tiles, Tower A", type: "PURCHASE_AGREEMENT", counterparty: "Adria Tiles & Stone sh.p.k.", value: 113_400, status: "ACTIVE", signed: -27, term: 240, summary: "Supply of 4,200 m² of rectified porcelain tiles, called off by floor." },
  // Square 21 is ARLIS - NDERTIM's, and so is its lift contract: the first in ARLIS's service series.
  { key: "service_lifts_s21", company: "ARLIS_NDERTIM", project: "SQUARE_21", number: "ALN-SV-2025-0001", title: "Lift maintenance agreement — Square 21", type: "SERVICE_AGREEMENT", counterparty: "Liftech Balkans sh.p.k.", value: 24_000, status: "ACTIVE", signed: -300, term: 365, renewal: "AUTO_RENEW", summary: "Monthly maintenance and 24-hour call-out for the six lifts of Square 21." },
  { key: "nda_ut_operator", company: "UNICO_CONSTRUCTION", project: "UNITED_TOWERS", number: "UNICO-NDA-2026-0001", title: "Non-disclosure agreement — United Towers hotel operator", type: "NDA", counterparty: "Demo Hospitality Group", value: null, status: "SIGNED", signed: -35, term: 730, summary: "Mutual confidentiality for the hotel operator discussions on the upper floors." },
  { key: "ppa_rooftop_1", company: "ARSOL_ENERGY", project: null, number: "ARSOL-PPA-2025-001", title: "Power purchase agreement — rooftop programme, batch 1", type: "CLIENT_AGREEMENT", counterparty: "Demo Retail Park sh.p.k.", value: 1_260_000, status: "ACTIVE", signed: -410, term: 5_475, summary: "Fifteen years of power from 1.2 MWp on the retail park's roofs, at an indexed tariff." },
  { key: "framework_pv", company: "ARSOL_ENERGY", project: null, number: "ARSOL-FW-2026-002", title: "Supply framework — PV modules", type: "FRAMEWORK", counterparty: "SolarTech Balkans sh.p.k.", value: 900_000, status: "ACTIVE", signed: -60, term: 365, summary: "Call-off prices for PV modules and inverters for the rooftop programme." },
  { key: "framework_plant", company: "ARLIS_NDERTIM", project: null, number: "ALN-FW-2025-007", title: "Plant hire framework — cranes and hoists", type: "FRAMEWORK", counterparty: "Demo Plant Hire sh.p.k.", value: 650_000, status: "ACTIVE", signed: -190, term: 540, summary: "Rates for tower cranes, mobile cranes and hoists across ARLIS - NDERTIM's sites." },
  // United Towers is UNICO's own project: UNICO designs it and engages the structural and MEP engineers.
  { key: "design_ut", company: "UNICO_CONSTRUCTION", project: "UNITED_TOWERS", number: "UNICO-SV-2026-0001", title: "Engineering design agreement — United Towers", type: "SERVICE_AGREEMENT", counterparty: "Demo Engineering Consultants sh.p.k.", value: 420_000, status: "ACTIVE", signed: -42, term: 420, summary: "Structural and MEP design of United Towers, to UNICO CONSTRUCTION's architecture." },
];

/** Parties on D-01's contracts and D-02's subcontracts: our company, and the other side. */
const SUBCONTRACTORS: Array<[string, string]> = [
  ["armaar_contract_sub_albabuild", "AlbaBuild sh.p.k."],
  ["armaar_contract_sub_vlora_glass", "Vlora Glass Systems sh.p.k."],
  ["armaar_contract_sub_elektronord", "ElektroNord sh.p.k."],
  ["armaar_contract_sub_klimatek", "KlimaTek sh.p.k."],
  ["armaar_contract_sub_durres_finishing", "Durrës Finishing Works sh.p.k."],
  ["armaar_contract_sub_hidroizol", "HidroIzol Albania sh.p.k."],
  ["armaar_contract_sub_aquatek", "AquaTek Instalime sh.p.k."],
  ["armaar_contract_sub_liftech", "Liftech Balkans sh.p.k."],
  ["armaar_contract_sub_gjelber", "Gjelbër Landscape sh.p.k."],
  ["armaar_contract_construction_tl", "ARLIS - NDERTIM"],
];

const OBLIGATIONS: Array<{ contract: string; company?: CompanyCode; title: string; type: ContractObligationType; responsible: string; due: number; done?: number }> = [
  { contract: "armaar_contract_construction_tl", title: "Interim payment certificate no. 18", type: "PAYMENT", responsible: "bci.finance", due: -3 },
  { contract: "armaar_contract_construction_tl", title: "Monthly progress report — September", type: "DELIVERABLE", responsible: "bci.pm", due: 5 },
  { contract: "armaar_contract_construction_tl", title: "Performance bond renewal", type: "COMPLIANCE", responsible: "bci.legal", due: -30, done: -32 },
  { contract: "armaar_contract_sub_vlora_glass", title: "Façade mock-up water test report", type: "DOCUMENT", responsible: "bci.architect", due: -60, done: -58 },
  { contract: "armaar_contract_sub_vlora_glass", title: "Performance bond — 10% of the contract value", type: "COMPLIANCE", responsible: "bci.legal", due: -8 },
  { contract: "armaar_contract_sub_aquatek", title: "Renewed all-risk insurance certificate", type: "COMPLIANCE", responsible: "bci.legal", due: 18 },
  { contract: "armaar_contract_sub_liftech", title: "Mobilisation notice, 30 days before start", type: "NOTICE", responsible: "bci.pm", due: 30 },
  { contract: "armaar_contract_sub_hidroizol", title: "Fifteen-year system warranty", type: "DOCUMENT", responsible: "bci.engineering", due: 200 },
  { contract: "armaar_contract_sub_albabuild", title: "As-built drawings — Tower A frame", type: "DELIVERABLE", responsible: "bci.engineering", due: 60 },
  { contract: "armaar_contract_framework_steel", title: "Quarterly price review", type: "NOTICE", responsible: "bci.procurement", due: 12 },
  { contract: "armaar_legal_ppa_rooftop_1", company: "ARSOL_ENERGY", title: "Annual generation report", type: "DELIVERABLE", responsible: "arsol.pm", due: 40 },
  { contract: "armaar_legal_service_lifts_s21", company: "ARLIS_NDERTIM", title: "Renewal notice — 60 days before the anniversary", type: "RENEWAL", responsible: "arlis.legal", due: 5 },
];

export async function seedArmaarLegal(prisma: PrismaClient) {
  const today = localDate(new Date(), ZONE);
  const day = (offset: number) => new Date(`${addLocalDays(today, offset)}T12:00:00.000Z`);
  const at = (offset: number, hour = 10) => new Date(`${addLocalDays(today, offset)}T${String(hour).padStart(2, "0")}:00:00.000Z`);
  const counsel = (code: CompanyCode) => memberId(LEGAL[code]!, code);

  /* New contracts (§21) ------------------------------------------------------- */
  for (const contract of CONTRACTS) {
    const code = contract.company;
    const id = `armaar_legal_${contract.key}`;
    const live = contract.status === "ACTIVE";
    await prisma.contract.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: companyId(code),
        contractNumber: contract.number,
        title: contract.title,
        contractType: contract.type,
        projectId: contract.project ? projectId(contract.project) : null,
        ownerMemberId: counsel(code),
        status: contract.status,
        counterpartyName: contract.counterparty,
        currency: contract.value === null ? null : EUR,
        contractValue: contract.value === null ? null : money(contract.value),
        signedDate: contract.signed === null ? null : day(contract.signed),
        effectiveDate: live && contract.signed !== null ? day(contract.signed + 1) : null,
        expiryDate: contract.signed !== null && contract.term ? day(contract.signed + contract.term) : null,
        renewalType: contract.renewal ?? "NONE",
        renewalNoticeDays: contract.renewal === "AUTO_RENEW" ? 60 : null,
        autoRenewalPeriodMonths: contract.renewal === "AUTO_RENEW" ? 12 : null,
        governingLaw: "Albanian law",
        jurisdiction: "Tirana",
        summary: contract.summary,
        createdByMemberId: counsel(code),
        createdAt: at((contract.signed ?? -2) - 14),
      },
    });
    await party(prisma, id, code, "OUR_COMPANY", COMPANY_NAME[code]!, false);
    await party(prisma, id, code, contract.type === "CLIENT_AGREEMENT" || contract.type === "CONSULTING" ? "CLIENT" : "COUNTERPARTY", contract.counterparty, true);
    if (contract.pending) {
      await prisma.contractApproval.upsert({
        where: { id: `${id}_approval` },
        update: {},
        create: { id: `${id}_approval`, companyId: companyId(code), recordType: "CONTRACT", recordId: id, status: "PENDING", submittedByMemberId: counsel(code), submittedAt: at(-2, 11) },
      });
    }
  }

  /* Parties on the existing contracts --------------------------------------------- */
  for (const [contract, name] of SUBCONTRACTORS) {
    await party(prisma, contract, BCI, "OUR_COMPANY", COMPANY_NAME[BCI]!, false);
    await party(prisma, contract, BCI, "SUBCONTRACTOR", name, true);
  }
  await party(prisma, "armaar_contract_framework_steel", BCI, "OUR_COMPANY", COMPANY_NAME[BCI]!, false);
  await party(prisma, "armaar_contract_framework_steel", BCI, "COUNTERPARTY", "Adriatik Steel sh.p.k.", true);
  // The façade subcontractor's bank stands behind its performance.
  await party(prisma, "armaar_contract_sub_vlora_glass", BCI, "GUARANTOR", "Demo Bank sh.a.", false);

  /* What each side still owes ---------------------------------------------------------- */
  for (const [index, obligation] of OBLIGATIONS.entries()) {
    const code = obligation.company ?? BCI;
    const id = `armaar_obl_${String(index + 1).padStart(2, "0")}`;
    await prisma.contractObligation.upsert({
      where: { id },
      update: {},
      create: { id, companyId: companyId(code), contractId: obligation.contract, title: obligation.title, obligationType: obligation.type, responsibleMemberId: memberId(obligation.responsible, code), dueDate: day(obligation.due), status: obligation.done === undefined ? "OPEN" : "COMPLETED", completedAt: obligation.done === undefined ? null : at(obligation.done, 15), createdByMemberId: counsel(code), createdAt: at(Math.min(obligation.due, 0) - 30) },
    });
  }

  /* Amendments ------------------------------------------------------------------------ */
  // Tower B's two extra office floors: signed and in force, so the contract's value includes them.
  const floors = { previous: 52_000_000, delta: 3_400_000 };
  await prisma.contractAmendment.upsert({
    where: { id: "armaar_amendment_construction_001" },
    update: {},
    create: { id: "armaar_amendment_construction_001", companyId: companyId(BCI), contractId: "armaar_contract_construction_tl", amendmentNumber: "AMD-001", title: "Tower B — two additional office floors", summary: "Levels 13 and 14 of Tower B added to the works; +€3.4 million and 90 days.", status: "ACTIVE", signedDate: day(-120), effectiveDate: day(-118), activatedAt: at(-118, 9), valueDelta: money(floors.delta), previousContractValue: money(floors.previous), newContractValue: money(floors.previous + floors.delta), createdByMemberId: counsel(BCI), createdAt: at(-140) },
  });
  await prisma.contract.updateMany({ where: { id: "armaar_contract_construction_tl", contractValue: money(floors.previous) }, data: { contractValue: money(floors.previous + floors.delta) } });
  await prisma.contractAmendment.upsert({
    where: { id: "armaar_amendment_frame_001" },
    update: {},
    create: { id: "armaar_amendment_frame_001", companyId: companyId(BCI), contractId: "armaar_contract_sub_albabuild", amendmentNumber: "AMD-001", title: "Podium transfer slab — redesign", summary: "Thicker transfer slab under the Tower B plant room; +€185,000.", status: "APPROVED", valueDelta: money(185_000), createdByMemberId: counsel(BCI), createdAt: at(-12) },
  });
  await prisma.contractApproval.upsert({
    where: { id: "armaar_amendment_frame_001_approval" },
    update: {},
    create: { id: "armaar_amendment_frame_001_approval", companyId: companyId(BCI), recordType: "AMENDMENT", recordId: "armaar_amendment_frame_001", status: "APPROVED", submittedByMemberId: counsel(BCI), submittedAt: at(-10, 11), decidedByMemberId: memberId(APPROVER[BCI]!, BCI), decidedAt: at(-8, 10), decisionNote: "Agreed with the structural engineer's revised calculation." },
  });
  await prisma.contractAmendment.upsert({
    where: { id: "armaar_amendment_hvac_001" },
    update: {},
    create: { id: "armaar_amendment_hvac_001", companyId: companyId(BCI), contractId: "armaar_contract_sub_klimatek", amendmentNumber: "AMD-001", title: "AHU specification — heat-recovery upgrade", summary: "Rotary heat recovery on AHU-1 to AHU-6; +€96,000, no change to the programme.", status: "DRAFT", valueDelta: money(96_000), createdByMemberId: counsel(BCI), createdAt: at(-1) },
  });

  const inGroup = { company: { parentGroupId: ARMAAR_GROUP_ID } };
  return {
    contracts: await prisma.contract.count({ where: { ...inGroup, contractType: { not: "SALE_AGREEMENT" } } }),
    parties: await prisma.contractParty.count({ where: inGroup }),
    obligations: await prisma.contractObligation.count({ where: inGroup }),
    amendments: await prisma.contractAmendment.count({ where: inGroup }),
  };
}

async function party(prisma: PrismaClient, contractId: string, code: CompanyCode, role: "OUR_COMPANY" | "CLIENT" | "COUNTERPARTY" | "SUBCONTRACTOR" | "GUARANTOR", name: string, primary: boolean) {
  const id = `${contractId}_party_${role.toLowerCase()}`;
  await prisma.contractParty.upsert({
    where: { id },
    update: {},
    create: { id, companyId: companyId(code), contractId, partyRole: role, partyType: "COMPANY", name, legalName: name, city: "Tirana", country: "Albania", isPrimaryCounterparty: primary },
  });
}
