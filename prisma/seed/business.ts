/**
 * Core business records: clients, contacts, projects, project membership,
 * tasks, documents and activity (PRD #9 §33–§65).
 *
 * The project membership matrix in §45 is mandatory — it is what makes scope
 * testable. A Project Manager must meet records they may see *and* records they
 * may not (PRD #9 §254).
 */
import type { PrismaClient } from "@prisma/client";

import { normalizeName } from "../../lib/modules/clients/client.duplicate";
import { COMPANY_A, COMPANY_B, PROJECT_IDS, daysFromNow } from "./constants";

type Members = Map<string, string>;

const CLIENTS = [
  { id: "client_acme", code: "CLI-001", name: "ACME Developments", type: "COMPANY", status: "ACTIVE", city: "Tiranë" },
  { id: "client_beta", code: "CLI-002", name: "Beta Properties", type: "COMPANY", status: "ACTIVE", city: "Durrës" },
  { id: "client_meridian", code: "CLI-003", name: "Meridian Group", type: "COMPANY", status: "ACTIVE", city: "Vlorë" },
  { id: "client_atlas", code: "CLI-004", name: "Atlas Holdings", type: "COMPANY", status: "ACTIVE", city: "Tiranë" },
  { id: "client_nova", code: "CLI-005", name: "Nova Living", type: "COMPANY", status: "ACTIVE", city: "Shkodër" },
  { id: "client_urban", code: "CLI-006", name: "Urban Core", type: "COMPANY", status: "ACTIVE", city: "Tiranë" },
  { id: "client_horizon", code: "CLI-007", name: "Horizon Estates", type: "COMPANY", status: "ACTIVE", city: "Sarandë" },
  { id: "client_delta", code: "CLI-008", name: "Delta Offices", type: "COMPANY", status: "ACTIVE", city: "Tiranë" },
  { id: "client_greenline", code: "CLI-009", name: "Greenline Residences", type: "COMPANY", status: "ACTIVE", city: "Elbasan" },
  { id: "client_municipality", code: "CLI-010", name: "Central Municipality", type: "PUBLIC_ENTITY", status: "ACTIVE", city: "Tiranë" },
  { id: "client_elena", code: "CLI-011", name: "Elena Demo Client", type: "INDIVIDUAL", status: "INACTIVE", city: "Korçë" },
  { id: "client_archive", code: "CLI-012", name: "Archive Test Client", type: "COMPANY", status: "ARCHIVED", city: "Fier" },
] as const;

const CONTACTS = [
  { clientId: "client_acme", firstName: "Ana", lastName: "Beqiri", jobTitle: "Development Director", isPrimary: true },
  { clientId: "client_acme", firstName: "Dritan", lastName: "Hoxha", jobTitle: "Commercial Manager", isPrimary: false },
  { clientId: "client_beta", firstName: "Erion", lastName: "Kola", jobTitle: "Managing Partner", isPrimary: true },
  { clientId: "client_beta", firstName: "Lira", lastName: "Meta", jobTitle: "Project Lead", isPrimary: false },
  { clientId: "client_meridian", firstName: "Sara", lastName: "Vokshi", jobTitle: "Head of Property", isPrimary: true },
  { clientId: "client_meridian", firstName: "Genc", lastName: "Rama", jobTitle: "Finance Controller", isPrimary: false },
  { clientId: "client_atlas", firstName: "Mira", lastName: "Duka", jobTitle: "Operations Director", isPrimary: true },
  { clientId: "client_nova", firstName: "Klodian", lastName: "Zeka", jobTitle: "Founder", isPrimary: true },
  { clientId: "client_urban", firstName: "Elsa", lastName: "Prifti", jobTitle: "Portfolio Manager", isPrimary: true },
  { clientId: "client_urban", firstName: "Redi", lastName: "Balla", jobTitle: "Asset Manager", isPrimary: false },
  { clientId: "client_horizon", firstName: "Nora", lastName: "Cela", jobTitle: "Development Manager", isPrimary: true },
  { clientId: "client_delta", firstName: "Arben", lastName: "Leka", jobTitle: "Facilities Director", isPrimary: true },
  { clientId: "client_greenline", firstName: "Blerta", lastName: "Gjoka", jobTitle: "Sustainability Lead", isPrimary: true },
  { clientId: "client_greenline", firstName: "Ilir", lastName: "Sula", jobTitle: "Site Liaison", isPrimary: false },
  { clientId: "client_municipality", firstName: "Fatos", lastName: "Bardhi", jobTitle: "Head of Planning", isPrimary: true },
  { clientId: "client_municipality", firstName: "Teuta", lastName: "Malaj", jobTitle: "Procurement Officer", isPrimary: false },
  { clientId: "client_elena", firstName: "Elena", lastName: "Kastrati", jobTitle: "Owner", isPrimary: true },
  { clientId: "client_archive", firstName: "Piro", lastName: "Nika", jobTitle: "Former Contact", isPrimary: true },
] as const;

/** PRD #9 §38–§45: the projects and the membership matrix that scope rests on. */
const PROJECTS = [
  {
    id: PROJECT_IDS.a, code: "PRJ-001", name: "Riverside Residences",
    client: "client_acme", status: "ACTIVE", priority: "HIGH",
    manager: "user_pm", start: -120, end: 240,
    city: "Tiranë",
    description: "Mixed-use riverside development of 96 apartments across three blocks.",
    team: ["user_pm", "user_architect", "user_engineer", "user_qaqc", "user_hse", "user_viewer"],
  },
  {
    id: PROJECT_IDS.b, code: "PRJ-002", name: "Central Office Tower",
    client: "client_beta", status: "ACTIVE", priority: "MEDIUM",
    manager: "user_pm", start: -60, end: 400,
    city: "Durrës",
    description: "Eighteen-storey commercial tower with two basement levels.",
    team: ["user_pm", "user_qaqc", "user_hse"],
  },
  {
    id: PROJECT_IDS.c, code: "PRJ-003", name: "Marina Apartments",
    client: "client_meridian", status: "ACTIVE", priority: "HIGH",
    manager: "user_owner", start: -30, end: 300,
    city: "Vlorë",
    description: "Waterfront residential scheme with a public promenade.",
    team: ["user_architect"],
  },
  {
    id: PROJECT_IDS.d, code: "PRJ-004", name: "Logistics Hub",
    client: "client_atlas", status: "ON_HOLD", priority: "CRITICAL",
    manager: "user_owner", start: -200, end: -10,
    city: "Tiranë",
    description: "Distribution centre and vehicle yard, paused pending permits.",
    team: ["user_engineer", "user_qaqc", "user_hse"],
  },
  {
    id: PROJECT_IDS.e, code: "PRJ-005", name: "Greenline Villas",
    client: "client_greenline", status: "DRAFT", priority: "LOW",
    manager: null, start: 30, end: 420,
    city: "Elbasan",
    description: "Twelve low-energy villas, currently at feasibility stage.",
    team: [],
  },
  {
    id: PROJECT_IDS.f, code: "PRJ-006", name: "Completed Retail Center",
    client: "client_urban", status: "COMPLETED", priority: "MEDIUM",
    manager: "user_owner", start: -700, end: -90,
    city: "Tiranë",
    description: "Retail and leisure centre, handed over last quarter.",
    team: [],
  },
] as const;

export async function seedBusinessRecords(prisma: PrismaClient, members: Members) {
  const owner = members.get("user_owner")!;
  const actor = "user_owner";

  /* Clients and contacts ---------------------------------------------------- */

  for (const client of CLIENTS) {
    await prisma.client.upsert({
      where: { id: client.id },
      update: {},
      create: {
        id: client.id,
        companyId: COMPANY_A,
        code: client.code,
        name: client.name,
        legalName: client.type === "INDIVIDUAL" ? null : `${client.name} sh.p.k.`,
        type: client.type,
        status: client.status,
        email: `${client.code.toLowerCase()}@client.test`,
        // Distinct per client: a shared demo number would make every client
        // look like a duplicate of every other one (PRD #12 §54).
        phone: `+355 69 ${client.code.slice(-3)} 0000`,
        city: client.city,
        country: "Albania",
        // The comparison key the duplicate check reads. Maintained by the
        // service in the running product; set here so seeded data behaves the
        // same way (PRD #12 §55).
        normalizedName: normalizeName(client.name),
        createdBy: actor,
        archivedAt: client.status === "ARCHIVED" ? daysFromNow(-40) : null,
        archivedBy: client.status === "ARCHIVED" ? actor : null,
        // Restoring the archived fixture returns it to ACTIVE (PRD #12 §74).
        preArchiveStatus: client.status === "ARCHIVED" ? "ACTIVE" : null,
      },
    });
  }

  let contactIndex = 0;
  for (const contact of CONTACTS) {
    contactIndex += 1;
    await prisma.contact.upsert({
      where: { id: `contact_${contactIndex.toString().padStart(3, "0")}` },
      update: {},
      create: {
        id: `contact_${contactIndex.toString().padStart(3, "0")}`,
        companyId: COMPANY_A,
        clientId: contact.clientId,
        firstName: contact.firstName,
        lastName: contact.lastName,
        jobTitle: contact.jobTitle,
        email: `${contact.firstName.toLowerCase()}.${contact.lastName.toLowerCase()}@client.test`,
        phone: "+355 69 100 0000",
        isPrimary: contact.isPrimary,
        status: contact.clientId === "client_archive" ? "ARCHIVED" : "ACTIVE",
        createdBy: actor,
      },
    });
  }

  /* Projects and membership ------------------------------------------------- */

  for (const project of PROJECTS) {
    const managerMemberId = project.manager ? members.get(project.manager)! : null;

    await prisma.project.upsert({
      where: { id: project.id },
      update: {},
      create: {
        id: project.id,
        companyId: COMPANY_A,
        code: project.code,
        name: project.name,
        description: project.description,
        clientId: project.client,
        projectManagerMemberId: managerMemberId,
        status: project.status,
        priority: project.priority,
        startDate: daysFromNow(project.start),
        endDate: daysFromNow(project.end),
        city: project.city,
        country: "Albania",
        createdBy: actor,
      },
    });

    const team = new Set<string>(project.team);
    if (project.manager) team.add(project.manager);

    for (const userId of team) {
      const memberId = members.get(userId)!;
      await prisma.projectMember.upsert({
        where: { projectId_companyMemberId: { projectId: project.id, companyMemberId: memberId } },
        update: {},
        create: {
          companyId: COMPANY_A,
          projectId: project.id,
          companyMemberId: memberId,
          projectRole: projectRoleFor(userId),
          isPrimary: userId === project.manager,
          status: "ACTIVE",
          joinedAt: daysFromNow(project.start),
        },
      });
    }
  }

  // Archived project fixture (PRD #9 §44).
  await prisma.project.upsert({
    where: { id: PROJECT_IDS.archived },
    update: {},
    create: {
      id: PROJECT_IDS.archived,
      companyId: COMPANY_A,
      code: "PRJ-099",
      name: "Archive Test Project",
      description: "Kept archived so exclusion, the archived list and restore can be tested.",
      clientId: "client_archive",
      projectManagerMemberId: owner,
      status: "ARCHIVED",
      preArchiveStatus: "ON_HOLD",
      priority: "LOW",
      startDate: daysFromNow(-500),
      endDate: daysFromNow(-200),
      city: "Fier",
      country: "Albania",
      createdBy: actor,
      archivedAt: daysFromNow(-30),
      archivedBy: actor,
    },
  });

  /* Tasks ------------------------------------------------------------------- */
  await seedTasks(prisma, members);

  /* Documents --------------------------------------------------------------- */
  await seedDocuments(prisma);

  /* Company B --------------------------------------------------------------- */
  await seedCompanyB(prisma, members);
}

function projectRoleFor(userId: string): string {
  switch (userId) {
    case "user_pm":
      return "Project Manager";
    case "user_architect":
      return "Lead Architect";
    case "user_engineer":
      return "Site Engineer";
    case "user_qaqc":
      return "QA Lead";
    case "user_hse":
      return "HSE Officer";
    case "user_viewer":
      return "Observer";
    default:
      return "Team Member";
  }
}

/**
 * 36 tasks with the status, priority and due-date spread the dashboards and
 * filters need (PRD #9 §49–§57, PRD #11 §238–§242).
 */
const TASKS: {
  title: string;
  project: string | null;
  assignee: string | null;
  status: "TODO" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "ARCHIVED";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  due: number | null;
  /** Days from now the work was scheduled to begin (PRD #11 §10). */
  start?: number;
  description?: string;
  /** A task raised by another module against its own record (PRD #11 §171). */
  source?: { module: string; entityType: string; entityId: string };
}[] = [
  { title: "Confirm block C foundation sequence", project: PROJECT_IDS.a, assignee: "user_pm", status: "IN_PROGRESS", priority: "HIGH", due: -3, start: -14, description: "Agree the pour sequence with the structural engineer before the next concrete delivery." },
  { title: "Issue revised programme to client", project: PROJECT_IDS.a, assignee: "user_pm", status: "TODO", priority: "HIGH", due: 0 },
  { title: "Review apartment layouts", project: PROJECT_IDS.a, assignee: "user_architect", status: "IN_PROGRESS", priority: "HIGH", due: 4 },
  { title: "Issue drawing revision D", project: PROJECT_IDS.a, assignee: "user_architect", status: "TODO", priority: "MEDIUM", due: 9 },
  { title: "Respond to design RFI 014", project: PROJECT_IDS.a, assignee: "user_architect", status: "BLOCKED", priority: "CRITICAL", due: -6, start: -20, description: "Waiting on the client to confirm the revised balcony balustrade specification." },
  { title: "Review structural detail S-204", project: PROJECT_IDS.a, assignee: "user_engineer", status: "IN_PROGRESS", priority: "HIGH", due: 2, start: -5 },
  { title: "Site inspection follow-up", project: PROJECT_IDS.a, assignee: "user_engineer", status: "TODO", priority: "MEDIUM", due: 6 },
  { title: "Close out concrete pour checklist", project: PROJECT_IDS.a, assignee: "user_qaqc", status: "COMPLETED", priority: "MEDIUM", due: -12 },
  { title: "Update scaffolding permit register", project: PROJECT_IDS.a, assignee: "user_hse", status: "IN_PROGRESS", priority: "HIGH", due: 1 },
  { title: "Read handover pack", project: PROJECT_IDS.a, assignee: "user_viewer", status: "TODO", priority: "LOW", due: 14 },
  { title: "Review site photographs", project: PROJECT_IDS.a, assignee: "user_viewer", status: "COMPLETED", priority: "LOW", due: -20 },
  { title: "Archive superseded drawing set", project: PROJECT_IDS.a, assignee: "user_architect", status: "ARCHIVED", priority: "LOW", due: -60 },

  { title: "Agree curtain wall procurement route", project: PROJECT_IDS.b, assignee: "user_pm", status: "IN_PROGRESS", priority: "HIGH", due: 5 },
  { title: "Chase basement waterproofing warranty", project: PROJECT_IDS.b, assignee: "user_pm", status: "TODO", priority: "MEDIUM", due: -2 },
  { title: "Coordinate MEP riser layout", project: PROJECT_IDS.b, assignee: "user_engineer", status: "TODO", priority: "HIGH", due: 11 },
  { title: "Close NCR-0031", project: PROJECT_IDS.b, assignee: "user_qaqc", status: "BLOCKED", priority: "HIGH", due: -8, start: -18, source: { module: "qaqc", entityType: "quality_record", entityId: "quality_003" }, description: "Corrective action raised from the reinforcement cover inspection." },
  { title: "Complete monthly safety walk", project: PROJECT_IDS.b, assignee: "user_hse", status: "COMPLETED", priority: "MEDIUM", due: -5 },
  { title: "Verify fire strategy sign-off", project: PROJECT_IDS.b, assignee: "user_pm", status: "COMPLETED", priority: "HIGH", due: -18 },

  { title: "Finalise facade package", project: PROJECT_IDS.c, assignee: "user_architect", status: "IN_PROGRESS", priority: "HIGH", due: 3, start: -10 },
  { title: "Prepare promenade planning submission", project: PROJECT_IDS.c, assignee: "user_architect", status: "TODO", priority: "CRITICAL", due: -1 },
  { title: "Review marina access study", project: PROJECT_IDS.c, assignee: "user_architect", status: "COMPLETED", priority: "MEDIUM", due: -25 },
  { title: "Confirm client fit-out allowance", project: PROJECT_IDS.c, assignee: "user_owner", status: "TODO", priority: "MEDIUM", due: 18 },
  { title: "Issue concept report", project: PROJECT_IDS.c, assignee: "user_owner", status: "COMPLETED", priority: "LOW", due: -40 },

  { title: "Technical issue response — yard drainage", project: PROJECT_IDS.d, assignee: "user_engineer", status: "BLOCKED", priority: "CRITICAL", due: -15, start: -30, description: "Standing water in the north yard after heavy rain. Awaiting a survey level check." },
  { title: "Reassess structural loading", project: PROJECT_IDS.d, assignee: "user_engineer", status: "IN_PROGRESS", priority: "HIGH", due: 7 },
  { title: "Update permit expiry register", project: PROJECT_IDS.d, assignee: "user_hse", status: "TODO", priority: "HIGH", due: 2 },
  { title: "Inspect stored materials", project: PROJECT_IDS.d, assignee: "user_qaqc", status: "TODO", priority: "MEDIUM", due: 12 },
  { title: "Document hold-point closure", project: PROJECT_IDS.d, assignee: "user_qaqc", status: "COMPLETED", priority: "MEDIUM", due: -30 },
  { title: "Close out demobilisation checklist", project: PROJECT_IDS.d, assignee: "user_engineer", status: "ARCHIVED", priority: "LOW", due: -80 },

  { title: "Prepare feasibility cost plan", project: PROJECT_IDS.e, assignee: "user_finance", status: "TODO", priority: "MEDIUM", due: 21 },
  { title: "Draft villa typology study", project: PROJECT_IDS.e, assignee: "user_owner", status: "TODO", priority: "LOW", due: 28 },

  { title: "Collect final retention certificate", project: PROJECT_IDS.f, assignee: "user_finance", status: "COMPLETED", priority: "MEDIUM", due: -60 },
  { title: "Archive project close-out file", project: PROJECT_IDS.f, assignee: "user_owner", status: "COMPLETED", priority: "LOW", due: -55 },

  /* Personal task with no project — proves SELF/assignment behaviour (§57). */
  { title: "Complete annual security training", project: null, assignee: "user_architect", status: "TODO", priority: "MEDIUM", due: 10 },
  { title: "Submit expense report", project: null, assignee: "user_pm", status: "COMPLETED", priority: "LOW", due: -7 },
  { title: "Review quarterly objectives", project: null, assignee: "user_owner", status: "IN_PROGRESS", priority: "MEDIUM", due: null },
];

async function seedTasks(prisma: PrismaClient, members: Members) {
  let index = 0;

  for (const task of TASKS) {
    index += 1;
    const id = `task_${index.toString().padStart(3, "0")}`;
    const assigneeMemberId = task.assignee ? (members.get(task.assignee) ?? null) : null;

    await prisma.task.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: COMPANY_A,
        projectId: task.project,
        title: task.title,
        assigneeMemberId,
        createdByMemberId: members.get("user_pm")!,
        description: task.description ?? null,
        status: task.status,
        priority: task.priority,
        startDate: task.start === undefined ? null : daysFromNow(task.start),
        dueDate: task.due === null ? null : daysFromNow(task.due),
        completedAt: task.status === "COMPLETED" ? daysFromNow((task.due ?? 0) - 1) : null,
        module: task.source?.module ?? null,
        entityType: task.source?.entityType ?? null,
        entityId: task.source?.entityId ?? null,
        createdBy: "user_pm",
        archivedAt: task.status === "ARCHIVED" ? daysFromNow(-45) : null,
        archivedBy: task.status === "ARCHIVED" ? "user_pm" : null,
        // An archived task remembers where it was, so Restore in the demo puts
        // it back rather than resetting it to To Do (PRD #11 §73).
        preArchiveStatus: task.status === "ARCHIVED" ? "COMPLETED" : null,
      },
    });
  }
}

/** 24 documents across project, client, department and archived contexts. */
const DOCUMENTS: {
  name: string;
  project?: string;
  client?: string;
  module?: string;
  archived?: boolean;
}[] = [
  { name: "Architectural Drawings.pdf", project: PROJECT_IDS.a, module: "projects" },
  { name: "Structural Coordination.pdf", project: PROJECT_IDS.a, module: "projects" },
  { name: "Project Brief.pdf", project: PROJECT_IDS.a, module: "projects" },
  { name: "Site Report — Week 32.pdf", project: PROJECT_IDS.a, module: "projects" },
  { name: "Riverside Method Statement.pdf", project: PROJECT_IDS.a, module: "hse" },
  { name: "Riverside Inspection Log.pdf", project: PROJECT_IDS.a, module: "qaqc" },
  { name: "Office Layout.pdf", project: PROJECT_IDS.b, module: "projects" },
  { name: "Project Schedule.pdf", project: PROJECT_IDS.b, module: "projects" },
  { name: "Curtain Wall Tender Pack.pdf", project: PROJECT_IDS.b, module: "procurement" },
  { name: "Marina Concept.pdf", project: PROJECT_IDS.c, module: "projects" },
  { name: "Facade Study.pdf", project: PROJECT_IDS.c, module: "projects" },
  { name: "Logistics Hub Permit.pdf", project: PROJECT_IDS.d, module: "hse" },
  { name: "Logistics Structural Review.pdf", project: PROJECT_IDS.d, module: "projects" },
  { name: "Greenline Feasibility.pdf", project: PROJECT_IDS.e, module: "projects" },
  { name: "Retail Centre Handover.pdf", project: PROJECT_IDS.f, module: "projects" },
  { name: "ACME Master Agreement.pdf", client: "client_acme", module: "contracts" },
  { name: "Beta Properties Proposal.pdf", client: "client_beta", module: "sales" },
  { name: "Meridian Client Brief.pdf", client: "client_meridian", module: "clients" },
  { name: "Company Handbook.pdf", module: "company" },
  { name: "Quality Management Plan.pdf", module: "qaqc" },
  /* Restricted fixtures (PRD #9 §61, §62). */
  { name: "Company Financial Summary.pdf", module: "finance" },
  { name: "Employee HR Record.pdf", module: "hr" },
  /* Archived fixtures (PRD #9 §63). */
  { name: "Superseded Drawing Set.pdf", project: PROJECT_IDS.a, module: "projects", archived: true },
  { name: "Old Supplier List.pdf", module: "procurement", archived: true },
];

async function seedDocuments(prisma: PrismaClient) {
  let index = 0;

  for (const document of DOCUMENTS) {
    index += 1;
    const id = `document_${index.toString().padStart(3, "0")}`;

    await prisma.document.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: COMPANY_A,
        name: document.name,
        fileName: document.name,
        mimeType: "application/pdf",
        sizeBytes: BigInt(120_000 + index * 4_500),
        projectId: document.project ?? null,
        clientId: document.client ?? null,
        module: document.module ?? null,
        status: document.archived ? "ARCHIVED" : "ACTIVE",
        createdBy: "user_pm",
        archivedAt: document.archived ? daysFromNow(-35) : null,
        archivedBy: document.archived ? "user_pm" : null,
      },
    });
  }
}

/** Company B business data — clearly distinct, for isolation tests (§236). */
async function seedCompanyB(prisma: PrismaClient, members: Members) {
  const ownerB = members.get("user_owner_b")!;
  const viewerB = members.get("user_viewer_b")!;

  const clients = [
    { id: "client_b_muc", code: "B-CLI-001", name: "Isarwerk Holding" },
    { id: "client_b_alp", code: "B-CLI-002", name: "Alpenblick Partners" },
    { id: "client_b_stadt", code: "B-CLI-003", name: "Stadtwerke München Nord" },
  ];

  for (const client of clients) {
    await prisma.client.upsert({
      where: { id: client.id },
      update: {},
      create: {
        id: client.id,
        companyId: COMPANY_B,
        code: client.code,
        name: client.name,
        type: "COMPANY",
        status: "ACTIVE",
        country: "Germany",
        normalizedName: normalizeName(client.name),
        createdBy: "user_owner_b",
      },
    });
  }

  const projects = [
    { id: "project_b_one", code: "B-PRJ-001", name: "Munich Workspace Fitout", client: "client_b_muc" },
    { id: "project_b_two", code: "B-PRJ-002", name: "Isarvorstadt Studio Refit", client: "client_b_alp" },
  ];

  for (const project of projects) {
    await prisma.project.upsert({
      where: { id: project.id },
      update: {},
      create: {
        id: project.id,
        companyId: COMPANY_B,
        code: project.code,
        name: project.name,
        description: "Company B record. Must never appear in a Company A result.",
        clientId: project.client,
        projectManagerMemberId: ownerB,
        status: "ACTIVE",
        priority: "MEDIUM",
        startDate: daysFromNow(-40),
        endDate: daysFromNow(160),
        country: "Germany",
        createdBy: "user_owner_b",
      },
    });

    for (const memberId of [ownerB, viewerB]) {
      await prisma.projectMember.upsert({
        where: {
          projectId_companyMemberId: { projectId: project.id, companyMemberId: memberId },
        },
        update: {},
        create: {
          companyId: COMPANY_B,
          projectId: project.id,
          companyMemberId: memberId,
          status: "ACTIVE",
          joinedAt: daysFromNow(-40),
        },
      });
    }
  }

  const tasks = [
    "Confirm workspace furniture package",
    "Agree acoustic treatment scope",
    "Review Isarvorstadt survey",
    "Book handover inspection",
    "Issue snagging list",
    "Close out fitout warranty file",
  ];

  let index = 0;
  for (const title of tasks) {
    index += 1;
    const id = `task_b_${index.toString().padStart(2, "0")}`;
    await prisma.task.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: COMPANY_B,
        projectId: index % 2 === 0 ? "project_b_two" : "project_b_one",
        title,
        assigneeMemberId: ownerB,
        createdByMemberId: ownerB,
        status: index > 4 ? "COMPLETED" : "TODO",
        priority: "MEDIUM",
        dueDate: daysFromNow(index * 4),
        createdBy: "user_owner_b",
      },
    });
  }

  const documents = [
    { name: "Munich Fitout Drawings.pdf", project: "project_b_one" },
    { name: "Munich Programme.pdf", project: "project_b_one" },
    { name: "Isarvorstadt Survey.pdf", project: "project_b_two" },
    { name: "Company B Handbook.pdf", project: null },
  ];

  index = 0;
  for (const document of documents) {
    index += 1;
    const id = `document_b_${index.toString().padStart(2, "0")}`;
    await prisma.document.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: COMPANY_B,
        name: document.name,
        fileName: document.name,
        mimeType: "application/pdf",
        sizeBytes: BigInt(90_000 + index * 3_000),
        projectId: document.project,
        module: "projects",
        createdBy: "user_owner_b",
      },
    });
  }
}
