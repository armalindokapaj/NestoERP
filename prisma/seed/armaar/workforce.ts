/**
 * ARMAAR's site workforce (E-04 §4, §28-§52, §70-§74): the people who build
 * Tirana Lake, United Towers and The Courtyard, almost none of whom will ever
 * sign in to NESTO.
 *
 *   workers        twenty-four of BUILDING CONSTRUCTION INVEST's and ten of
 *                  ARLIS - NDERTIM's, each a person of the group and an
 *                  employment with a trade — no login, no role (§10-§13)
 *   sites          Tirana Lake's two towers and its batching yard, The
 *                  Courtyard's blocks, and Square 21's plot, closed when the
 *                  project was handed over (§38, §39)
 *   crews          each led by a foreman who has no login either (§31, §32);
 *                  Square 21's frame crew is archived, and its people moved to
 *                  Tirana Lake — the history is the rows (§29, §30)
 *   assignments    one primary project each; one worker moved from Tower B to
 *                  Tower A a few weeks ago (§33-§42)
 *   attendance     the last working days, marked on site by the site
 *                  supervisor, with somebody off sick (§48-§52)
 *   inductions     everybody on site inducted but a new steel fixer and a
 *                  driver whose yard induction lapsed; one entered on the wrong
 *                  date, voided and given again (§71, §270)
 *
 * In two steps, because an employment needs its history (E-03) before anything
 * refers to it, and a site needs its project: the workers first, then where
 * they work. Stable ids; a rerun adds nothing — attendance too, which is
 * written once, on the first run, for the days before it.
 */
import type { PrismaClient, WorkerCategory } from "@prisma/client";

import { addDays, businessTimestamp, dbDay, todayDay } from "../../../lib/modules/hr/employment/employment.dates";
import { memberId } from "./access";
import { companyId, type ArmaarBranches } from "./organization";
import { userId } from "./people";
import { planOf, projectId } from "./projects";
import { PROJECT_FACTS, type ProjectCode } from "./public-facts";
import { ARMAAR_GROUP_ID, demoKey, recordDemo } from "./records";

const BCI = "BUILDING_CONSTRUCTION_INVEST" as const;
const ALN = "ARLIS_NDERTIM" as const;
type Employer = typeof BCI | typeof ALN;

/** NESTO went live for the group this many days ago: nothing is placed on a site before it. */
const LIVE_DAYS = 540;

/* -------------------------------------------------------------------------- */
/* Trades and sites                                                           */
/* -------------------------------------------------------------------------- */

const TRADES: Record<Employer, Array<{ key: string; name: string; code: string }>> = {
  [BCI]: [
    { key: "concrete", name: "Concrete", code: "CON" },
    { key: "formwork", name: "Formwork", code: "FRM" },
    { key: "steel", name: "Steel fixing", code: "STL" },
    { key: "lifting", name: "Crane & lifting", code: "LFT" },
    { key: "labour", name: "General labour", code: "LAB" },
  ],
  [ALN]: [
    { key: "finishing", name: "Finishing", code: "FIN" },
    { key: "plaster", name: "Plastering", code: "PLS" },
    { key: "electrical", name: "Electrical", code: "ELE" },
    { key: "plumbing", name: "Plumbing", code: "PLB" },
  ],
};
export const tradeId = (code: Employer, key: string) => `armaar_trade_${code === BCI ? "bci" : "aln"}_${key}`;

type SiteKey = "tower_a" | "tower_b" | "yard" | "sq21_plot" | "cty_blocks";
const SITES: Array<{ key: SiteKey; company: Employer; project: ProjectCode; name: string; code: string; address: string; closedDaysAgo?: number }> = [
  { key: "tower_a", company: BCI, project: "TIRANA_LAKE", name: "Tower A", code: "TA", address: "Rruga e Liqenit, plot A" },
  { key: "tower_b", company: BCI, project: "TIRANA_LAKE", name: "Tower B", code: "TB", address: "Rruga e Liqenit, plot B" },
  { key: "yard", company: BCI, project: "TIRANA_LAKE", name: "Batching yard", code: "BY", address: "Rruga e Liqenit, north gate" },
  { key: "sq21_plot", company: BCI, project: "SQUARE_21", name: "Main plot", code: "MP", address: "Sheshi 21", closedDaysAgo: 300 },
  { key: "cty_blocks", company: ALN, project: "THE_COURTYARD", name: "Blocks 1–3", code: "B13", address: "The Courtyard, blocks 1 to 3" },
];
const siteId = (key: SiteKey) => `armaar_site_${key}`;
const siteOf = (key: SiteKey) => SITES.find((site) => site.key === key)!;
const projectName = (code: ProjectCode) => PROJECT_FACTS.find((fact) => fact.code === code)!.name;

/* -------------------------------------------------------------------------- */
/* Workers                                                                    */
/* -------------------------------------------------------------------------- */

type Worker = { key: string; first: string; last: string; title: string; trade: string; category: WorkerCategory; startedDaysAgo: number };

/** In crew order; a crew's first worker is its foreman. */
const WORKERS: Record<Employer, Worker[]> = {
  [BCI]: [
    { key: "bci_01", first: "Agim", last: "Hoxha", title: "Concrete foreman", trade: "concrete", category: "SUPERVISOR", startedDaysAgo: 2400 },
    { key: "bci_02", first: "Bujar", last: "Kola", title: "Concrete worker", trade: "concrete", category: "CONSTRUCTION_WORKER", startedDaysAgo: 1800 },
    { key: "bci_03", first: "Dritan", last: "Meta", title: "Concrete worker", trade: "concrete", category: "CONSTRUCTION_WORKER", startedDaysAgo: 1500 },
    { key: "bci_04", first: "Endrit", last: "Gjoka", title: "Concrete finisher", trade: "concrete", category: "CONSTRUCTION_WORKER", startedDaysAgo: 900 },
    { key: "bci_05", first: "Fation", last: "Lika", title: "Concrete worker", trade: "concrete", category: "CONSTRUCTION_WORKER", startedDaysAgo: 420 },
    { key: "bci_06", first: "Gëzim", last: "Rama", title: "Concrete worker", trade: "concrete", category: "CONSTRUCTION_WORKER", startedDaysAgo: 380 },
    { key: "bci_07", first: "Hysen", last: "Cani", title: "Labourer", trade: "labour", category: "CONSTRUCTION_WORKER", startedDaysAgo: 200 },
    { key: "bci_08", first: "Ilir", last: "Basha", title: "Formwork foreman", trade: "formwork", category: "SUPERVISOR", startedDaysAgo: 2000 },
    { key: "bci_09", first: "Kujtim", last: "Mehmeti", title: "Carpenter", trade: "formwork", category: "CONSTRUCTION_WORKER", startedDaysAgo: 700 },
    { key: "bci_10", first: "Lulzim", last: "Pepa", title: "Carpenter", trade: "formwork", category: "CONSTRUCTION_WORKER", startedDaysAgo: 650 },
    { key: "bci_11", first: "Mentor", last: "Shehu", title: "Carpenter", trade: "formwork", category: "CONSTRUCTION_WORKER", startedDaysAgo: 500 },
    { key: "bci_12", first: "Nazmi", last: "Leka", title: "Formwork hand", trade: "formwork", category: "CONSTRUCTION_WORKER", startedDaysAgo: 450 },
    { key: "bci_13", first: "Olsi", last: "Dervishi", title: "Formwork hand", trade: "formwork", category: "CONSTRUCTION_WORKER", startedDaysAgo: 300 },
    { key: "bci_14", first: "Petrit", last: "Zeka", title: "Formwork hand", trade: "formwork", category: "CONSTRUCTION_WORKER", startedDaysAgo: 260 },
    { key: "bci_15", first: "Qemal", last: "Bregu", title: "Steel fixing foreman", trade: "steel", category: "SUPERVISOR", startedDaysAgo: 1300 },
    { key: "bci_16", first: "Rexhep", last: "Tafa", title: "Steel fixer", trade: "steel", category: "CONSTRUCTION_WORKER", startedDaysAgo: 520 },
    { key: "bci_17", first: "Sabri", last: "Kurti", title: "Steel fixer", trade: "steel", category: "CONSTRUCTION_WORKER", startedDaysAgo: 330 },
    { key: "bci_18", first: "Vilson", last: "Troka", title: "Steel fixer", trade: "steel", category: "CONSTRUCTION_WORKER", startedDaysAgo: 240 },
    { key: "bci_19", first: "Xhevdet", last: "Llani", title: "Steel fixer", trade: "steel", category: "CONSTRUCTION_WORKER", startedDaysAgo: 6 },
    { key: "bci_20", first: "Ylli", last: "Berisha", title: "Crane operator and yard foreman", trade: "lifting", category: "SUPERVISOR", startedDaysAgo: 1100 },
    { key: "bci_21", first: "Artan", last: "Sinani", title: "Truck mixer driver", trade: "lifting", category: "DRIVER", startedDaysAgo: 800 },
    { key: "bci_22", first: "Besart", last: "Gjoni", title: "Dumper driver", trade: "lifting", category: "DRIVER", startedDaysAgo: 45 },
    { key: "bci_23", first: "Dashamir", last: "Pllumi", title: "Excavation foreman", trade: "labour", category: "SUPERVISOR", startedDaysAgo: 950 },
    { key: "bci_24", first: "Erald", last: "Nika", title: "Plant operator", trade: "labour", category: "TECHNICIAN", startedDaysAgo: 150 },
  ],
  [ALN]: [
    { key: "aln_01", first: "Fatos", last: "Gjeka", title: "Finishing foreman", trade: "finishing", category: "SUPERVISOR", startedDaysAgo: 1900 },
    { key: "aln_02", first: "Mimoza", last: "Dushku", title: "Painter", trade: "finishing", category: "CONSTRUCTION_WORKER", startedDaysAgo: 600 },
    { key: "aln_03", first: "Klodian", last: "Hasa", title: "Plasterer", trade: "plaster", category: "CONSTRUCTION_WORKER", startedDaysAgo: 540 },
    { key: "aln_04", first: "Arben", last: "Qafa", title: "Tiler", trade: "finishing", category: "CONSTRUCTION_WORKER", startedDaysAgo: 480 },
    { key: "aln_05", first: "Shpëtim", last: "Rexha", title: "Plasterer", trade: "plaster", category: "CONSTRUCTION_WORKER", startedDaysAgo: 400 },
    { key: "aln_06", first: "Elton", last: "Muçaj", title: "Finisher", trade: "finishing", category: "CONSTRUCTION_WORKER", startedDaysAgo: 220 },
    { key: "aln_07", first: "Luan", last: "Bajrami", title: "Electrical foreman", trade: "electrical", category: "SUPERVISOR", startedDaysAgo: 1600 },
    { key: "aln_08", first: "Redon", last: "Kaçani", title: "Electrician", trade: "electrical", category: "TECHNICIAN", startedDaysAgo: 700 },
    { key: "aln_09", first: "Ervin", last: "Tahiri", title: "Plumber", trade: "plumbing", category: "TECHNICIAN", startedDaysAgo: 380 },
    { key: "aln_10", first: "Kristi", last: "Gjika", title: "Electrician's mate", trade: "electrical", category: "CONSTRUCTION_WORKER", startedDaysAgo: 3 },
  ],
};
const EMPLOYEE_PREFIX: Record<Employer, string> = { [BCI]: "BCI", [ALN]: "ALN" };
const personId = (key: string) => `person_armaar_w_${key}`;
export const workerEmploymentId = (key: string) => `employee_armaar_w_${key}`;
const workerOf = (key: string) => [...WORKERS[BCI], ...WORKERS[ALN]].find((worker) => worker.key === key)!;

/* -------------------------------------------------------------------------- */
/* Crews                                                                      */
/* -------------------------------------------------------------------------- */

type Crew = {
  key: string;
  company: Employer;
  name: string;
  project: ProjectCode;
  site: SiteKey | null;
  trade: string;
  /** Foreman first. */
  members: string[];
  /** The login who manages the crew's people and marks their day on site. */
  manager: string;
  recorder: string;
  /** Square 21's crew: from the day NESTO went live until the handover. */
  ended?: { daysAgo: number; reason: string };
};

const CREWS: Crew[] = [
  {
    key: "sq21_frame",
    company: BCI,
    name: "Square 21 frame crew",
    project: "SQUARE_21",
    site: "sq21_plot",
    trade: "concrete",
    members: ["bci_01", "bci_02", "bci_03", "bci_04", "bci_08"],
    manager: "bci.pm-lead",
    recorder: "bci.pm-lead",
    ended: { daysAgo: 310, reason: "Square 21 handed over" },
  },
  { key: "tl_concrete", company: BCI, name: "Tower A concrete crew", project: "TIRANA_LAKE", site: "tower_a", trade: "concrete", members: ["bci_01", "bci_02", "bci_03", "bci_04", "bci_05", "bci_06", "bci_07"], manager: "bci.pm", recorder: "arlis.site-supervisor" },
  { key: "tl_formwork", company: BCI, name: "Tower B formwork crew", project: "TIRANA_LAKE", site: "tower_b", trade: "formwork", members: ["bci_08", "bci_09", "bci_10", "bci_11", "bci_12", "bci_13", "bci_14"], manager: "bci.pm", recorder: "arlis.site-supervisor" },
  { key: "tl_steel", company: BCI, name: "Steel fixers", project: "TIRANA_LAKE", site: "tower_a", trade: "steel", members: ["bci_15", "bci_16", "bci_17", "bci_18", "bci_19"], manager: "bci.pm", recorder: "arlis.site-supervisor" },
  { key: "tl_yard", company: BCI, name: "Yard and lifting", project: "TIRANA_LAKE", site: "yard", trade: "lifting", members: ["bci_20", "bci_21", "bci_22"], manager: "bci.pm", recorder: "arlis.site-supervisor" },
  // United Towers is still in its foundations: one crew, the whole project.
  { key: "ut_excavation", company: BCI, name: "United Towers excavation crew", project: "UNITED_TOWERS", site: null, trade: "labour", members: ["bci_23", "bci_24"], manager: "bci.pm-lead", recorder: "bci.pm-lead" },
  { key: "cty_finishing", company: ALN, name: "Courtyard finishing crew", project: "THE_COURTYARD", site: "cty_blocks", trade: "finishing", members: ["aln_01", "aln_02", "aln_03", "aln_04", "aln_05", "aln_06"], manager: "arlis.site-supervisor", recorder: "arlis.site-supervisor" },
  { key: "cty_mep", company: ALN, name: "Courtyard MEP crew", project: "THE_COURTYARD", site: "cty_blocks", trade: "electrical", members: ["aln_07", "aln_08", "aln_09", "aln_10"], manager: "arlis.site-supervisor", recorder: "arlis.site-supervisor" },
];
export const crewId = (key: string) => `armaar_crew_${key}`;
const crewOf = (key: string) => CREWS.find((crew) => crew.key === key)!;

/** Olsi Dervishi went from Tower B's formwork to Tower A's pour a few weeks ago (§29, §41). */
const MOVED = { worker: "bci_13", from: "tl_formwork", to: "tl_concrete", daysAgo: 18, reason: "Needed on Tower A for the level 12 pour" };

/**
 * One worker's time in one crew — and so on its project and site: the crew
 * memberships and the project assignments are both these rows (§29, §33).
 * Days are offsets from today; `end` is the last day, inclusive.
 */
type Stint = { worker: string; crew: Crew; start: number; end: { day: number; reason: string } | null };

const STINTS: Stint[] = (() => {
  const stints: Stint[] = [];
  const earlier = (worker: string) => CREWS.find((crew) => crew.ended && crew.members.includes(worker));
  for (const crew of CREWS) {
    for (const worker of crew.members) {
      // Nobody is on a site before they were employed, the project began, or NESTO went live.
      const joined = Math.max(-workerOf(worker).startedDaysAgo, -LIVE_DAYS, planOf(crew.project).start);
      const before = crew.ended ? undefined : earlier(worker);
      // Square 21's people came to Tirana Lake ten days after the handover.
      const start = before ? -before.ended!.daysAgo + 10 : joined;
      const moved = worker === MOVED.worker && crew.key === MOVED.from;
      const end = crew.ended ? { day: -crew.ended.daysAgo, reason: crew.ended.reason } : moved ? { day: -MOVED.daysAgo - 1, reason: MOVED.reason } : null;
      stints.push({ worker, crew, start, end });
    }
  }
  stints.push({ worker: MOVED.worker, crew: crewOf(MOVED.to), start: -MOVED.daysAgo, end: null });
  return stints;
})();
const NOW = STINTS.filter((stint) => !stint.end);
const currentCrew = (worker: string) => NOW.find((stint) => stint.worker === worker)!.crew;

/* -------------------------------------------------------------------------- */
/* Step 1: the workers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Trades, and a person and an employment for each worker. Before the E-03
 * backfill, so every employment gets its first history rows with the rest.
 */
export async function seedArmaarWorkers(prisma: PrismaClient, branches: ArmaarBranches) {
  const today = todayDay();
  for (const code of [BCI, ALN] as const) {
    for (const [index, trade] of TRADES[code].entries()) {
      const id = tradeId(code, trade.key);
      const data = { name: trade.name, code: trade.code, sortOrder: index, isActive: true };
      await prisma.workforceTrade.upsert({ where: { id }, update: data, create: { id, companyId: companyId(code), createdByMemberId: memberId(code === BCI ? "bci.hr" : "arlis.hr", code), ...data } });
    }
  }

  for (const code of [BCI, ALN] as const) {
    const hr = code === BCI ? "bci.hr" : "arlis.hr";
    const projects = branches.get(companyId(code))?.get("projects") ?? null;
    for (const [index, worker] of WORKERS[code].entries()) {
      const crew = currentCrew(worker.key);
      const site = crew.site ? siteOf(crew.site) : null;
      const started = addDays(today, -worker.startedDaysAgo);
      const person = {
        parentGroupId: ARMAAR_GROUP_ID,
        firstName: worker.first,
        lastName: worker.last,
        jobTitle: worker.title,
        city: "Tirana",
        country: "Albania",
        lifecycleStatus: "EMPLOYEE" as const,
        createdByUserId: userId(hr),
      };
      await prisma.personProfile.upsert({ where: { id: personId(worker.key) }, update: {}, create: { id: personId(worker.key), ...person } });

      const id = workerEmploymentId(worker.key);
      await prisma.employeeProfile.upsert({
        where: { id },
        update: {},
        create: {
          id,
          companyId: companyId(code),
          personProfileId: personId(worker.key),
          employeeNumber: `${EMPLOYEE_PREFIX[code]}-${String(1001 + index)}`,
          employmentStatus: "ACTIVE",
          employmentType: worker.startedDaysAgo < 30 ? "TEMPORARY" : "FULL_TIME",
          startDate: businessTimestamp(started),
          departmentId: projects,
          jobTitle: worker.title,
          managerMemberId: memberId(crew.manager, code),
          workLocationType: "SITE",
          workLocation: site ? `${projectName(crew.project)} — ${site.name}` : projectName(crew.project),
          weeklyHours: "40",
          workerCategory: worker.category,
          tradeId: tradeId(code, worker.trade),
          onboardingStatus: worker.startedDaysAgo < 30 ? "IN_PROGRESS" : "COMPLETED",
          offboardingStatus: "NOT_REQUIRED",
          createdByMemberId: memberId(hr, code),
        },
      });
      await recordDemo(prisma, { key: demoKey("WORKER", worker.key), entityType: "PersonProfile", entityId: personId(worker.key), source: "SYNTHETIC", note: "A demo site worker without a NESTO login; not a member of ARMAAR's staff." });
    }
  }
  return { workers: WORKERS[BCI].length + WORKERS[ALN].length };
}



/* -------------------------------------------------------------------------- */
/* Step 2: where they work                                                    */
/* -------------------------------------------------------------------------- */

/** A new steel fixer not inducted yet, and a driver whose yard induction lapsed: both missing one. */
const NOT_INDUCTED = new Set(["bci_19"]);
const LAPSED: Record<string, { inductedDaysAgo: number; validDaysAgo: number }> = { bci_21: { inductedDaysAgo: 400, validDaysAgo: 35 } };
/** Entered with the day he started, a week before he was inducted: voided, and given again. */
const MISDATED = "aln_05";
const ABSENT: Record<string, { daysAgo: number; notes: string }> = {
  bci_05: { daysAgo: 2, notes: "Called in sick" },
  bci_11: { daysAgo: 4, notes: "Family matter; the foreman was told the evening before" },
  aln_03: { daysAgo: 1, notes: "Called in sick" },
};

export async function seedArmaarWorkforce(prisma: PrismaClient) {
  const today = todayDay();
  const day = (offset: number) => addDays(today, offset);

  /* Sites (§38, §39) --------------------------------------------------------- */
  for (const site of SITES) {
    const id = siteId(site.key);
    const closed = site.closedDaysAgo !== undefined ? day(-site.closedDaysAgo) : null;
    await prisma.projectSite.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: companyId(site.company),
        projectId: projectId(site.project),
        name: site.name,
        code: site.code,
        address: site.address,
        city: "Tirana",
        status: closed ? "ARCHIVED" : "ACTIVE",
        archivedAt: closed ? businessTimestamp(closed) : null,
        createdByMemberId: memberId(site.company === BCI ? "bci.pm" : "arlis.pm-lead", site.company),
      },
    });
  }

  /* Crews, who was in them when, and where that put them (§28-§42) ----------- */
  for (const crew of CREWS) {
    const id = crewId(crew.key);
    await prisma.workforceCrew.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: companyId(crew.company),
        name: crew.name,
        projectId: projectId(crew.project),
        siteId: crew.site ? siteId(crew.site) : null,
        tradeId: tradeId(crew.company, crew.trade),
        supervisorEmployeeId: workerEmploymentId(crew.members[0]!),
        status: crew.ended ? "ARCHIVED" : "ACTIVE",
        archivedAt: crew.ended ? businessTimestamp(day(-crew.ended.daysAgo)) : null,
        createdByMemberId: memberId(crew.manager, crew.company),
      },
    });
  }
  for (const stint of STINTS) {
    const { crew, worker } = stint;
    const period = {
      companyId: companyId(crew.company),
      employeeProfileId: workerEmploymentId(worker),
      startDate: dbDay(day(stint.start)),
      endDate: stint.end ? dbDay(day(stint.end.day)) : null,
      endReason: stint.end?.reason ?? null,
      createdByUserId: userId(crew.manager),
      endedByUserId: stint.end ? userId(crew.manager) : null,
    };
    const crewMemberId = `armaar_crewm_${crew.key}_${worker}`;
    await prisma.workforceCrewMember.upsert({
      where: { id: crewMemberId },
      update: {},
      create: { id: crewMemberId, crewId: crewId(crew.key), role: crew.members[0] === worker ? "Foreman" : null, ...period },
    });
    const assignmentId = `armaar_epa_${crew.key}_${worker}`;
    await prisma.employeeProjectAssignment.upsert({
      where: { id: assignmentId },
      update: {},
      create: {
        id: assignmentId,
        projectId: projectId(crew.project),
        siteId: crew.site ? siteId(crew.site) : null,
        tradeId: tradeId(crew.company, workerOf(worker).trade),
        role: workerOf(worker).title,
        isPrimary: true,
        ...period,
      },
    });
  }

  /* Attendance marked on site, the working days before today (§48-§52) ------- */
  const workers = NOW.map((stint) => workerEmploymentId(stint.worker));
  const marked = await prisma.attendanceRecord.count({ where: { employeeProfileId: { in: workers }, source: "SITE" } });
  if (marked === 0) {
    const rows = [];
    for (let offset = -9; offset <= -1; offset += 1) {
      const date = day(offset);
      const weekday = dbDay(date).getUTCDay();
      if (weekday === 0) continue; // nobody on site on a Sunday
      const hours = weekday === 6 ? ["07:00", "12:00"] : ["07:00", "16:00"];
      for (const { worker, crew, start } of NOW) {
        if (offset < start) continue;
        const absent = ABSENT[worker]?.daysAgo === -offset ? ABSENT[worker] : null;
        const checkIn = absent ? null : new Date(`${date}T${hours[0]}:00.000Z`);
        const checkOut = absent ? null : new Date(`${date}T${hours[1]}:00.000Z`);
        rows.push({
          companyId: companyId(crew.company),
          employeeProfileId: workerEmploymentId(worker),
          projectId: projectId(crew.project),
          siteId: crew.site ? siteId(crew.site) : null,
          crewId: crewId(crew.key),
          date: businessTimestamp(date),
          status: absent ? ("ABSENT" as const) : ("PRESENT" as const),
          checkIn,
          checkOut,
          workedMinutes: checkIn && checkOut ? (checkOut.getTime() - checkIn.getTime()) / 60_000 : null,
          notes: absent?.notes ?? null,
          source: "SITE" as const,
          createdByMemberId: memberId(crew.recorder, crew.company),
        });
      }
    }
    await prisma.attendanceRecord.createMany({ data: rows, skipDuplicates: true });
  }

  /* Site inductions (§71, §270) ---------------------------------------------- */
  // Given by the HSE officer on Tirana Lake, the group's HSE head on United Towers, ARLIS's HSE manager on The Courtyard.
  const conductor = (crew: Crew) => (crew.company === ALN ? memberId("arlis.hse", ALN) : crew.project === "UNITED_TOWERS" ? memberId("armaar.hse", BCI) : memberId("arlis.hse-officer", BCI));
  const induct = async (id: string, data: { worker: string; crew: Crew; on: number; validUntil?: number; notes?: string; voided?: { daysAgo: number; reason: string } }) => {
    const by = conductor(data.crew);
    await prisma.hseInduction.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: companyId(data.crew.company),
        employeeProfileId: workerEmploymentId(data.worker),
        projectId: projectId(data.crew.project),
        // The yard has its own induction — plant and lifting; everybody else is inducted to the project.
        siteId: data.crew.key === "tl_yard" ? siteId("yard") : null,
        inductedOn: dbDay(day(data.on)),
        validUntil: data.validUntil === undefined ? null : dbDay(day(data.validUntil)),
        notes: data.notes ?? null,
        conductedByMemberId: by,
        createdByMemberId: by,
        voidedAt: data.voided ? businessTimestamp(day(-data.voided.daysAgo)) : null,
        voidedByMemberId: data.voided ? by : null,
        voidReason: data.voided?.reason ?? null,
      },
    });
  };
  for (const { worker, crew } of NOW) {
    if (NOT_INDUCTED.has(worker)) continue;
    // Inducted on their first day on the project, whichever crew they were in then.
    const first = Math.min(...STINTS.filter((stint) => stint.worker === worker && stint.crew.project === crew.project).map((stint) => stint.start));
    const lapsed = LAPSED[worker];
    if (lapsed) {
      await induct(`armaar_ind_${worker}`, { worker, crew, on: -lapsed.inductedDaysAgo, validUntil: -lapsed.validDaysAgo, notes: "Yard and plant induction, valid for a year." });
    } else if (worker === MISDATED) {
      await induct(`armaar_ind_${worker}_misdated`, { worker, crew, on: first, voided: { daysAgo: 10, reason: "Recorded on the wrong day: he was inducted a week after he started." } });
      await induct(`armaar_ind_${worker}`, { worker, crew, on: first + 7 });
    } else {
      await induct(`armaar_ind_${worker}`, { worker, crew, on: first });
    }
  }

  /* The tie bar near miss on Tower B: who was there (§72) -------------------- */
  const incident = await prisma.hseIncident.findUnique({ where: { id: "armaar_hse_inc_001" }, select: { id: true, companyId: true } });
  if (incident) {
    for (const [worker, involvement, notes] of [
      ["bci_10", "WITNESS", "Working at the Tower B loading bay when the bar fell."],
      ["bci_20", "INVOLVED", "Operating the crane for the curtain wall lift."],
    ] as const) {
      const id = `armaar_hse_incp_001_${worker}`;
      await prisma.hseIncidentPerson.upsert({
        where: { id },
        update: {},
        create: { id, companyId: incident.companyId, incidentId: incident.id, employeeProfileId: workerEmploymentId(worker), involvement, notes, createdByMemberId: memberId("arlis.hse-officer", BCI) },
      });
    }
  }

  const armaar = { company: { parentGroupId: ARMAAR_GROUP_ID } };
  return {
    trades: await prisma.workforceTrade.count({ where: armaar }),
    sites: await prisma.projectSite.count({ where: armaar }),
    crews: await prisma.workforceCrew.count({ where: { ...armaar, status: "ACTIVE" } }),
    onSite: await prisma.employeeProjectAssignment.count({ where: { ...armaar, endDate: null } }),
    attendance: await prisma.attendanceRecord.count({ where: { ...armaar, source: "SITE" } }),
    inductions: await prisma.hseInduction.count({ where: { ...armaar, voidedAt: null } }),
  };
}
