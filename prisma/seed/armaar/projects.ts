/**
 * ARMAAR's public project portfolio (D-01 §15-§24, §31-§36).
 *
 * The eleven projects are public by name; Tirana Lake by its city, built area,
 * type, components and company too (`public-facts.ts`). Which company runs the
 * others, their status, dates, teams, plans and progress are synthetic and
 * recorded so (§16, §19, §78). Status uses NESTO's own: D-01's PLANNING is
 * PENDING, COMPLETED is FINISHED.
 *
 * Progress is not stored: it is the plan's — completed milestones over those
 * not cancelled (PRD #44 §129) — so Tirana Lake's 62% (§19) is eight of its
 * thirteen milestones reached, and Square 21's 100% all of them.
 */
import { Prisma, type PrismaClient, type ProjectMilestoneType, type ProjectStatus } from "@prisma/client";
import sharp from "sharp";

import { defaultProjectTypeRows } from "../../../config/project-types";
import { addLocalDays, localDate } from "../../../lib/modules/calendar/calendar.time";
import { seedStoredDocument } from "../document-objects";
import { svgFor, type Scene } from "../project-covers";
import { memberId } from "./access";
import { companyId } from "./organization";
import { personOf, userId } from "./people";
import { PROJECT_FACTS, type CompanyCode, type ProjectCode } from "./public-facts";
import { demoKey, recordDemo, slugOf } from "./records";

const ZONE = "Europe/Tirane";

export const projectId = (code: ProjectCode) => `armaar_prj_${slugOf(code)}`;

type TeamMember = { username: string; role: string };

type ProjectPlan = {
  code: ProjectCode;
  company: CompanyCode;
  short: string;
  status: ProjectStatus;
  /** Days from today. */
  start: number;
  end: number;
  type: string;
  /** Where the name says it; otherwise the country only. */
  city?: string;
  key?: true;
  description: string;
  manager: string;
  /** Who the seed made its manager before (D-03 §25): replacing them is intended; anybody else is not. */
  replaces?: string[];
  team: TeamMember[];
  milestones: { total: number; completed: number; theme: "tower" | "residential" | "hotel" | "marina" | "commercial" };
  scene: Scene;
};

const TOWER_GLASS = "#a9c7d8";

export const PROJECTS: ProjectPlan[] = [
  {
    code: "TIRANA_LAKE",
    company: "BUILDING_CONSTRUCTION_INVEST",
    short: "TL",
    status: "ACTIVE",
    start: -900,
    end: 720,
    type: "Mixed use",
    city: "Tirana",
    key: true,
    description: "A mixed-use district on the lake: residential towers, an office tower and a commercial podium. The first phase is on site.",
    manager: "bci.pm",
    team: [
      { username: "bci.pm-lead", role: "Project Director" },
      { username: "bci.architect", role: "Lead Architect" },
      { username: "unico.architect", role: "Design Architect" },
      { username: "bci.engineering", role: "Engineering Manager" },
      { username: "arlis.pm", role: "Construction Manager" },
      { username: "arlis.civil", role: "Civil Engineer" },
      { username: "arlis.mep", role: "MEP Engineer" },
      { username: "arlis.site-engineer", role: "Site Engineer" },
      { username: "arlis.site-supervisor", role: "Site Supervisor" },
      { username: "arlis.hse", role: "HSE Manager" },
      { username: "arlis.hse-officer", role: "HSE Officer" },
      { username: "arlis.qaqc-engineer", role: "QA/QC Engineer" },
      { username: "arlis.inventory", role: "Warehouse Manager" },
      { username: "arlis.buyer", role: "Procurement Specialist" },
      { username: "bci.procurement", role: "Procurement Manager" },
      { username: "bci.sales", role: "Sales Manager" },
      { username: "bci.sales-agent", role: "Sales Agent" },
      { username: "bci.finance-specialist", role: "Finance Specialist" },
      { username: "bci.legal", role: "Legal Counsel" },
      { username: "bci.viewer", role: "Observer" },
    ],
    milestones: { total: 13, completed: 8, theme: "tower" },
    scene: {
      sky: ["#8fb3cc", "#e9eef0"],
      ground: "#6f7b73",
      water: "#4f7f99",
      masses: [
        { x: 70, w: 230, h: 900, fill: "#2f3f4c", glass: TOWER_GLASS, cols: 4, rows: 17 },
        { x: 330, w: 260, h: 1040, fill: "#3c4d5a", glass: "#b9d3e1", cols: 4, rows: 20 },
        { x: 620, w: 240, h: 760, fill: "#51606b", glass: TOWER_GLASS, cols: 4, rows: 14 },
        { x: 880, w: 260, h: 380, fill: "#8d969b", glass: "#d2dde3", cols: 6, rows: 4 },
      ],
    },
  },
  {
    code: "UNITED_TOWERS",
    company: "BUILDING_CONSTRUCTION_INVEST",
    short: "UT",
    status: "ACTIVE",
    start: -520,
    end: 880,
    type: "Mixed use",
    key: true,
    description: "Twin high-rise towers of apartments, a hotel, offices and a retail base.",
    manager: "bci.pm-lead",
    team: [
      { username: "bci.architect", role: "Lead Architect" },
      { username: "bci.engineering", role: "Engineering Manager" },
      { username: "bci.sales", role: "Sales Manager" },
      { username: "bci.finance", role: "Finance Manager" },
    ],
    milestones: { total: 12, completed: 5, theme: "tower" },
    scene: {
      sky: ["#a3b9c9", "#eceeea"],
      ground: "#737a74",
      masses: [
        { x: 220, w: 300, h: 1060, fill: "#34414b", glass: "#9fc0d4", cols: 5, rows: 21 },
        { x: 640, w: 300, h: 1060, fill: "#34414b", glass: "#9fc0d4", cols: 5, rows: 21 },
        { x: 120, w: 960, h: 200, fill: "#9aa2a6", glass: "#d6e1e6", cols: 12, rows: 2 },
      ],
    },
  },
  {
    code: "SQUARE_21",
    company: "BUILDING_CONSTRUCTION_INVEST",
    short: "SQ21",
    status: "FINISHED",
    start: -1600,
    end: -300,
    type: "Residential",
    key: true,
    description: "Two residential blocks around a garden square, with shops on the ground floor. Completed and handed over.",
    manager: "bci.pm-lead",
    team: [
      { username: "bci.sales", role: "Sales Manager" },
      { username: "bci.sales-agent2", role: "Sales Agent" },
      { username: "bci.finance-specialist", role: "Finance Specialist" },
      { username: "bci.legal", role: "Legal Counsel" },
    ],
    milestones: { total: 10, completed: 10, theme: "residential" },
    scene: {
      sky: ["#c1cdd4", "#f2efe8"],
      ground: "#8e8a80",
      sun: { cx: 960, cy: 300, r: 90, fill: "#f4e3c1" },
      masses: [
        { x: 90, w: 470, h: 620, fill: "#e6ddd0", glass: "#6f8796", cols: 6, rows: 8 },
        { x: 640, w: 470, h: 620, fill: "#ded3c3", glass: "#6f8796", cols: 6, rows: 8 },
      ],
    },
  },
  {
    code: "GRAN_MELIA",
    company: "SARANDA_MARINA_INVEST",
    short: "GM",
    status: "ACTIVE",
    start: -300,
    end: 1000,
    type: "Hotel",
    key: true,
    description: "A hotel with residences, villas and apartments: the group's most complex hospitality asset.",
    manager: "smi.pm",
    team: [
      { username: "smi.architect", role: "Lead Architect" },
      { username: "smi.sales", role: "Sales Manager" },
      { username: "smi.finance", role: "Finance Manager" },
    ],
    milestones: { total: 10, completed: 3, theme: "hotel" },
    scene: {
      sky: ["#e2b48d", "#f7e9d6"],
      ground: "#d7c9b1",
      water: "#4d8aa6",
      sun: { cx: 900, cy: 380, r: 120, fill: "#fbd9a6" },
      masses: [
        { x: 60, w: 1080, h: 300, fill: "#f1ebe1", glass: "#4f6f80", cols: 14, rows: 3 },
        { x: 360, w: 480, h: 640, fill: "#ece4d6", glass: "#557888", cols: 7, rows: 8 },
      ],
    },
  },
  {
    code: "POGRADEC_MARINA",
    company: "KF_POGRADECI",
    short: "PGM",
    status: "ACTIVE",
    start: -200,
    end: 820,
    type: "Mixed use",
    city: "Pogradec",
    description: "A lakeside marina with a hotel, apartments, shops and a promenade.",
    manager: "kfp.pm",
    team: [],
    milestones: { total: 8, completed: 2, theme: "marina" },
    scene: {
      sky: ["#9dbfd3", "#eef1ec"],
      ground: "#a79f8d",
      water: "#3f7c95",
      masses: [
        { x: 120, w: 380, h: 420, fill: "#efe9df", glass: "#6b8c9c", cols: 6, rows: 5 },
        { x: 560, w: 520, h: 300, fill: "#e8e0d2", glass: "#6b8c9c", cols: 8, rows: 3 },
      ],
    },
  },
  {
    code: "EYES_OF_TIRANA",
    company: "UNICO_CONSTRUCTION",
    short: "EOT",
    status: "PENDING",
    start: 90,
    end: 1150,
    type: "Residential",
    city: "Tirana",
    description: "A residential landmark in design: concept approved, permits in preparation.",
    // Named by D-03 (§11); D-01 had the technical coordinator run it, who stays on the team.
    manager: "unico.pm",
    replaces: ["unico.coordinator"],
    team: [
      { username: "unico.coordinator", role: "Technical Coordinator" },
      { username: "unico.architecture", role: "Head of Architecture" },
      { username: "unico.architect", role: "Architect" },
      { username: "unico.designer", role: "Interior Designer" },
      { username: "unico.structural", role: "Structural Engineer" },
    ],
    milestones: { total: 6, completed: 0, theme: "residential" },
    scene: {
      sky: ["#b3c3cf", "#eef0ee"],
      ground: "#7d837d",
      masses: [
        { x: 300, w: 600, h: 980, fill: "#e4e6e6", glass: "#5d7a8a", cols: 7, rows: 16 },
      ],
    },
  },
  {
    code: "PHARMACY_10",
    company: "IDEAL_CONSTRUCTION",
    short: "PH10",
    status: "FINISHED",
    start: -1250,
    end: -520,
    type: "Commercial",
    description: "A commercial building, fitted out and occupied.",
    manager: "ideal.pm",
    team: [
      { username: "ideal.engineering", role: "Engineering Manager" },
      { username: "ideal.site-engineer", role: "Site Engineer" },
    ],
    milestones: { total: 6, completed: 6, theme: "commercial" },
    scene: {
      sky: ["#c9d2d7", "#f1f0ec"],
      ground: "#8b8c85",
      masses: [{ x: 180, w: 840, h: 460, fill: "#d9d4ca", glass: "#48606e", cols: 9, rows: 4 }],
    },
  },
  {
    code: "CORNER",
    company: "ARLIS_NDERTIM",
    short: "CRN",
    status: "FINISHED",
    start: -1450,
    end: -210,
    type: "Commercial",
    description: "A corner office and retail building, delivered last year.",
    manager: "arlis.pm-lead",
    team: [
      { username: "arlis.structural", role: "Structural Engineer" },
      { username: "arlis.civil", role: "Civil Engineer" },
    ],
    milestones: { total: 7, completed: 7, theme: "commercial" },
    scene: {
      sky: ["#aebfcb", "#eff0ec"],
      ground: "#777d78",
      masses: [
        { x: 160, w: 520, h: 760, fill: "#48535c", glass: "#b7cdd9", cols: 6, rows: 12 },
        { x: 700, w: 340, h: 540, fill: "#5d6870", glass: "#b7cdd9", cols: 4, rows: 8 },
      ],
    },
  },
  {
    code: "THE_COURTYARD",
    company: "ARLIS_NDERTIM",
    short: "CTY",
    status: "ACTIVE",
    start: -460,
    end: 300,
    type: "Residential",
    description: "Courtyard apartments around a shared garden, finishing works under way.",
    manager: "arlis.pm-lead",
    team: [
      { username: "arlis.structural", role: "Structural Engineer" },
      { username: "arlis.qaqc", role: "QA/QC Manager" },
      { username: "arlis.hse", role: "HSE Manager" },
    ],
    milestones: { total: 9, completed: 6, theme: "residential" },
    scene: {
      sky: ["#b7c6cf", "#f0eee8"],
      ground: "#8a8579",
      masses: [
        { x: 80, w: 330, h: 540, fill: "#e5dccd", glass: "#65808f", cols: 4, rows: 7 },
        { x: 440, w: 320, h: 600, fill: "#ddd2c1", glass: "#65808f", cols: 4, rows: 8 },
        { x: 790, w: 330, h: 540, fill: "#e5dccd", glass: "#65808f", cols: 4, rows: 7 },
      ],
    },
  },
  {
    code: "FARKA_RESIDENCE",
    company: "IDEAL_CONSTRUCTION",
    short: "FRK",
    status: "ACTIVE",
    start: -360,
    end: 430,
    type: "Residential",
    description: "A residential complex of low-rise blocks; the structure is complete on two of three.",
    manager: "ideal.pm",
    team: [
      { username: "ideal.site-engineer", role: "Site Engineer" },
      { username: "ideal.hse", role: "HSE Officer" },
      { username: "ideal.qaqc", role: "QA/QC Engineer" },
      { username: "arlis.buyer", role: "Procurement Specialist" },
    ],
    milestones: { total: 8, completed: 3, theme: "residential" },
    scene: {
      sky: ["#a9bdca", "#eef0ea"],
      ground: "#7f8a79",
      masses: [
        { x: 60, w: 340, h: 420, fill: "#efe7da", glass: "#5f7c8b", cols: 5, rows: 5 },
        { x: 430, w: 340, h: 480, fill: "#e7ddcd", glass: "#5f7c8b", cols: 5, rows: 6 },
        { x: 800, w: 340, h: 300, fill: "#c8c2b6", glass: "#9aa9b1", cols: 5, rows: 3 },
      ],
    },
  },
  {
    code: "CLEARWATER_BEACH",
    company: "SARANDA_MARINA_INVEST",
    short: "CWB",
    status: "PENDING",
    start: 120,
    end: 1300,
    type: "Residential",
    description: "Beachfront residences and a beach club, in planning.",
    manager: "smi.pm",
    team: [
      { username: "smi.architect", role: "Architect" },
      { username: "smi.sales-agent", role: "Sales Agent" },
    ],
    milestones: { total: 5, completed: 0, theme: "marina" },
    scene: {
      sky: ["#9fd0e3", "#f5f1e6"],
      ground: "#e6d8bb",
      water: "#3d93b3",
      sun: { cx: 260, cy: 330, r: 100, fill: "#fbe4b4" },
      masses: [
        { x: 520, w: 580, h: 360, fill: "#f6f2ea", glass: "#4f8196", cols: 8, rows: 4 },
      ],
    },
  },
];

export const planOf = (code: ProjectCode) => PROJECTS.find((project) => project.code === code)!;

/* Milestone themes ------------------------------------------------------------- */

const THEMES: Record<ProjectPlan["milestones"]["theme"], Array<[string, ProjectMilestoneType]>> = {
  tower: [
    ["Design Freeze", "DESIGN"],
    ["Building Permit Issued", "APPROVAL"],
    ["Site Mobilization", "PROJECT_START"],
    ["Excavation Complete", "CONSTRUCTION"],
    ["Foundation Complete", "CONSTRUCTION"],
    ["Podium Structure Complete", "CONSTRUCTION"],
    ["Tower A Topped Out", "CONSTRUCTION"],
    ["Tower B Topped Out", "CONSTRUCTION"],
    ["Show Apartment Ready", "OTHER"],
    ["Façade Tower A Complete", "CONSTRUCTION"],
    ["MEP First Fix Complete", "CONSTRUCTION"],
    ["Practical Completion — Phase 1", "HANDOVER"],
    ["Handover — Phase 1", "HANDOVER"],
  ],
  residential: [
    ["Design Freeze", "DESIGN"],
    ["Building Permit Issued", "APPROVAL"],
    ["Site Mobilization", "PROJECT_START"],
    ["Foundation Complete", "CONSTRUCTION"],
    ["Structure Complete", "CONSTRUCTION"],
    ["Roof Watertight", "CONSTRUCTION"],
    ["Façade Complete", "CONSTRUCTION"],
    ["Finishes Complete", "CONSTRUCTION"],
    ["Occupancy Permit", "APPROVAL"],
    ["Handover", "HANDOVER"],
  ],
  hotel: [
    ["Hotel Operator Agreement Signed", "CONTRACTUAL"],
    ["Design Freeze", "DESIGN"],
    ["Building Permit Issued", "APPROVAL"],
    ["Site Mobilization", "PROJECT_START"],
    ["Villas Structure Complete", "CONSTRUCTION"],
    ["Hotel Structure Complete", "CONSTRUCTION"],
    ["Façade Complete", "CONSTRUCTION"],
    ["FF&E Procurement Complete", "PROCUREMENT"],
    ["Pre-opening Inspection", "INSPECTION"],
    ["Hotel Opening", "HANDOVER"],
  ],
  marina: [
    ["Environmental Permit Issued", "APPROVAL"],
    ["Design Freeze", "DESIGN"],
    ["Site Mobilization", "PROJECT_START"],
    ["Breakwater Complete", "CONSTRUCTION"],
    ["Promenade Complete", "CONSTRUCTION"],
    ["Hotel Structure Complete", "CONSTRUCTION"],
    ["Marina Berths Operational", "COMMISSIONING"],
    ["Handover", "HANDOVER"],
  ],
  commercial: [
    ["Design Freeze", "DESIGN"],
    ["Building Permit Issued", "APPROVAL"],
    ["Structure Complete", "CONSTRUCTION"],
    ["Façade Complete", "CONSTRUCTION"],
    ["Fit-out Complete", "CONSTRUCTION"],
    ["Occupancy Permit", "APPROVAL"],
    ["Handover", "HANDOVER"],
  ],
};

const PHASES = ["Design & Permits", "Structure", "Envelope & Services", "Completion & Handover"];

/* Seeding ------------------------------------------------------------------------ */

export async function seedArmaarProjects(prisma: PrismaClient) {
  const conflicts: string[] = [];
  const today = localDate(new Date(), ZONE);
  const day = (offset: number) => new Date(`${addLocalDays(today, offset)}T12:00:00.000Z`);

  // Each company's project types: the defaults, and Energy where the company works in energy (§33).
  const companies = [...new Set(PROJECTS.map((project) => project.company)), "ARSOL_ENERGY" as const, "SUNRAY_ENERGY" as const];
  const typeIds = new Map<string, string>();
  for (const code of companies) {
    const id = companyId(code);
    await prisma.projectType.createMany({ data: defaultProjectTypeRows(id), skipDuplicates: true });
    if (code === "ARSOL_ENERGY" || code === "SUNRAY_ENERGY") await prisma.projectType.createMany({ data: [{ companyId: id, name: "Energy", sortOrder: 0 }], skipDuplicates: true });
    for (const row of await prisma.projectType.findMany({ where: { companyId: id }, select: { id: true, name: true } })) typeIds.set(`${code}:${row.name}`, row.id);
  }

  for (const plan of PROJECTS) {
    const fact = PROJECT_FACTS.find((candidate) => candidate.code === plan.code)!;
    if (fact.company && fact.company !== plan.company) throw new Error(`ARMAAR seed: ${fact.name} is public as ${fact.company}'s.`);
    const id = projectId(plan.code);
    const company = companyId(plan.company);
    // A manager the product appointed since is kept, and said so (D-03 §25): never two managers.
    const known = [plan.manager, ...(plan.replaces ?? [])].map((username) => memberId(username, plan.company));
    const current = await prisma.project.findUnique({
      where: { id },
      select: { projectManagerMemberId: true, projectManager: { select: { user: { select: { username: true, firstName: true, lastName: true } } } } },
    });
    const kept = current?.projectManagerMemberId && !known.includes(current.projectManagerMemberId) ? current.projectManagerMemberId : null;
    if (kept) {
      const holder = current!.projectManager!.user;
      const planned = personOf(plan.manager)!;
      conflicts.push(`${fact.name}'s manager is ${holder.firstName} ${holder.lastName} (${holder.username}), appointed in the product: ${planned.firstName} ${planned.lastName} (${plan.manager}) not made its manager`);
    }
    const managerMember = kept ?? memberId(plan.manager, plan.company);
    const data = {
      name: fact.name,
      description: plan.description,
      projectManagerMemberId: managerMember,
      status: plan.status,
      priority: plan.key ? ("HIGH" as const) : ("MEDIUM" as const),
      startDate: day(plan.start),
      endDate: day(plan.end),
      city: fact.city ?? plan.city ?? null,
      country: "Albania",
      projectTypeId: typeIds.get(`${plan.company}:${fact.type ?? plan.type}`)!,
      builtArea: fact.builtArea === undefined ? null : new Prisma.Decimal(fact.builtArea),
      isKeyProject: plan.key ?? false,
    };
    await prisma.project.upsert({ where: { id }, update: data, create: { id, companyId: company, code: plan.short, createdBy: userId(plan.manager), ...data } });
    await recordDemo(prisma, {
      key: demoKey("PROJECT", plan.code),
      entityType: "Project",
      entityId: id,
      source: "PUBLIC",
      fields: {
        name: "PUBLIC",
        company: fact.company ? "PUBLIC" : "SYNTHETIC",
        city: fact.city ? "PUBLIC" : plan.city ? "INFERRED" : "SYNTHETIC",
        ...(fact.builtArea !== undefined ? { builtArea: "PUBLIC" as const } : {}),
        type: fact.type ? "PUBLIC" : "SYNTHETIC",
        ...(fact.components ? { components: "PUBLIC" as const } : {}),
        status: "SYNTHETIC",
        progress: "SYNTHETIC",
        dates: "SYNTHETIC",
        team: "SYNTHETIC",
        description: "SYNTHETIC",
      },
      note: fact.company ? undefined : "Which group company runs this project is not in the source set: assigned for the demo.",
    });

    const team = [{ username: plan.manager, role: "Project Manager" }, ...plan.team];
    for (const [index, member] of team.entries()) {
      const member_ = memberId(member.username, plan.company);
      const joined = day(Math.min(plan.start, 0) + index * 7);
      await prisma.projectMember.upsert({
        where: { projectId_companyMemberId: { projectId: id, companyMemberId: member_ } },
        update: { projectRole: member.role, isPrimary: index === 0 && !kept, status: "ACTIVE" },
        create: { companyId: company, projectId: id, companyMemberId: member_, projectRole: member.role, isPrimary: index === 0 && !kept, status: "ACTIVE", joinedAt: joined },
      });
    }

    await seedCover(prisma, plan);
    await seedPlan(prisma, plan, managerMember, day);
  }

  return { projects: PROJECTS.length, conflicts };
}

async function seedCover(prisma: PrismaClient, plan: ProjectPlan) {
  const id = `armaar_doc_cover_${slugOf(plan.code)}`;
  const exists = await prisma.document.findUnique({ where: { id }, select: { id: true } });
  if (!exists) {
    const bytes = await sharp(Buffer.from(svgFor(plan.scene))).jpeg({ quality: 82 }).toBuffer();
    const fact = PROJECT_FACTS.find((candidate) => candidate.code === plan.code)!;
    await seedStoredDocument(prisma, {
      id,
      companyId: companyId(plan.company),
      name: `${fact.name} render.jpg`,
      description: "Cover render for the Projects page. An illustration for the demo, not the project's own render.",
      projectId: projectId(plan.code),
      uploadedByMemberId: memberId(plan.manager, plan.company),
      createdBy: userId(plan.manager),
      bytes: new Uint8Array(bytes),
    });
  }
  await prisma.project.update({ where: { id: projectId(plan.code) }, data: { coverImageDocumentId: id } });
  const fact = PROJECT_FACTS.find((candidate) => candidate.code === plan.code)!;
  await prisma.projectMedia.upsert({
    where: { projectId_documentId: { projectId: projectId(plan.code), documentId: id } },
    update: {
      type: "RENDER",
      title: `${fact.name} render`,
      sortOrder: 0,
      isCover: true,
      isFeatured: true,
    },
    create: {
      id: `armaar_media_cover_${slugOf(plan.code)}`,
      companyId: companyId(plan.company),
      projectId: projectId(plan.code),
      documentId: id,
      type: "RENDER",
      title: `${fact.name} render`,
      sortOrder: 0,
      isCover: true,
      isFeatured: true,
      createdByMemberId: memberId(plan.manager, plan.company),
    },
  });
}

/** Phases and milestones, the project manager's (`owner`); completed ones in the past, the rest ahead (PRD #44). */
async function seedPlan(prisma: PrismaClient, plan: ProjectPlan, owner: string, day: (offset: number) => Date) {
  const company = companyId(plan.company);
  const project = projectId(plan.code);
  await prisma.projectPlanningSettings.upsert({ where: { companyId: company }, update: {}, create: { companyId: company } });

  const names = THEMES[plan.milestones.theme].slice(0, plan.milestones.total);
  const { total, completed } = { total: names.length, completed: Math.min(plan.milestones.completed, names.length) };
  // Reached ones spread from the start to a fortnight ago; the rest from next week to the end.
  const pastEnd = Math.min(plan.end, -14);
  const futureStart = Math.max(plan.start, 7);
  const dateOf = (index: number) => {
    if (index < completed) return completed === 1 ? plan.start : Math.round(plan.start + ((pastEnd - plan.start) * index) / (completed - 1));
    const ahead = total - completed;
    const position = index - completed;
    return ahead === 1 ? futureStart : Math.round(futureStart + ((plan.end - futureStart) * position) / (ahead - 1));
  };

  const perPhase = Math.ceil(total / PHASES.length);
  for (const [phaseIndex, phaseName] of PHASES.entries()) {
    const members = names.map((_, index) => index).filter((index) => Math.floor(index / perPhase) === phaseIndex);
    if (members.length === 0) continue;
    const done = members.filter((index) => index < completed).length;
    const phaseId = `armaar_phase_${slugOf(plan.code)}_${phaseIndex + 1}`;
    const first = dateOf(members[0]!);
    const last = dateOf(members[members.length - 1]!);
    const status = done === members.length ? ("COMPLETED" as const) : done > 0 || (first <= 0 && plan.status === "ACTIVE") ? ("IN_PROGRESS" as const) : ("NOT_STARTED" as const);
    const phase = {
      name: phaseName,
      sortOrder: phaseIndex + 1,
      status,
      progressPercent: new Prisma.Decimal(Math.round((done / members.length) * 100)),
      plannedStartDate: day(first - 30),
      plannedEndDate: day(last),
      actualStartDate: first - 30 <= 0 && plan.status !== "PENDING" ? day(first - 30) : null,
      actualEndDate: status === "COMPLETED" ? day(last) : null,
      ownerMemberId: owner,
    };
    await prisma.projectPhase.upsert({ where: { id: phaseId }, update: phase, create: { id: phaseId, companyId: company, projectId: project, createdByMemberId: owner, ...phase } });

    for (const index of members) {
      const [name, type] = names[index]!;
      const date = dateOf(index);
      const reached = index < completed;
      const next = index === completed && plan.status === "ACTIVE";
      // Tirana Lake's services are behind the façade: at risk, a critical path item (§36).
      const atRisk = plan.code === "TIRANA_LAKE" && name.startsWith("MEP");
      const milestone = {
        phaseId,
        name,
        milestoneType: type,
        sortOrder: index + 1,
        status: reached ? ("COMPLETED" as const) : atRisk ? ("AT_RISK" as const) : next ? ("IN_PROGRESS" as const) : ("NOT_STARTED" as const),
        baselineDate: day(date),
        plannedDate: day(date),
        forecastDate: day(atRisk ? date + 12 : date),
        actualDate: reached ? day(date + ((index % 3) - 1) * 3) : null,
        progressPercent: new Prisma.Decimal(reached ? 100 : next ? 55 : 0),
        completedByMemberId: reached ? owner : null,
        ownerMemberId: owner,
        critical: type === "HANDOVER" || atRisk,
        externallyCommitted: type === "HANDOVER",
        statusChangedAt: day(Math.min(date, 0)),
      };
      const id = `armaar_ms_${slugOf(plan.code)}_${String(index + 1).padStart(2, "0")}`;
      await prisma.projectMilestone.upsert({ where: { id }, update: milestone, create: { id, companyId: company, projectId: project, createdByMemberId: owner, ...milestone } });
    }
  }
}
