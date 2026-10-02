/**
 * ARMAAR's delivery work, lived in (D-04 enrichment, projects and delivery).
 *
 * D-01 and D-02 wrote the headline records, mostly on Tirana Lake. This stage
 * spreads the ordinary run of work across every working company and project,
 * over the last six months and the next three:
 *
 *   tasks         in every product state (to do, in progress, blocked, done,
 *                 archived), overdue ones among them, some with a comment thread
 *   planning      milestone dependencies in sequence, tasks linked to the
 *                 milestone they serve, blockers raised and resolved
 *   meetings      each project's recurring progress, design or site meetings,
 *                 the group's management and HSE reviews: held ones with
 *                 minutes, decisions and actions, some cancelled, the rest ahead
 *   calendar      public holidays, trainings, deadlines and team events
 *   RFIs          every project on site, in every register state, answered ones
 *                 with their responses
 *   daily logs    Tirana Lake's older, locked diary; The Courtyard's and United
 *                 Towers' with their own crews (E-04's, by id)
 *   timesheets    earlier weeks of the people who already log time, approved,
 *                 one rejected
 *
 * Milestones themselves are not added: a project's progress is its completed
 * milestones over all of them, and D-01 fixes Tirana Lake's and Square 21's.
 * Daily logs and timesheets are written once, relative to the first run, like
 * site.ts and timesheets.ts. Every value is synthetic. Stable ids with the
 * `armaar_d04_` prefix; a rerun adds nothing.
 */
import type {
  CalendarEventType,
  CalendarVisibility,
  DailyLogStatus,
  DailyLogWeatherCondition,
  EngineeringDiscipline,
  MeetingActionItemStatus,
  MeetingType,
  PrismaClient,
  RfiPriority,
  RfiStatus,
  TaskPriority,
  TaskStatus,
  WorkLogType,
} from "@prisma/client";
import { Prisma } from "@prisma/client";

import { addLocalDays, instantFromLocal, localDate } from "../../../lib/modules/calendar/calendar.time";
import { AGENDA_TEMPLATES } from "../../../lib/modules/meetings/meeting.types";
import { businessInstant, weekStartOf } from "../../../lib/modules/timesheets/timesheet.time";
import { memberId } from "./access";
import { contractorId } from "./operations";
import { companyId } from "./organization";
import { personOf, userId } from "./people";
import { planOf, projectId } from "./projects";
import type { CompanyCode, ProjectCode } from "./public-facts";
import { ARMAAR_GROUP_ID } from "./records";

const ZONE = "Europe/Tirane";
const BCI = "BUILDING_CONSTRUCTION_INVEST" as const;
const ALN = "ARLIS_NDERTIM" as const;
const P = "armaar_d04";
const pad = (value: number, width = 3) => String(value).padStart(width, "0");
const dec = (value: number) => new Prisma.Decimal(value);
const pick = <T>(list: readonly T[], index: number): T => list[((index % list.length) + list.length) % list.length]!;

/* Who works where ------------------------------------------------------------------ */

/** A company's scope for delivery work: its people with a login there. */
type Scope = { company: CompanyCode; project: ProjectCode | null; leads: string[]; people: string[] };

const SCOPES: Record<string, Scope> = {
  TIRANA_LAKE: {
    company: BCI,
    project: "TIRANA_LAKE",
    leads: ["bci.pm", "bci.pm-lead", "arlis.pm", "bci.engineering"],
    people: ["arlis.site-engineer", "arlis.mep", "arlis.civil", "arlis.qaqc-engineer", "arlis.hse-officer", "bci.architect", "bci.procurement", "arlis.site-supervisor", "arlis.inventory", "unico.architect", "arlis.buyer", "bci.engineering", "bci.legal", "bci.finance-specialist", "arlis.hse"],
  },
  UNITED_TOWERS: { company: "UNICO_CONSTRUCTION", project: "UNITED_TOWERS", leads: ["unico.coordinator", "unico.engineering"], people: ["unico.architect", "unico.architecture", "unico.structural", "unico.designer", "unico.finance", "armaar.procurement", "unico.engineering"] },
  CLEARWATER_BEACH: { company: "SARANDA_MARINA_INVEST", project: "CLEARWATER_BEACH", leads: ["smi.pm", "smi.director"], people: ["smi.architect", "smi.finance", "armaar.architecture", "armaar.legal"] },
  POGRADEC_MARINA: { company: "ARLIS_NDERTIM", project: "POGRADEC_MARINA", leads: ["arlis.pm-lead", "arlis.director"], people: ["arlis.pm-lead", "armaar.engineering", "armaar.hse", "armaar.procurement", "armaar.qaqc", "armaar.legal"] },
  EYES_OF_TIRANA: { company: "IDEAL_CONSTRUCTION", project: "EYES_OF_TIRANA", leads: ["unico.pm", "ideal.pm"], people: ["unico.structural", "unico.architecture", "ideal.engineering", "ideal.site-engineer", "unico.designer", "ideal.procurement", "unico.architect"] },
  SQUARE_21: { company: ALN, project: "SQUARE_21", leads: ["arlis.pm-lead", "arlis.director"], people: ["arlis.qaqc", "arlis.legal", "arlis.accountant", "arlis.site-supervisor", "bci.sales-agent2"] },
  ARSOL: { company: "ARSOL_ENERGY", project: null, leads: ["arsol.pm", "arsol.director"], people: ["arsol.electrical", "arsol.engineering", "arsol.procurement", "arsol.finance", "arsol.legal"] },
  GROUP: { company: "ARLIS_ADMINISTRIM", project: null, leads: ["armaar.owner", "armaar.projects"], people: ["armaar.finance", "armaar.hr", "armaar.legal", "armaar.it", "armaar.procurement", "armaar.hse", "armaar.qaqc", "armaar.sales"] },
};

/* Tasks ------------------------------------------------------------------------------ */

const TASK_TITLES: Record<keyof typeof SCOPES, string[]> = {
  TIRANA_LAKE: [
    "Pour record and cube results — Tower A level 6 slab",
    "Pre-pour inspection — Tower A level 7 slab",
    "Update the three-week look-ahead programme",
    "Rebar schedule check — Tower A levels 9 to 12",
    "Close out the scaffold inspection findings on Tower B",
    "Confirm the hoist maintenance visit with the supplier",
    "Mark up the as-built drainage run under the podium",
    "Monthly valuation — AlbaBuild frame package",
    "Monthly valuation — Vlora Glass façade package",
    "Agree the façade access sequence with the crane plan",
    "Chase the fire-stopping product data from AquaTek",
    "Review the lift installation method statement",
    "Coordinate the podium roof plant platform with MEP",
    "Snag list — Tower A levels 3 and 4 common areas",
    "Prepare the lender's monitoring pack for the month",
    "Issue the revised setting-out for the Tower B lobby",
    "Survey the basement B2 slab for the waterproofing",
    "Collect the O&M manual structure from the MEP contractors",
    "Agree the temporary power relocation for the podium works",
    "Resolve the neighbour's complaint about Saturday deliveries",
    "Review the curtain-wall visual mock-up results",
    "Book the fire brigade access route inspection",
    "Reconcile the ready-mix tickets for the month",
    "Update the site logistics plan for the façade hoists",
    "Check the balcony drainage outlets on levels 2 to 5",
    "Prepare the handover sequence for the show apartment floor",
    "Issue the snagging procedure to the finishing contractors",
    "Review the landscaping planting schedule",
    "Book the acoustic tests for the party walls, level 4",
    "Chase the building control sign-off for the basement",
  ],
  UNITED_TOWERS: [
    "Geotechnical report — review the pile recommendations",
    "Concept massing options for the planning pre-application",
    "Traffic impact study — brief the consultant",
    "Structural grid coordination with the parking layout",
    "Fire strategy — first draft for the towers",
    "Planning drawings — sections and elevations",
    "Cost plan at concept stage",
    "Façade concept — daylight and solar study",
    "Utility capacity letters from OSHEE and UKT",
    "Excavation and shoring method statement",
    "Survey the party wall to the east boundary",
    "Tender list for the frame contractors",
    "BIM execution plan — issue for comment",
    "Landscape concept for the podium garden",
    "Energy performance calculation for the permit",
    "Neighbour consultation meeting notes",
  ],
  CLEARWATER_BEACH: [
    "Concept masterplan — beach access options",
    "Land title check on the southern plots",
    "Environmental screening report",
    "Feasibility study — mixed-use programme",
    "Brief the architect on the hotel component",
    "Utility connection enquiry — water and sewer",
    "Market study for the residential units",
    "Investor presentation draft",
  ],
  POGRADEC_MARINA: [
    "Bathymetric survey of the marina basin",
    "Breakwater armour stone supply quotations",
    "Environmental monitoring report — lake water quality",
    "Promenade lighting design review",
    "Pontoon supplier technical comparison",
    "Dredging method statement for approval",
    "Municipality meeting on the lakeside path",
    "Fuel station permit application",
    "Hotel concept design brief",
    "Update the programme after the permit conditions",
    "Fish spawning season restrictions — plan the works",
    "Winter works risk assessment",
  ],
  EYES_OF_TIRANA: [
    "Observation deck — wind tunnel test scope",
    "Structural concept report — core and outriggers",
    "Planning pre-application pack",
    "Visitor flow study for the lifts",
    "Façade lighting concept",
    "Cost plan for the observation deck options",
    "Heritage impact note for the city council",
    "Geotechnical desk study",
    "Design team fee proposals",
    "Restaurant level layout options",
    "Accessibility review of the concept",
    "Programme to planning submission",
  ],
  SQUARE_21: [
    "Defects liability — leak in the Block 2 car park ceiling",
    "Annual lift service — all blocks",
    "Handover of the last two shops",
    "Owners' association — first general meeting pack",
    "Release the retention to the façade contractor",
    "Replace the damaged entrance door, Block 4",
    "Final as-built drawings to the municipality",
    "Roof inspection before the winter",
  ],
  ARSOL: [
    "Rooftop programme batch 3 — site surveys",
    "Inverter warranty claim — batch 1 site 4",
    "Grid code compliance tests — batch 2",
    "PV module supplier audit",
    "PPA invoicing reconciliation for the quarter",
    "Structural checks for the school roofs",
    "O&M contract renewal — cleaning services",
    "Monitoring platform — alarm thresholds review",
    "Battery storage pilot — feasibility note",
    "Insurance renewal for the installed systems",
  ],
  GROUP: [
    "Group budget 2027 — call for company submissions",
    "Quarterly HSE statistics for the board",
    "Group insurance programme renewal",
    "Review the delegation of authority matrix",
    "Annual appraisal cycle — timetable",
    "Group procurement framework — steel and rebar",
    "Board pack for the quarterly review",
    "IT — laptop refresh for the site teams",
  ],
};

const BLOCKED_REASONS = [
  "Waiting for the consultant's revised drawings.",
  "Waiting for the supplier to confirm the delivery date.",
  "On hold until the municipality replies to our letter.",
  "Waiting for the laboratory results.",
  "Needs the client's decision on the finish.",
  "Waiting for the subcontractor's method statement.",
  "Access blocked until the scaffold is re-tagged.",
];

const COMMENTS: Record<"open" | "done" | "blocked", string[]> = {
  open: [
    "I've started on this; first draft by the end of the week.",
    "Can we look at this together at the next coordination meeting?",
    "Spoke to the supplier this morning — they are checking stock.",
    "Uploaded the marked-up drawing to the project documents.",
    "Adding this to the look-ahead so the site team is aware.",
  ],
  done: [
    "Done — results filed against the project.",
    "Closed out on site today, photos in the daily log.",
    "Signed off. Thanks everyone.",
    "Completed; the follow-up is on next month's list.",
  ],
  blocked: [
    "Still nothing back. I've sent a reminder.",
    "Escalated to the director — we need an answer this week.",
    "They promised an answer by Thursday.",
  ],
};

function taskStatusOf(index: number, due: number): TaskStatus {
  if (due < -10) return index % 10 === 0 ? "IN_PROGRESS" : index % 10 === 1 && due > -30 ? "TODO" : index % 10 === 9 ? "ARCHIVED" : "COMPLETED";
  if (due < 0) return pick<TaskStatus>(["COMPLETED", "IN_PROGRESS", "BLOCKED", "TODO", "COMPLETED"], index);
  if (due <= 14) return pick<TaskStatus>(["BLOCKED", "IN_PROGRESS", "IN_PROGRESS", "TODO", "TODO"], index);
  return index % 4 === 0 ? "IN_PROGRESS" : "TODO";
}

/* RFIs --------------------------------------------------------------------------- */

type RfiPlan = { project: ProjectCode; start: number; raisers: string[]; assignees: string[]; contractor?: string[]; items: Array<[subject: string, question: string, discipline: EngineeringDiscipline, answer: string]> };

const RFIS: RfiPlan[] = [
  {
    project: "TIRANA_LAKE",
    start: 15,
    raisers: ["arlis.site-engineer", "arlis.mep", "arlis.civil", "bci.engineering"],
    assignees: ["bci.architect", "bci.engineering", "arlis.civil", "unico.architect"],
    contractor: ["albabuild", "vlora_glass", "elektronord", "aquatek", "klimatek", "durres_finishing"],
    items: [
      ["Tower A level 5 slab edge — cast-in channel height", "The cast-in channels for the façade at level 5 are 40 mm lower than on FAC-SD-210. Can the brackets take the tolerance?", "FACADE", "Yes, the bracket slots take ±50 mm; record the actual levels on the survey."],
      ["Sleeve positions through the podium transfer beam", "Three MEP sleeves clash with the bottom reinforcement of beam TB-4. Can they move 200 mm up?", "STRUCTURAL", "Move them 200 mm up and add two U-bars each side, as marked up."],
      ["Apartment kitchen extract route, type 2+1", "The kitchen extract on the 2+1 cannot reach the riser without crossing the bedroom ceiling. Is a recirculating hood acceptable?", "MECHANICAL", "No; route it through the corridor bulkhead as sketched, and lower the bulkhead to 2.40 m."],
      ["Balcony soffit finish — Tower A", "The finishes schedule says render, the elevation says fibre-cement board. Which one?", "ARCHITECTURE", "Fibre-cement board, colour as the sample approved last month."],
      ["Emergency lighting in the stair cores", "Is the emergency lighting in the stairs self-contained or on the central battery system?", "ELECTRICAL", "Central battery system for the cores; self-contained in the apartments' corridors."],
      ["Screed thickness over the underfloor heating", "The heating manufacturer asks for 65 mm; the section shows 50 mm. Can the floor build-up change?", "MECHANICAL", "65 mm; the acoustic layer drops to 5 mm, keeping the finished floor level."],
      ["Shop front glazing heights at the podium", "SH-P02 to SH-P04 are shown 3.6 m high, but the transfer beam is at 3.4 m. Which governs?", "ARCHITECTURE", "The beam governs; 3.35 m glazing with a 50 mm head detail."],
      ["Car park ventilation fan positions, B2", "The jet fans at B2 clash with the sprinkler mains. Can the fans move to the next bay?", "FIRE_PROTECTION", "Yes, move them one bay north; the CFD report still holds."],
      ["Waterproofing lap at the lift pits", "Does the lift pit membrane lap up the pit walls to the slab soffit or stop 300 mm above the pit floor?", "ARCHITECTURE", ""],
      ["Door hardware for the apartment entrances", "The schedule lists a three-point lock; the sample door has a single lock. Which is required?", "INTERIORS", ""],
      ["Structural opening for the Tower B server room", "The tenant fit-out needs a 600 × 400 opening in the level 3 slab. Can it be cored?", "STRUCTURAL", ""],
      ["Parking bay widths at the columns, B1", "Six bays next to the columns are 2.30 m. Is this acceptable for sale?", "CIVIL", ""],
    ],
  },
  {
    project: "UNITED_TOWERS",
    start: 1,
    raisers: ["unico.engineering", "unico.structural"],
    assignees: ["unico.architect", "unico.architecture", "unico.structural"],
    items: [
      ["Pile type for the tower footprint", "The geotechnical report allows bored or CFA piles. Which does the design assume?", "STRUCTURAL", "CFA piles, 900 mm, as the report's option B."],
      ["Basement depth at the east boundary", "Can the third basement stop 6 m short of the east boundary to keep off the neighbour's foundations?", "CIVIL", "Yes; revise the parking layout to suit."],
      ["Tower separation for fire spread", "Is the 12 m gap between the towers enough without drenchers?", "FIRE_PROTECTION", ""],
      ["Podium garden soil depth", "What soil depth is needed for the trees on the podium garden?", "ARCHITECTURE", ""],
      ["Substation location", "Can the substation go in basement 1, or does OSHEE require it at ground level?", "ELECTRICAL", ""],
    ],
  },
  {
    project: "POGRADEC_MARINA",
    start: 1,
    raisers: ["arlis.pm-lead", "armaar.engineering"],
    assignees: ["armaar.engineering", "arlis.pm-lead"],
    items: [
      ["Breakwater crest level", "Is the breakwater crest at +1.5 m or +2.0 m above the design lake level?", "CIVIL", "+2.0 m, for the winter storm case."],
      ["Pontoon anchoring on the soft lake bed", "Chains and anchors, or piles?", "STRUCTURAL", "Piles for the main pontoon, chains for the finger pontoons."],
      ["Promenade drainage into the lake", "Can surface water discharge directly into the lake?", "PLUMBING", ""],
      ["Lighting near the reed beds", "What lighting limits apply along the protected reed beds?", "ELECTRICAL", ""],
    ],
  },
  {
    project: "EYES_OF_TIRANA",
    start: 1,
    raisers: ["ideal.engineering", "unico.structural"],
    assignees: ["unico.architecture", "unico.structural"],
    items: [
      ["Deck cantilever length", "Can the observation deck cantilever 8 m beyond the core, or is 6 m the limit for the concept?", "STRUCTURAL", "6 m for the concept; 8 m only with outriggers."],
      ["Glass floor panel loading", "What imposed load do the glass floor panels on the deck take?", "STRUCTURAL", ""],
      ["Evacuation lift strategy", "Are evacuation lifts required for the deck at 120 m?", "FIRE_PROTECTION", ""],
    ],
  },
];

/** Where each RFI stands, by its place in the list and when it was raised. */
function rfiStatusOf(index: number, opened: number, hasAnswer: boolean): RfiStatus {
  if (!hasAnswer) return index % 5 === 4 ? "DRAFT" : index % 4 === 2 ? "VOID" : "OPEN";
  if (opened < -110) return "CLOSED";
  return pick<RfiStatus>(["ANSWERED", "CLOSED", "CLARIFICATION_REQUIRED", "ANSWERED"], index);
}

/* Meetings ------------------------------------------------------------------------ */

type MeetingPlan = { key: string; scope: keyof typeof SCOPES; title: string; type: MeetingType; agenda: string; every: number; offset: number; from: string; to: string; location: string; seats: number };

const MEETINGS: MeetingPlan[] = [
  { key: "tl_site", scope: "TIRANA_LAKE", title: "Site progress meeting — Tirana Lake", type: "SITE", agenda: "site-meeting", every: 21, offset: 0, from: "08:30", to: "09:30", location: "Tirana Lake — site office", seats: 5 },
  { key: "tl_design", scope: "TIRANA_LAKE", title: "Design coordination — Tirana Lake finishes", type: "DESIGN_REVIEW", agenda: "design-review", every: 42, offset: 9, from: "11:00", to: "12:30", location: "Head office, meeting room 2", seats: 4 },
  { key: "ut_design", scope: "UNITED_TOWERS", title: "Design team meeting — United Towers", type: "DESIGN_REVIEW", agenda: "design-review", every: 28, offset: 3, from: "10:00", to: "12:00", location: "Head office, meeting room 2", seats: 4 },
  { key: "pm_progress", scope: "POGRADEC_MARINA", title: "Monthly progress — Pogradec Marina", type: "PROJECT", agenda: "project-coordination", every: 42, offset: 12, from: "11:00", to: "12:30", location: "Pogradec — office", seats: 3 },
  { key: "eot_design", scope: "EYES_OF_TIRANA", title: "Concept design review — Eyes of Tirana", type: "DESIGN_REVIEW", agenda: "design-review", every: 42, offset: 16, from: "14:00", to: "16:00", location: "IDEAL Construction — office", seats: 4 },
  { key: "cw_feasibility", scope: "CLEARWATER_BEACH", title: "Feasibility workshop — Clearwater Beach", type: "MANAGEMENT", agenda: "general", every: 56, offset: 20, from: "10:00", to: "12:00", location: "Saranda — office", seats: 3 },
  { key: "group_mgmt", scope: "GROUP", title: "Monthly management meeting — group", type: "MANAGEMENT", agenda: "management", every: 28, offset: 2, from: "09:00", to: "11:00", location: "Head office, board room", seats: 6 },
  { key: "arsol_ops", scope: "ARSOL", title: "Operations review — rooftop programme", type: "TECHNICAL", agenda: "general", every: 56, offset: 11, from: "10:00", to: "11:00", location: "ARSOL ENERGY — office", seats: 4 },
];

const SUMMARIES = [
  "Progress is broadly on programme. The look-ahead was agreed and two risks were raised for the register.",
  "Works slipped by a week on the critical path; the recovery plan was reviewed and accepted with conditions.",
  "Design comments were closed except for two items waiting for the consultant.",
  "Procurement of the long-lead items is on track; one delivery is late and is being chased.",
  "Quality and safety performance were reviewed; no lost-time injuries in the period.",
  "Budget and commitments were reviewed; the contingency draw-down is within the approved limit.",
];
const DECISIONS = [
  "Proceed with the revised sequence proposed by the site team.",
  "Hold the decision on the finish until the samples are on site.",
  "Approve the additional crew for three weeks.",
  "Keep the handover date and review again at the next meeting.",
  "Issue the package for tender as it stands.",
  "Ask the consultant for a fee proposal for the extra study.",
];
const ACTIONS = [
  "Circulate the updated programme",
  "Confirm the delivery date with the supplier",
  "Send the marked-up drawings to the consultant",
  "Book the inspection with the municipality",
  "Update the risk register",
  "Prepare the cost report for the next meeting",
  "Arrange the samples for approval",
  "Issue the site instruction",
  "Chase the outstanding submittals",
];

/* Calendar ------------------------------------------------------------------------- */

const HOLIDAYS: Array<[month: number, day: number, name: string]> = [
  [1, 1, "New Year's Day"],
  [5, 1, "Labour Day"],
  [11, 28, "Independence Day"],
  [11, 29, "Liberation Day"],
  [12, 8, "National Youth Day"],
  [12, 25, "Christmas Day"],
];

const EVENTS: Array<{ key: string; scope: keyof typeof SCOPES; title: string; type: CalendarEventType; visibility: CalendarVisibility; day: number; from?: string; to?: string; location?: string; description?: string; invite?: number }> = [
  { key: "tl_first_aid", scope: "TIRANA_LAKE", title: "First-aid refresher for supervisors", type: "TRAINING", visibility: "COMPANY", day: -150, from: "09:00", to: "13:00", location: "Tirana Lake — site office", invite: 4 },
  { key: "tl_crane_test", scope: "TIRANA_LAKE", title: "Tower crane TC-2 load test", type: "TEAM_EVENT", visibility: "PROJECT", day: -118, from: "07:00", to: "10:00", location: "Tirana Lake — Tower B" },
  { key: "tl_lender_visit", scope: "TIRANA_LAKE", title: "Lender's quarterly site visit", type: "COMPANY_EVENT", visibility: "PROJECT", day: -64, from: "10:00", to: "12:00", location: "Tirana Lake" },
  { key: "tl_facade_mockup", scope: "TIRANA_LAKE", title: "Façade visual mock-up review", type: "TEAM_EVENT", visibility: "PROJECT", day: -40, from: "11:00", to: "12:30", location: "Tirana Lake — mock-up bay" },
  { key: "tl_valuation_due", scope: "TIRANA_LAKE", title: "Monthly valuations due from the contractors", type: "INTERNAL_DEADLINE", visibility: "PROJECT", day: 26 },
  { key: "tl_show_open", scope: "TIRANA_LAKE", title: "Show apartment open day for buyers", type: "COMPANY_EVENT", visibility: "COMPANY", day: 33, from: "10:00", to: "18:00", location: "Tirana Lake — Tower A show floor" },
  { key: "tl_winter_plan", scope: "TIRANA_LAKE", title: "Winter working plan — sign-off", type: "INTERNAL_DEADLINE", visibility: "PROJECT", day: 45 },
  { key: "bci_year_end", scope: "TIRANA_LAKE", title: "Year-end closure — offices closed", type: "OFFICE_CLOSURE", visibility: "COMPANY", day: 88 },
  { key: "ut_planning_submit", scope: "UNITED_TOWERS", title: "Planning application — target submission", type: "INTERNAL_DEADLINE", visibility: "PROJECT", day: 38 },
  { key: "ut_bim_training", scope: "UNITED_TOWERS", title: "BIM coordination training", type: "TRAINING", visibility: "COMPANY", day: -55, from: "09:00", to: "17:00", location: "Head office, training room", invite: 4 },
  { key: "pm_permit_review", scope: "POGRADEC_MARINA", title: "Environmental permit — authority's review ends", type: "INTERNAL_DEADLINE", visibility: "PROJECT", day: 52 },
  { key: "pm_boat_survey", scope: "POGRADEC_MARINA", title: "Lake-bed survey by boat", type: "TEAM_EVENT", visibility: "PROJECT", day: -34, from: "07:30", to: "15:00", location: "Pogradec — lake front" },
  { key: "eot_council", scope: "EYES_OF_TIRANA", title: "City council presentation — Eyes of Tirana", type: "COMPANY_EVENT", visibility: "PROJECT", day: 60, from: "10:00", to: "11:30", location: "Tirana Municipality" },
  { key: "arsol_batch3", scope: "ARSOL", title: "Batch 3 site surveys start", type: "TEAM_EVENT", visibility: "COMPANY", day: 8, from: "08:00", to: "17:00" },
  { key: "arsol_hv_training", scope: "ARSOL", title: "High-voltage switching authorisation", type: "TRAINING", visibility: "COMPANY", day: -70, from: "09:00", to: "15:00", location: "ARSOL ENERGY — office", invite: 3 },
  { key: "group_budget", scope: "GROUP", title: "Budget 2027 submissions due", type: "INTERNAL_DEADLINE", visibility: "COMPANY", day: 40 },
  { key: "group_summer", scope: "GROUP", title: "Group summer gathering", type: "COMPANY_EVENT", visibility: "COMPANY", day: -95, from: "18:00", to: "22:00", location: "Durrës — beach restaurant" },
  { key: "group_hse_week", scope: "GROUP", title: "Group HSE week", type: "TRAINING", visibility: "COMPANY", day: -130, location: "All sites" },
];

/* Daily logs ------------------------------------------------------------------------ */

type LogPlan = { key: string; project: ProjectCode; company: CompanyCode; author: string; reviewer: string; crews: Array<{ id: string; name: string; trade: string }>; contractors: Array<{ key: string; name: string; trade: string; base: number }>; from: number; to: number; work: (index: number) => Array<{ title: string; area: string; trade: string; progress: number }>; equipment: string[] };

const LOGS: LogPlan[] = [
  {
    key: "tl",
    project: "TIRANA_LAKE",
    company: BCI,
    author: "arlis.site-engineer",
    reviewer: "bci.pm",
    crews: [
      { id: "armaar_crew_tl_concrete", name: "Tower A concrete crew", trade: "Concrete" },
      { id: "armaar_crew_tl_formwork", name: "Tower B formwork crew", trade: "Formwork" },
      { id: "armaar_crew_tl_steel", name: "Steel fixers", trade: "Steel fixing" },
      { id: "armaar_crew_tl_yard", name: "Yard and lifting", trade: "Crane & lifting" },
    ],
    contractors: [
      { key: "albabuild", name: "AlbaBuild", trade: "Concrete frame", base: 12 },
      { key: "elektronord", name: "ElektroNord", trade: "Electrical", base: 4 },
    ],
    from: -75,
    to: -1,
    work: (index) => {
      const level = Math.max(1, 8 - Math.floor(index / 8));
      return [
        { title: `Tower A level ${level} slab — ${pick(["formwork", "reinforcement", "pour", "curing and strike"], Math.floor(index / 2))}`, area: "Tower A", trade: "Concrete", progress: 25 * ((Math.floor(index / 2) % 4) + 1) },
        { title: `Tower B frame, level ${Math.max(1, 6 - Math.floor(index / 10))}`, area: "Tower B", trade: "Formwork", progress: 20 + ((index * 13) % 70) },
      ];
    },
    equipment: ["Tower crane TC-1", "Tower crane TC-2", "Passenger and goods hoist"],
  },
  {
    key: "ut",
    project: "UNITED_TOWERS",
    company: "UNICO_CONSTRUCTION",
    author: "unico.engineering",
    reviewer: "unico.coordinator",
    crews: [{ id: "armaar_crew_ut_excavation", name: "United Towers excavation crew", trade: "Excavation" }],
    contractors: [],
    from: -24,
    to: -1,
    work: (index) => [{ title: `Trial pits and enabling works — zone ${pick(["north", "east", "south", "west"], index)}`, area: "Site", trade: "Excavation", progress: Math.min(10 + index * 4, 100) }],
    equipment: ["Excavator 21 t", "Dumper 6 t"],
  },
];

/* Timesheets ----------------------------------------------------------------------- */

const TIMESHEET_PEOPLE: Array<{ member: string; approver: string; company: CompanyCode; projects: ProjectCode[]; lines: string[] }> = [
  { member: "arlis.site-engineer", approver: "bci.pm", company: BCI, projects: ["TIRANA_LAKE"], lines: ["Set-out and pour preparation.", "Daily log and delivery checks.", "Slab pour supervision.", "Progress survey and photos."] },
  { member: "arlis.mep", approver: "bci.pm", company: BCI, projects: ["TIRANA_LAKE"], lines: ["MEP first fix walk-down.", "Coordination model clash run.", "Submittal review with the contractors.", "Riser inspections."] },
  { member: "arlis.civil", approver: "bci.pm", company: BCI, projects: ["TIRANA_LAKE"], lines: ["Drainage and external works.", "Setting-out checks.", "RFI answers and mark-ups.", "Basement slab survey."] },
  { member: "arlis.qaqc-engineer", approver: "bci.pm", company: BCI, projects: ["TIRANA_LAKE"], lines: ["Pre-pour inspections.", "Cube results and records.", "Waterproofing inspections.", "NCR follow-up."] },
  { member: "arlis.hse-officer", approver: "bci.pm", company: BCI, projects: ["TIRANA_LAKE"], lines: ["Site safety walk.", "Toolbox talk and inductions.", "Permit checks.", "Scaffold tag inspections."] },
  { member: "bci.architect", approver: "bci.pm-lead", company: BCI, projects: ["TIRANA_LAKE"], lines: ["Façade drawing review.", "Finishes samples.", "Design coordination.", "Snag walk."] },
  { member: "unico.architect", approver: "bci.pm-lead", company: BCI, projects: ["TIRANA_LAKE"], lines: ["Façade shop drawings.", "Apartment layouts.", "Design team meeting."] },
  { member: "bci.pm", approver: "bci.pm-lead", company: BCI, projects: ["TIRANA_LAKE"], lines: ["Programme and look-ahead.", "Contractor meetings.", "Valuations and change control.", "Client reporting."] },
  { member: "bci.engineering", approver: "bci.director", company: BCI, projects: ["TIRANA_LAKE"], lines: ["Technical submittals.", "Engineering review.", "Site walk with the contractors."] },
];

/* The seed ------------------------------------------------------------------------- */

export async function seedArmaarEnrichDelivery(prisma: PrismaClient) {
  const today = localDate(new Date(), ZONE);
  const iso = (offset: number) => addLocalDays(today, offset);
  const day = (offset: number) => new Date(`${iso(offset)}T12:00:00.000Z`);
  const at = (offset: number, hour = 10) => new Date(`${iso(offset)}T${String(hour).padStart(2, "0")}:00:00.000Z`);
  const weekdayOf = (offset: number) => new Date(`${iso(offset)}T12:00:00.000Z`).getUTCDay();
  /** The first working day (Monday to Friday) on or after the offset. */
  const workday = (offset: number) => {
    let value = offset;
    while (weekdayOf(value) === 0 || weekdayOf(value) === 6) value += 1;
    return value;
  };
  const scopeOf = (key: keyof typeof SCOPES) => SCOPES[key]!;
  const member = (scope: Scope, username: string) => memberId(username, scope.company);
  const display = (username: string) => {
    const person = personOf(username)!;
    return `${person.firstName} ${person.lastName}`;
  };

  /* RFIs, first: tasks may be opened from them. ------------------------------------ */
  const rfiTasks: Array<{ project: ProjectCode; rfiId: string; number: string; subject: string; status: RfiStatus; assignee: string; raiser: string; due: number }> = [];
  for (const plan of RFIS) {
    const scope = Object.values(SCOPES).find((candidate) => candidate.project === plan.project)!;
    const company = companyId(scope.company);
    const project = projectId(plan.project);
    for (const [index, [subject, question, discipline, answer]] of plan.items.entries()) {
      const number = `RFI-${pad(plan.start + index)}`;
      const id = `${P}_rfi_${planOf(plan.project).short.toLowerCase()}_${pad(plan.start + index)}`;
      const opened = -170 + Math.round(((index + 0.5) * 168) / plan.items.length);
      const status = rfiStatusOf(index, opened, Boolean(answer));
      const raiser = pick(plan.raisers, index);
      const assignee = pick(plan.assignees, index + 1);
      const due = opened + 7;
      const answered = answer ? Math.min(opened + 5, -1) : undefined;
      const closed = status === "CLOSED" ? Math.min(answered! + 4, -1) : undefined;
      const priority = pick<RfiPriority>(["NORMAL", "HIGH", "NORMAL", "LOW", "CRITICAL"], index);
      const exists = await prisma.rfi.findUnique({ where: { id }, select: { id: true } });
      if (!exists) {
        // A number the product has since given to another RFI stays that one's.
        if (await prisma.rfi.findFirst({ where: { companyId: company, projectId: project, rfiNumber: number }, select: { id: true } })) continue;
        const contractor = plan.contractor ? pick(plan.contractor, index) : null;
        await prisma.rfi.create({
          data: {
            id,
            companyId: company,
            projectId: project,
            contractorId: contractor ? contractorId(contractor) : null,
            workPackageId: contractor ? `armaar_wp_${contractor}` : null,
            rfiNumber: number,
            subject,
            question,
            discipline,
            status,
            priority,
            raisedByMemberId: member(scope, raiser),
            assignedToMemberId: status === "DRAFT" ? null : member(scope, assignee),
            dueAt: status === "DRAFT" ? null : day(due),
            openedAt: status === "DRAFT" ? null : at(opened, 9),
            answeredAt: answered === undefined || status === "VOID" ? null : at(answered, 15),
            closedAt: closed === undefined ? null : at(closed, 16),
            closureNote: status === "CLOSED" ? "Answer incorporated in the next drawing revision." : null,
            voidedAt: status === "VOID" ? at(opened + 3, 11) : null,
            voidReason: status === "VOID" ? "Raised twice; answered under the earlier RFI." : null,
            createdByMemberId: member(scope, raiser),
            createdAt: at(opened, 9),
          },
        });
        if (answer && answered !== undefined) {
          await prisma.rfiResponse.create({
            data: {
              id: `${id}_response_1`,
              companyId: company,
              rfiId: id,
              responseText: status === "CLARIFICATION_REQUIRED" ? `Please confirm the grid and level before we answer. ${answer}` : answer,
              respondedByMemberId: member(scope, assignee),
              respondedAt: at(answered, 15),
              finalResponse: status !== "CLARIFICATION_REQUIRED",
              clarificationRequest: status === "CLARIFICATION_REQUIRED",
            },
          });
        }
      }
      if (status === "OPEN" || status === "CLARIFICATION_REQUIRED") rfiTasks.push({ project: plan.project, rfiId: id, number, subject, status, assignee, raiser, due });
    }
  }

  /* Tasks ---------------------------------------------------------------------------- */
  let taskNumber = 0;
  const written: Array<{ id: string; scope: Scope; status: TaskStatus; due: number; index: number }> = [];
  const writeTask = async (scope: Scope, index: number, input: { title: string; due: number; status: TaskStatus; priority: TaskPriority; assignee: string; creator: string; description?: string; link?: { module: string; entityType: string; entityId: string } }) => {
    taskNumber += 1;
    const id = `${P}_task_${pad(taskNumber)}`;
    const assignee = member(scope, input.assignee);
    const blocked = input.status === "BLOCKED";
    const archived = input.status === "ARCHIVED";
    await prisma.task.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: companyId(scope.company),
        projectId: scope.project ? projectId(scope.project) : null,
        title: input.title,
        description: input.description ?? null,
        assigneeMemberId: assignee,
        createdByMemberId: member(scope, input.creator),
        status: input.status,
        preArchiveStatus: archived ? "TODO" : null,
        priority: input.priority,
        startDate: day(Math.min(input.due - 10, -1)),
        dueDate: day(input.due),
        completedAt: input.status === "COMPLETED" ? at(Math.min(input.due - (index % 3), -1), 16) : null,
        blockedAt: blocked ? at(Math.min(input.due - 3, -1), 11) : null,
        blockedReason: blocked ? pick(BLOCKED_REASONS, index) : null,
        blockedByMemberId: blocked ? assignee : null,
        module: input.link?.module ?? null,
        entityType: input.link?.entityType ?? null,
        entityId: input.link?.entityId ?? null,
        createdBy: userId(input.creator),
        archivedAt: archived ? at(Math.min(input.due + 2, -1), 17) : null,
        archivedBy: archived ? userId(input.creator) : null,
        createdAt: at(Math.min(input.due - 12, -2), 9),
      },
    });
    written.push({ id, scope, status: input.status, due: input.due, index });
  };

  for (const [key, titles] of Object.entries(TASK_TITLES) as Array<[keyof typeof SCOPES, string[]]>) {
    const scope = scopeOf(key);
    const finished = key === "SQUARE_21";
    for (const [index, title] of titles.entries()) {
      // Spread over the last six months and the next three; Square 21's aftercare is recent.
      const span = finished ? [-60, 45] : [-170, 90];
      const due = Math.round(span[0]! + ((index + 0.5) * (span[1]! - span[0]!)) / titles.length) + ((index * 5) % 7) - 3;
      await writeTask(scope, index, {
        title,
        due,
        status: taskStatusOf(index + key.length, due),
        priority: pick<TaskPriority>(["MEDIUM", "HIGH", "MEDIUM", "LOW", "CRITICAL", "MEDIUM", "HIGH"], index + key.length),
        assignee: pick(scope.people, index),
        creator: pick(scope.leads, index),
      });
    }
  }
  // An RFI still waiting on an answer has somebody chasing it.
  for (const [index, rfi] of rfiTasks.entries()) {
    const scope = Object.values(SCOPES).find((candidate) => candidate.project === rfi.project)!;
    const due = Math.max(rfi.due, -12);
    await writeTask(scope, index, {
      title: `${rfi.status === "CLARIFICATION_REQUIRED" ? "Clarify" : "Answer"} ${rfi.number} — ${rfi.subject}`,
      due,
      status: due < 0 ? pick<TaskStatus>(["IN_PROGRESS", "TODO", "BLOCKED"], index) : pick<TaskStatus>(["TODO", "IN_PROGRESS"], index),
      priority: "HIGH",
      assignee: rfi.status === "CLARIFICATION_REQUIRED" ? rfi.raiser : rfi.assignee,
      creator: rfi.raiser,
      link: { module: "engineering", entityType: "rfi", entityId: rfi.rfiId },
    });
  }

  /* Comments on a third of the tasks ------------------------------------------------ */
  for (const task of written) {
    if (task.index % 3 !== 1 || task.status === "ARCHIVED") continue;
    const kind = task.status === "COMPLETED" ? "done" : task.status === "BLOCKED" ? "blocked" : "open";
    const threadId = `${P}_thr_${task.id.slice(P.length + 1)}`;
    const company = companyId(task.scope.company);
    const count = 1 + (task.index % 3);
    const first = Math.min(task.due - 6, -3);
    const times = Array.from({ length: count }, (_, n) => at(Math.min(first + n * 2, -1), 9 + n * 2));
    const exists = await prisma.collaborationThread.findUnique({ where: { companyId_parentType_parentId: { companyId: company, parentType: "task", parentId: task.id } }, select: { id: true } });
    if (exists) continue;
    await prisma.collaborationThread.create({ data: { id: threadId, companyId: company, parentType: "task", parentId: task.id, commentCount: count, lastCommentAt: times[count - 1]!, createdAt: times[0]! } });
    for (let n = 0; n < count; n += 1) {
      const pool = n === count - 1 ? COMMENTS[kind] : COMMENTS.open;
      const author = n % 2 === 0 ? pick(task.scope.people, task.index) : pick(task.scope.leads, task.index);
      await prisma.comment.create({ data: { id: `${threadId}_c${n + 1}`, companyId: company, threadId, authorMemberId: member(task.scope, author), body: pick(pool, task.index + n), createdAt: times[n]!, updatedAt: times[n]! } });
    }
  }

  /* Planning: dependencies, task links, blockers --------------------------------------- */
  const scopeByProject = new Map(Object.values(SCOPES).filter((scope) => scope.project).map((scope) => [scope.project!, scope]));
  for (const [code, scope] of scopeByProject) {
    const project = projectId(code);
    const company = companyId(scope.company);
    const owner = member(scope, planOf(code).manager);
    const milestones = await prisma.projectMilestone.findMany({ where: { projectId: project, archivedAt: null }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, status: true, forecastDate: true } });
    if (milestones.length < 2) continue;
    // Each milestone follows the one before it, finish to start.
    await prisma.projectMilestoneDependency.createMany({
      skipDuplicates: true,
      data: milestones.slice(1).map((milestone, index) => ({ id: `${P}_msdep_${planOf(code).short.toLowerCase()}_${pad(index + 1, 2)}`, companyId: company, projectId: project, predecessorMilestoneId: milestones[index]!.id, successorMilestoneId: milestone.id, lagDays: index % 4 === 3 ? 14 : 0, createdByMemberId: owner })),
    });
    // The project's tasks serve the milestone they fall before.
    const reached = milestones.filter((milestone) => milestone.status === "COMPLETED");
    const open = milestones.filter((milestone) => milestone.status !== "COMPLETED" && milestone.status !== "CANCELLED");
    const links = written
      .filter((task) => task.scope === scope && task.status !== "ARCHIVED")
      .flatMap((task, index) => {
        const target = task.status === "COMPLETED" && reached.length ? reached[reached.length - 1 - (index % Math.min(2, reached.length))] : open[index % Math.min(2, open.length || 1)];
        return target ? [{ id: `${P}_mslink_${task.id.slice(P.length + 1)}`, companyId: company, milestoneId: target.id, taskId: task.id, linkType: pick(["SUPPORTS", "DELIVERS", "SUPPORTS", "RELATED"] as const, index), createdByMemberId: owner }] : [];
      });
    await prisma.projectMilestoneTaskLink.createMany({ skipDuplicates: true, data: links });
    // What holds up the next milestones: one open, one already resolved.
    for (const [index, milestone] of open.slice(0, 2).entries()) {
      const blocked = written.find((task) => task.scope === scope && task.status === "BLOCKED");
      const rows = [
        { n: 1, title: index === 0 ? "Consultant drawings not yet issued for construction" : "Long-lead equipment delivery at risk", severity: index === 0 ? ("HIGH" as const) : ("MEDIUM" as const), resolved: false },
        { n: 2, title: index === 0 ? "Utility connection offer awaited" : "Permit condition to discharge before the works", severity: "MEDIUM" as const, resolved: true },
      ];
      for (const row of rows) {
        const id = `${P}_msblk_${planOf(code).short.toLowerCase()}_${index + 1}_${row.n}`;
        await prisma.projectMilestoneBlocker.upsert({
          where: { id },
          update: {},
          create: {
            id,
            companyId: company,
            milestoneId: milestone.id,
            title: row.title,
            description: row.resolved ? "Chased weekly at the progress meeting." : `Holding up "${milestone.name}". Chased weekly at the progress meeting.`,
            severity: row.severity,
            ownerMemberId: member(scope, pick(scope.leads, index + row.n)),
            dueDate: day(row.resolved ? -20 - index * 5 : 10 + index * 7),
            resolvedAt: row.resolved ? at(-18 - index * 5, 15) : null,
            resolvedByMemberId: row.resolved ? owner : null,
            resolutionNote: row.resolved ? "Received and filed; no further impact on the date." : null,
            linkedTaskId: !row.resolved && blocked ? blocked.id : null,
            createdByMemberId: owner,
            createdAt: at(row.resolved ? -40 - index * 5 : -12, 10),
          },
        });
      }
    }
  }

  /* Meetings ------------------------------------------------------------------------ */
  const template = (key: string) => AGENDA_TEMPLATES.find((row) => row.key === key)!.items;
  for (const plan of MEETINGS) {
    const scope = scopeOf(plan.scope);
    const company = companyId(scope.company);
    const organizerName = scope.leads[0]!;
    const organizer = member(scope, organizerName);
    const seats = [...new Set([...scope.leads.slice(1), ...scope.people])].filter((username) => username !== organizerName).slice(0, plan.seats);
    let occurrence = 0;
    for (let offset = -140 + plan.offset; offset <= 56; offset += plan.every) {
      occurrence += 1;
      const dayOffset = workday(offset);
      if (dayOffset === 0) continue;
      const id = `${P}_mtg_${plan.key}_${pad(occurrence, 2)}`;
      if (await prisma.meeting.findUnique({ where: { id }, select: { id: true } })) continue;
      const date = iso(dayOffset);
      const startsAt = instantFromLocal(date, plan.from, ZONE);
      const endsAt = instantFromLocal(date, plan.to, ZONE);
      const past = dayOffset < 0;
      const cancelled = occurrence % 7 === 4;
      const held = past && !cancelled;
      // The last one held still has its minutes in draft.
      const finalMinutes = held && dayOffset < -plan.every / 2;
      await prisma.$transaction(async (db) => {
        await db.meeting.create({
          data: {
            id,
            companyId: company,
            projectId: scope.project ? projectId(scope.project) : null,
            createdByMemberId: organizer,
            organizerMemberId: organizer,
            title: plan.title,
            meetingType: plan.type,
            status: cancelled ? "CANCELLED" : held ? "COMPLETED" : "SCHEDULED",
            startsAt,
            endsAt,
            timezone: ZONE,
            locationType: "IN_PERSON",
            locationText: plan.location,
            visibility: scope.project ? "PROJECT" : "PARTICIPANTS",
            startedAt: held ? startsAt : null,
            completedAt: held ? endsAt : null,
            cancelledAt: cancelled ? at(dayOffset - 2, 16) : null,
            cancelledByMemberId: cancelled ? organizer : null,
            cancelReason: cancelled ? pick(["Clashes with the municipality inspection; the next one covers both.", "Organizer on leave; items carried to the next meeting.", "Postponed for the pour."], occurrence) : null,
            minutesStatus: finalMinutes ? "FINAL" : "DRAFT",
            minutesFinalizedAt: finalMinutes ? new Date(endsAt.getTime() + 3_600_000) : null,
            minutesFinalizedByMemberId: finalMinutes ? organizer : null,
            createdAt: at(Math.min(dayOffset - 10, -1), 9),
          },
        });
        for (const [index, username] of [organizerName, ...seats].entries()) {
          const absent = held && index > 0 && (occurrence + index) % 6 === 0;
          await db.meetingParticipant.create({
            data: { meetingId: id, memberId: member(scope, username), companyId: company, role: index === 0 ? "ORGANIZER" : "ATTENDEE", response: absent ? "DECLINED" : "ACCEPTED", attendance: held ? (absent ? "ABSENT" : "PRESENT") : "UNKNOWN", displayName: display(username), invitedAt: at(Math.min(dayOffset - 7, -1)), respondedAt: at(Math.min(dayOffset - 6, -1)) },
          });
        }
        await db.meetingAgendaItem.createMany({ data: template(plan.agenda).map((item, index) => ({ companyId: company, meetingId: id, sortOrder: index, title: item.title, plannedMinutes: item.plannedMinutes ?? null, status: held ? ("DISCUSSED" as const) : ("PENDING" as const) })) });
        if (!held) return;
        await db.meetingMinutesSection.create({ data: { id: `${id}_summary`, companyId: company, meetingId: id, sortOrder: 0, title: "Summary", body: pick(SUMMARIES, occurrence + plan.key.length), createdByMemberId: organizer } });
        for (let n = 0; n < 1 + (occurrence % 2); n += 1) {
          await db.meetingDecision.create({ data: { id: `${id}_decision_${n + 1}`, companyId: company, meetingId: id, decisionNumber: n + 1, title: pick(DECISIONS, occurrence + n + plan.key.length), decidedAt: new Date(startsAt.getTime() + (n + 1) * 1_200_000), recordedByMemberId: organizer } });
        }
        for (let n = 0; n < 2 + (occurrence % 2); n += 1) {
          const due = dayOffset + 7 + n * 7;
          const status: MeetingActionItemStatus = due < -14 ? (n === 2 ? "CANCELLED" : (occurrence + n) % 6 === 0 ? "OPEN" : "DONE") : due < 0 ? pick(["OPEN", "IN_PROGRESS", "DONE"] as const, occurrence + n) : pick(["OPEN", "IN_PROGRESS"] as const, occurrence + n);
          await db.meetingActionItem.create({
            data: { id: `${id}_action_${n + 1}`, companyId: company, meetingId: id, title: pick(ACTIONS, occurrence * 3 + n + plan.key.length), ownerMemberId: member(scope, pick(seats, occurrence + n)), dueAt: day(due), status, completedAt: status === "DONE" ? at(Math.min(due - 1, -1), 15) : null, createdByMemberId: organizer },
          });
        }
      }, { timeout: 60_000 });
    }
  }

  /* Calendar events -------------------------------------------------------------- */
  const events: Array<(typeof EVENTS)[number]> = [...EVENTS];
  // Public holidays in the window, for the companies with site teams.
  for (const scopeKey of ["TIRANA_LAKE"] as const) {
    for (const [month, date, name] of HOLIDAYS) {
      for (const year of [Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1]) {
        const offset = Math.round((Date.parse(`${year}-${pad(month, 2)}-${pad(date, 2)}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
        if (offset < -180 || offset > 95) continue;
        events.push({ key: `holiday_${scopeOf(scopeKey).company.toLowerCase().slice(0, 8)}_${year}_${pad(month, 2)}${pad(date, 2)}`, scope: scopeKey, title: name, type: "COMPANY_HOLIDAY", visibility: "COMPANY", day: offset });
      }
    }
  }
  for (const event of events) {
    const scope = scopeOf(event.scope);
    const id = `${P}_cal_${event.key}`;
    if (await prisma.calendarEvent.findUnique({ where: { id }, select: { id: true } })) continue;
    const timed = event.from && event.to;
    const by = event.type === "COMPANY_HOLIDAY" ? pick(scope.leads, 1) : scope.leads[0]!;
    const company = companyId(scope.company);
    await prisma.calendarEvent.create({
      data: {
        id,
        companyId: company,
        createdByMemberId: member(scope, by),
        title: event.title,
        description: event.description ?? null,
        location: event.location ?? null,
        eventType: event.type,
        startsAt: timed ? instantFromLocal(iso(event.day), event.from!, ZONE) : new Date(`${iso(event.day)}T00:00:00.000Z`),
        endsAt: timed ? instantFromLocal(iso(event.day), event.to!, ZONE) : new Date(`${iso(event.day + 1)}T00:00:00.000Z`),
        allDay: !timed,
        timezone: ZONE,
        projectId: event.visibility === "PROJECT" && scope.project ? projectId(scope.project) : null,
        visibility: event.visibility === "PROJECT" && !scope.project ? "COMPANY" : event.visibility,
        createdAt: at(Math.min(event.day - 20, -1), 9),
      },
    });
    for (const [index, username] of scope.people.slice(0, event.invite ?? 0).entries()) {
      const status = event.day < 0 ? "ACCEPTED" : pick(["ACCEPTED", "INVITED", "TENTATIVE", "DECLINED"] as const, index);
      await prisma.calendarEventParticipant.create({ data: { eventId: id, memberId: member(scope, username), companyId: company, status, respondedAt: status === "INVITED" ? null : at(Math.min(event.day - 5, -1), 11), addedByMemberId: member(scope, by) } });
    }
  }

  /* Daily logs: written once, relative to the first run ------------------------------ */
  let logsWritten = 0;
  if ((await prisma.dailyLog.count({ where: { id: { startsWith: `${P}_dl_` } } })) === 0) {
    for (const plan of LOGS) {
      const company = companyId(plan.company);
      const project = projectId(plan.project);
      const author = memberId(plan.author, plan.company);
      const reviewer = memberId(plan.reviewer, plan.company);
      await prisma.dailyLogSettings.upsert({ where: { companyId: company }, update: {}, create: { companyId: company } });
      await prisma.projectDailyLogSettings.upsert({
        where: { projectId: project },
        update: {},
        create: { companyId: company, projectId: project, logsRequired: true, reviewerMemberId: reviewer, workingDays: [1, 2, 3, 4, 5, 6], updatedByMemberId: reviewer },
      });
      const taken = new Set((await prisma.dailyLog.findMany({ where: { projectId: project }, select: { workDate: true } })).map((row) => row.workDate.toISOString().slice(0, 10)));
      const crewSize = new Map((await prisma.workforceCrewMember.groupBy({ by: ["crewId"], where: { crewId: { in: plan.crews.map((crew) => crew.id) }, endDate: null }, _count: { _all: true } })).map((row) => [row.crewId, row._count._all]));
      const offsets: number[] = [];
      for (let offset = plan.from; offset <= plan.to; offset += 1) {
        if (weekdayOf(offset) !== 0 && !taken.has(iso(offset))) offsets.push(offset);
      }
      for (const [index, offset] of offsets.entries()) {
        const date = iso(offset);
        const time = (value: string) => instantFromLocal(date, value, ZONE);
        const next = (value: string) => instantFromLocal(addLocalDays(date, 1), value, ZONE);
        const fromEnd = offsets.length - 1 - index;
        // Tirana Lake's older diary is all locked; the other sites' recent days are still moving.
        const status: DailyLogStatus = plan.key === "tl" ? "LOCKED" : fromEnd === 0 ? "DRAFT" : fromEnd <= 2 ? "SUBMITTED" : fromEnd === 4 ? "CORRECTION_REQUIRED" : fromEnd <= 6 ? "REVIEWED" : "LOCKED";
        const weather: DailyLogWeatherCondition = index % 11 === 5 ? "RAIN" : index % 13 === 7 ? "WINDY" : pick(["CLEAR", "PARTLY_CLOUDY", "CLOUDY", "CLEAR"] as const, index);
        const wet = weather === "RAIN";
        const submitted = status !== "DRAFT";
        const reviewed = status === "REVIEWED" || status === "LOCKED";
        const work = plan.work(index);
        await prisma.dailyLog.create({
          data: {
            id: `${P}_dl_${plan.key}_${pad(index + 1)}`,
            companyId: company,
            projectId: project,
            workDate: new Date(`${date}T12:00:00.000Z`),
            status,
            createdByMemberId: author,
            submittedByMemberId: submitted ? author : null,
            submittedAt: submitted ? time("17:30") : null,
            reviewerMemberId: reviewer,
            reviewedByMemberId: reviewed ? reviewer : null,
            reviewedAt: reviewed ? next("08:15") : null,
            lockedByMemberId: status === "LOCKED" ? reviewer : null,
            lockedAt: status === "LOCKED" ? next("08:30") : null,
            returnedByMemberId: status === "CORRECTION_REQUIRED" ? reviewer : null,
            returnedAt: status === "CORRECTION_REQUIRED" ? next("08:20") : null,
            returnReason: status === "CORRECTION_REQUIRED" ? "Add the headcounts by crew before I review it." : null,
            submissionCount: submitted ? 1 : 0,
            version: submitted ? 5 + (index % 4) : 2,
            summary: `${work.map((row) => row.title).join(". ")}.${wet ? " Rain stopped external work in the afternoon." : ""}`,
            weatherSummary: wet ? "Rain from midday." : weather === "WINDY" ? "Strong wind through the middle of the day." : "Dry.",
            siteCondition: wet ? "WET" : weather === "WINDY" ? "HIGH_WIND" : "DRY",
            delaySummary: wet ? "External work stopped for the rain." : null,
            weatherEntries: {
              create: [
                { companyId: company, observedAt: time("07:00"), temperatureC: dec(8 + ((index * 3) % 18)), condition: wet ? "CLOUDY" : weather, windKph: dec(weather === "WINDY" ? 45 : 6 + (index % 8)), humidityPct: wet ? 80 : 50 + (index % 15) },
                { companyId: company, observedAt: time("13:00"), temperatureC: dec(13 + ((index * 3) % 18)), condition: weather, precipitationMm: wet ? dec(6) : null, windKph: dec(weather === "WINDY" ? 58 : 10 + (index % 6)), humidityPct: wet ? 90 : 42 + (index % 14) },
              ],
            },
            workforce: {
              create: [
                ...plan.crews.map((crew) => ({ companyId: company, organizationName: planOf(plan.project).company === BCI ? "BUILDING CONSTRUCTION INVEST" : plan.company === ALN ? "ARLIS - NDERTIM" : "UNICO CONSTRUCTION", trade: crew.trade, crewName: crew.name, crewId: crew.id, headcount: Math.max(1, (crewSize.get(crew.id) ?? 3) - (index % 3 === 2 ? 1 : 0)) })),
                ...plan.contractors.map((contractor) => ({ companyId: company, organizationName: contractor.name, contractorId: contractorId(contractor.key), workPackageId: `armaar_wp_${contractor.key}`, trade: contractor.trade, headcount: contractor.base + (index % 4) })),
              ],
            },
            workActivities: { create: work.map((row) => ({ companyId: company, title: row.title, projectArea: row.area, trade: row.trade, progressPercent: dec(row.progress), createdByMemberId: author })) },
            equipmentEntries: { create: plan.equipment.map((name) => ({ companyId: company, equipmentName: name, quantity: 1, hoursUsed: dec(wet ? 4 : 7.5), status: "IN_USE" as const })) },
            delayEntries: wet ? { create: [{ companyId: company, category: "WEATHER", title: "Rain stopped external work", startedAt: time("12:30"), endedAt: time("16:00"), durationMinutes: 210, impact: "MEDIUM", responsiblePartyText: "Weather" }] } : undefined,
            createdAt: time("07:10"),
          },
        });
        logsWritten += 1;
      }
    }
  }

  /* Timesheets: earlier weeks, written once per week -------------------------------- */
  const current = weekStartOf(today, 1);
  for (const [personIndex, person] of TIMESHEET_PEOPLE.entries()) {
    const assignment = await prisma.timesheetApproverAssignment.findUnique({ where: { memberId: memberId(person.member, person.company) }, select: { approverMemberId: true } });
    if (!assignment) continue;
    const company = companyId(person.company);
    const who = memberId(person.member, person.company);
    const approver = assignment.approverMemberId;
    for (let weeksBack = 4; weeksBack <= 7; weeksBack += 1) {
      const id = `${P}_ts_${person.member.replace(/[.-]/g, "_")}_w${weeksBack}`;
      if (await prisma.timesheet.findUnique({ where: { id }, select: { id: true } })) continue;
      const start = addLocalDays(current, -7 * weeksBack);
      const periodStart = businessInstant(start);
      if (await prisma.timesheet.findFirst({ where: { companyId: company, memberId: who, periodStart }, select: { id: true } })) continue;
      // One rejected week: hours logged against a project the person was not on.
      const status = personIndex === 3 && weeksBack === 6 ? ("REJECTED" as const) : ("APPROVED" as const);
      const note = status === "REJECTED" ? "Tuesday and Wednesday are booked to the wrong project — please log them again in a new week's correction." : null;
      const friday = new Date(`${addLocalDays(start, 4)}T16:30:00.000Z`);
      const decidedAt = new Date(friday.getTime() + 3 * 86_400_000);
      const entries: Array<{ day: number; type: WorkLogType; project?: ProjectCode; minutes: number; description?: string }> = [];
      for (let weekday = 0; weekday < 5; weekday += 1) {
        const leave = (weeksBack + personIndex + weekday) % 23 === 0;
        if (leave) continue;
        const project = pick(person.projects, weekday + weeksBack);
        const split = (weekday + personIndex) % 3 === 0;
        entries.push({ day: weekday, type: "PROJECT_WORK", project, minutes: split ? 360 : 480, description: pick(person.lines, weekday + weeksBack) });
        if (split) entries.push({ day: weekday, type: pick(["INTERNAL", "ADMIN", "TRAINING"] as const, weekday + weeksBack), minutes: 120, description: weekday % 2 ? "Team meeting." : undefined });
      }
      await prisma.$transaction(async (db) => {
        await db.timesheet.create({
          data: {
            id,
            companyId: company,
            memberId: who,
            periodStart,
            periodEnd: businessInstant(addLocalDays(start, 6)),
            status,
            approverMemberId: approver,
            submittedAt: friday,
            submittedByMemberId: who,
            approvedAt: status === "APPROVED" ? decidedAt : null,
            approvedByMemberId: status === "APPROVED" ? approver : null,
            rejectedAt: status === "REJECTED" ? decidedAt : null,
            rejectedByMemberId: status === "REJECTED" ? approver : null,
            decisionNote: note,
            submissionVersion: 1,
            version: 2,
            createdAt: new Date(`${start}T08:00:00.000Z`),
          },
        });
        await db.workLog.createMany({
          data: entries.map((entry, index) => ({
            id: `${id}_log_${index + 1}`,
            companyId: company,
            timesheetId: id,
            memberId: who,
            workDate: businessInstant(addLocalDays(start, entry.day)),
            projectId: entry.project ? projectId(entry.project) : null,
            workType: entry.type,
            minutes: entry.minutes,
            description: entry.description ?? null,
            billable: entry.type === "PROJECT_WORK",
            createdByMemberId: who,
          })),
        });
        const approvalId = `${id}_approval`;
        await db.timesheetApproval.create({ data: { id: approvalId, companyId: company, recordId: id, status, submissionVersion: 1, approverMemberId: approver, submittedByMemberId: who, submittedAt: friday, decidedByMemberId: approver, decidedAt, decisionNote: note } });
        await db.approvalStep.create({ data: { companyId: company, providerKey: "timesheets", approvalId, stepNumber: 1, label: "Approver", approverMemberId: approver, approverPermission: "timesheet.approve", status, decidedByMemberId: approver, decidedAt, decisionNote: note } });
      });
    }
  }

  const inGroup = { company: { parentGroupId: ARMAAR_GROUP_ID } };
  return {
    tasks: await prisma.task.count({ where: inGroup }),
    comments: await prisma.comment.count({ where: { id: { startsWith: `${P}_` } } }),
    milestoneLinks: await prisma.projectMilestoneTaskLink.count({ where: { id: { startsWith: `${P}_` } } }),
    milestoneDependencies: await prisma.projectMilestoneDependency.count({ where: { id: { startsWith: `${P}_` } } }),
    milestoneBlockers: await prisma.projectMilestoneBlocker.count({ where: { id: { startsWith: `${P}_` } } }),
    meetings: await prisma.meeting.count({ where: inGroup }),
    actionItems: await prisma.meetingActionItem.count({ where: inGroup }),
    events: await prisma.calendarEvent.count({ where: inGroup }),
    rfis: await prisma.rfi.count({ where: inGroup }),
    logs: await prisma.dailyLog.count({ where: inGroup }),
    logsWritten,
    timesheets: await prisma.timesheet.count({ where: inGroup }),
  };
}
