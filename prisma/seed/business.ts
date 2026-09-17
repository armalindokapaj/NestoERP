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
import { defaultProjectTypeRows } from "../../config/project-types";
import {
  COMPANY_SUSPENDED,
  DEMO_COMPANIES,
  DEMO_PROJECTS,
  FIXTURE_PROJECTS,
  FIXTURE_TENANT,
  FIXTURE_WORKS,
  PROJECT_IDS,
  companyFor,
  companyOfClient,
  daysFromNow,
  type SeedMembers,
} from "./constants";
import { seedStoredDocument } from "./document-objects";
import { seedProjectCovers } from "./project-covers";

type Members = SeedMembers;

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

/**
 * PRD #9 §38–§45, E-06 §44, §50: one project per company, each with its own
 * project manager, and the membership matrix that scope rests on — a team
 * member of a project, and a colleague in the same company who is not.
 */
const PROJECTS = [
  {
    ...DEMO_PROJECTS.a,
    client: "client_acme", status: "ACTIVE", priority: "HIGH", type: "Mixed use",
    manager: "user_pm", start: -120, end: 240,
    city: "Tiranë",
    description: "Mixed-use riverside development of 96 apartments across three blocks.",
    team: ["user_pm", "user_architect", "user_engineer", "user_qaqc", "user_hse", "user_viewer", "user_multicompany"],
  },
  {
    ...DEMO_PROJECTS.b,
    client: "client_beta", status: "ACTIVE", priority: "MEDIUM", type: "Commercial",
    manager: "user_pm_b", start: -60, end: 400,
    city: "Durrës",
    description: "Eighteen-storey commercial tower with two basement levels.",
    team: ["user_pm_b", "user_qaqc_b", "user_hse", "user_architecture_manager_b"],
  },
  {
    ...DEMO_PROJECTS.c,
    client: "client_atlas", status: "ACTIVE", priority: "CRITICAL", type: "Industrial",
    manager: "user_pm_c", start: -200, end: -10,
    city: "Tiranë",
    description: "Distribution centre and vehicle yard on the eastern bypass, working through its permits.",
    team: ["user_pm_c", "user_engineer_c", "user_qaqc", "user_hse_c", "user_finance_c"],
  },
  {
    ...DEMO_PROJECTS.d,
    client: "client_meridian", status: "ACTIVE", priority: "HIGH", type: "Residential",
    manager: "user_pm_d", start: -30, end: 300,
    city: "Vlorë",
    description: "Waterfront residential scheme with a public promenade.",
    team: ["user_pm_d", "user_architect_d", "user_multicompany", "user_qaqc_d"],
  },
  {
    ...DEMO_PROJECTS.e,
    // Urban Core's: the lead, the won deal, the proposal and the contracts all lead here.
    client: "client_urban", status: "ACTIVE", priority: "MEDIUM", type: "Hotel",
    manager: "user_pm_e", start: -45, end: 420,
    city: "Sarandë",
    description: "A 140-key seafront hotel with serviced residences and a retail arcade.",
    team: ["user_pm_e", "user_sales_e", "user_hse_e", "user_legal_manager_e"],
  },
] as const;

/**
 * Each company's own project types, from the defaults a new company gets
 * (E-05A §62). Returns the company's name → id map for the projects below.
 */
async function seedProjectTypes(prisma: PrismaClient, companyId: string): Promise<Map<string, string>> {
  await prisma.projectType.createMany({ data: defaultProjectTypeRows(companyId), skipDuplicates: true });
  const rows = await prisma.projectType.findMany({ where: { companyId }, select: { id: true, name: true } });
  return new Map(rows.map((row) => [row.name, row.id]));
}

export async function seedBusinessRecords(prisma: PrismaClient, members: Members) {
  const actor = "user_owner";
  const types = new Map<string, Map<string, string>>();
  for (const company of Object.values(DEMO_COMPANIES)) types.set(company.id, await seedProjectTypes(prisma, company.id));
  await seedProjectTypes(prisma, COMPANY_SUSPENDED);

  /* Clients and contacts ---------------------------------------------------- */

  for (const client of CLIENTS) {
    await prisma.client.upsert({
      where: { id: client.id },
      update: {},
      create: {
        id: client.id,
        companyId: companyOfClient(client.id),
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
        companyId: companyOfClient(contact.clientId),
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
    const companyId = project.companyId;
    const managerMemberId = members.in(companyId, project.manager);
    const projectTypeId = types.get(companyId)!.get(project.type)!;

    await prisma.project.upsert({
      where: { id: project.id },
      // The type is discovery metadata added after these rows first existed
      // (E-05A §62), so a re-seed fills it in rather than leaving it empty.
      update: { projectTypeId },
      create: {
        id: project.id,
        companyId,
        code: project.code,
        name: project.name,
        description: project.description,
        clientId: project.client,
        projectManagerMemberId: managerMemberId,
        status: project.status,
        priority: project.priority,
        projectTypeId,
        startDate: daysFromNow(project.start),
        endDate: daysFromNow(project.end),
        city: project.city,
        country: "Albania",
        createdBy: actor,
      },
    });

    const team = new Set<string>(project.team);
    team.add(project.manager);

    for (const userId of team) {
      const memberId = members.in(companyId, userId);
      await prisma.projectMember.upsert({
        where: { projectId_companyMemberId: { projectId: project.id, companyMemberId: memberId } },
        update: {},
        create: {
          companyId,
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

  /* Tasks ------------------------------------------------------------------- */
  await seedTasks(prisma, members);

  /* Documents --------------------------------------------------------------- */
  await seedDocuments(prisma, members);

  /* Test fixtures ----------------------------------------------------------- */
  await seedFixtureWorksProjects(prisma, members);
  await seedFixtureTenant(prisma, members);

  /* Cover renders (E-05A §8) ------------------------------------------------ */
  await seedProjectCovers(prisma, members);
}

function projectRoleFor(userId: string): string {
  if (/^user_pm(_[b-e])?$/.test(userId)) return "Project Manager";
  switch (userId) {
    case "user_architect":
    case "user_architect_d":
      return "Lead Architect";
    case "user_multicompany":
    case "user_architecture_manager_b":
      return "Architect";
    case "user_engineer":
      return "Site Engineer";
    case "user_engineer_c":
      return "Civil Engineer";
    case "user_qaqc":
    case "user_qaqc_b":
    case "user_qaqc_d":
      return "QA Lead";
    case "user_hse":
    case "user_hse_c":
    case "user_hse_e":
      return "HSE Officer";
    case "user_finance_c":
      return "Project Accountant";
    case "user_sales_e":
      return "Sales Lead";
    case "user_legal_manager_e":
      return "Legal Counsel";
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

  { title: "Finalise facade package", project: PROJECT_IDS.d, assignee: "user_architect", status: "IN_PROGRESS", priority: "HIGH", due: 3, start: -10 },
  { title: "Prepare promenade planning submission", project: PROJECT_IDS.d, assignee: "user_architect", status: "TODO", priority: "CRITICAL", due: -1 },
  { title: "Review marina access study", project: PROJECT_IDS.d, assignee: "user_architect", status: "COMPLETED", priority: "MEDIUM", due: -25 },
  { title: "Confirm client fit-out allowance", project: PROJECT_IDS.d, assignee: "user_owner", status: "TODO", priority: "MEDIUM", due: 18 },
  { title: "Issue concept report", project: PROJECT_IDS.d, assignee: "user_owner", status: "COMPLETED", priority: "LOW", due: -40 },

  { title: "Technical issue response — yard drainage", project: PROJECT_IDS.c, assignee: "user_engineer", status: "BLOCKED", priority: "CRITICAL", due: -15, start: -30, description: "Standing water in the north yard after heavy rain. Awaiting a survey level check." },
  { title: "Reassess structural loading", project: PROJECT_IDS.c, assignee: "user_engineer", status: "IN_PROGRESS", priority: "HIGH", due: 7 },
  { title: "Update permit expiry register", project: PROJECT_IDS.c, assignee: "user_hse", status: "TODO", priority: "HIGH", due: 2 },
  { title: "Inspect stored materials", project: PROJECT_IDS.c, assignee: "user_qaqc", status: "TODO", priority: "MEDIUM", due: 12 },
  { title: "Document hold-point closure", project: PROJECT_IDS.c, assignee: "user_qaqc", status: "COMPLETED", priority: "MEDIUM", due: -30 },
  { title: "Close out demobilisation checklist", project: PROJECT_IDS.c, assignee: "user_engineer", status: "ARCHIVED", priority: "LOW", due: -80 },

  { title: "Prepare feasibility cost plan", project: PROJECT_IDS.e, assignee: "user_finance", status: "TODO", priority: "MEDIUM", due: 21 },
  { title: "Draft villa typology study", project: PROJECT_IDS.e, assignee: "user_owner", status: "TODO", priority: "LOW", due: 28 },

  { title: "Collect final retention certificate", project: PROJECT_IDS.e, assignee: "user_finance", status: "COMPLETED", priority: "MEDIUM", due: -60 },
  { title: "Archive project close-out file", project: PROJECT_IDS.e, assignee: "user_owner", status: "COMPLETED", priority: "LOW", due: -55 },

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
    const companyId = companyFor(task);
    const assigneeMemberId = task.assignee ? members.in(companyId, task.assignee) : null;
    const creator = members.userIn(companyId, "user_pm");

    await prisma.task.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId,
        projectId: task.project,
        title: task.title,
        assigneeMemberId,
        createdByMemberId: members.in(companyId, "user_pm"),
        description: task.description ?? null,
        status: task.status,
        priority: task.priority,
        startDate: task.start === undefined ? null : daysFromNow(task.start),
        dueDate: task.due === null ? null : daysFromNow(task.due),
        completedAt: task.status === "COMPLETED" ? daysFromNow((task.due ?? 0) - 1) : null,
        module: task.source?.module ?? null,
        entityType: task.source?.entityType ?? null,
        entityId: task.source?.entityId ?? null,
        createdBy: creator,
        archivedAt: task.status === "ARCHIVED" ? daysFromNow(-45) : null,
        archivedBy: task.status === "ARCHIVED" ? creator : null,
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
  { name: "Marina Concept.pdf", project: PROJECT_IDS.d, module: "projects" },
  { name: "Facade Study.pdf", project: PROJECT_IDS.d, module: "projects" },
  { name: "Logistics Hub Permit.pdf", project: PROJECT_IDS.c, module: "hse" },
  { name: "Logistics Structural Review.pdf", project: PROJECT_IDS.c, module: "projects" },
  { name: "Adriatic Hotel Feasibility.pdf", project: PROJECT_IDS.e, module: "projects" },
  { name: "Retail Centre Handover.pdf", project: PROJECT_IDS.e, module: "projects" },
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

async function seedDocuments(prisma: PrismaClient, members: Members) {
  let index = 0;

  for (const document of DOCUMENTS) {
    index += 1;
    const companyId = companyFor(document);
    const uploader = members.userIn(companyId, "user_pm");
    // Real bytes, a real key and a real AVAILABLE lifecycle, so the storage
    // path the product depends on is exercised by the demo data rather than
    // stubbed around it (PRD #13 §268, PRD #29 §233).
    await seedStoredDocument(prisma, {
      id: `document_${index.toString().padStart(3, "0")}`,
      companyId,
      name: document.name,
      projectId: document.project ?? null,
      clientId: document.client ?? null,
      module: document.module ?? null,
      entityType: document.project ? "project" : document.client ? "client" : null,
      entityId: document.project ?? document.client ?? null,
      uploadedByMemberId: members.in(companyId, "user_pm"),
      createdBy: uploader,
      archived: document.archived === true,
      archivedAt: document.archived ? daysFromNow(-35) : null,
      archivedBy: document.archived ? uploader : null,
    });
  }
}

/**
 * The fixture tenant's business data — clearly distinct, for isolation tests
 * (PRD #9 §236, E-06 §45). Nobody in the demo group can reach any of it.
 */
async function seedFixtureTenant(prisma: PrismaClient, members: Members) {
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
        companyId: FIXTURE_TENANT,
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
    { id: "project_b_one", code: "B-PRJ-001", name: "Munich Workspace Fitout", client: "client_b_muc", type: "Commercial", city: "Munich" },
    { id: "project_b_two", code: "B-PRJ-002", name: "Isarvorstadt Studio Refit", client: "client_b_alp", type: "Commercial", city: "Munich" },
  ];

  const typesB = await seedProjectTypes(prisma, FIXTURE_TENANT);

  for (const project of projects) {
    await prisma.project.upsert({
      where: { id: project.id },
      update: { projectTypeId: typesB.get(project.type)!, city: project.city },
      create: {
        id: project.id,
        companyId: FIXTURE_TENANT,
        code: project.code,
        name: project.name,
        description: "Fixture tenant record. Must never appear in a demo group result.",
        clientId: project.client,
        projectManagerMemberId: ownerB,
        status: "ACTIVE",
        priority: "MEDIUM",
        projectTypeId: typesB.get(project.type)!,
        startDate: daysFromNow(-40),
        endDate: daysFromNow(160),
        city: project.city,
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
          companyId: FIXTURE_TENANT,
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
        companyId: FIXTURE_TENANT,
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
    { name: "Fixture Tenant Handbook.pdf", project: null },
  ];

  index = 0;
  for (const document of documents) {
    index += 1;
    // The tenant's files are real objects too. An isolation test that proves
    // the demo cannot reach a row with no bytes behind it proves less than it
    // looks (PRD #9 §236, PRD #29 §361).
    await seedStoredDocument(prisma, {
      id: `document_b_${index.toString().padStart(2, "0")}`,
      companyId: FIXTURE_TENANT,
      name: document.name,
      projectId: document.project,
      module: "projects",
      entityType: document.project ? "project" : null,
      entityId: document.project,
      uploadedByMemberId: ownerB,
      createdBy: "user_owner_b",
    });
  }
}

/**
 * Projects the demo no longer shows (E-06 §104): a finished one and an archived
 * one, kept in Fixture Works for the status, exclusion and restore paths.
 */
async function seedFixtureWorksProjects(prisma: PrismaClient, members: Members) {
  const owner = members.get("user_fixture_owner")!;
  const actor = "user_fixture_owner";
  const types = await seedProjectTypes(prisma, FIXTURE_WORKS);

  const client = await prisma.client.upsert({
    where: { id: "client_fixture_works" },
    update: {},
    create: {
      id: "client_fixture_works",
      companyId: FIXTURE_WORKS,
      code: "FX-CLI-001",
      name: "Fixture Client",
      type: "COMPANY",
      status: "ACTIVE",
      country: "Albania",
      normalizedName: normalizeName("Fixture Client"),
      createdBy: actor,
    },
    select: { id: true },
  });

  await prisma.project.upsert({
    where: { id: FIXTURE_PROJECTS.finished },
    update: {},
    create: {
      id: FIXTURE_PROJECTS.finished,
      companyId: FIXTURE_WORKS,
      code: "FX-PRJ-006",
      name: "Completed Retail Center",
      description: "Retail and leisure centre, handed over last quarter.",
      clientId: client.id,
      projectManagerMemberId: owner,
      status: "FINISHED",
      priority: "MEDIUM",
      projectTypeId: types.get("Commercial")!,
      startDate: daysFromNow(-700),
      endDate: daysFromNow(-90),
      city: "Tiranë",
      country: "Albania",
      createdBy: actor,
    },
  });

  // Archived project fixture (PRD #9 §44).
  await prisma.project.upsert({
    where: { id: FIXTURE_PROJECTS.archived },
    update: {},
    create: {
      id: FIXTURE_PROJECTS.archived,
      companyId: FIXTURE_WORKS,
      code: "FX-PRJ-099",
      name: "Archive Test Project",
      description: "Kept archived so exclusion, the archived list and restore can be tested.",
      clientId: client.id,
      projectManagerMemberId: owner,
      status: "ARCHIVED",
      preArchiveStatus: "ACTIVE",
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

  for (const projectId of [FIXTURE_PROJECTS.finished, FIXTURE_PROJECTS.archived]) {
    await prisma.projectMember.upsert({
      where: { projectId_companyMemberId: { projectId, companyMemberId: owner } },
      update: {},
      create: { companyId: FIXTURE_WORKS, projectId, companyMemberId: owner, projectRole: "Project Manager", isPrimary: true, status: "ACTIVE", joinedAt: daysFromNow(-500) },
    });
  }
}
