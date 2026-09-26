import { writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { RoleKey } from "@/config/roles";
import type { UserContext } from "@/lib/context/types";
import { cleanupSessions, COMPANY, loginAs, loginAsMembership, PROJECT, prisma } from "../helpers";
import { actAs } from "./harness/actor";
import { captureCompanyRows, preserveRows, routeHandlers } from "./harness/mutations";
import { paramVariants } from "./harness/params";
import { callRoute, discoverApiRoutes, fillPattern, isPlatformRoute, loadRouteModule, NON_SESSION_ROUTES } from "./harness/routes";

vi.mock("@/lib/context/resolve-user-context", () => import("./harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn }));

/**
 * Private HR, legal and finance values, and the approval doors
 * (AUD-06 §6; RP-11, RP-12).
 *
 * Distinctive values are planted where only the designated grants may read
 * them — an Architect's pay, three documents on the Architect's employee file
 * at three visibilities, a contract's legal and commercial notes — and every
 * GET route in the repository (lists, details, search, exports, reports,
 * dashboards, activity) is read by each actor who must not see them, with the
 * fixtures' own ids in the path and filters. A response that carries a
 * planted value is a leak, whatever the field is called. Who may see what is
 * written here from the grants, independently of the services:
 *
 *   pay (`hr.compensation.view`)            Owner, HR — nobody else, and no
 *                                           self-service exception (PRD #16 §17)
 *   employment contract, EMPLOYEE_AND_HR    Owner, HR, and the employee (E-02 §105)
 *   letter, HR_ONLY                         Owner, HR — not the employee (§106)
 *   note, RESTRICTED_MANAGEMENT             Owner, HR — not the employee, not
 *                                           the CEO without the explicit grant (§107)
 *   legal notes (`legal.confidential_terms.view`)  Owner, Legal (PRD #18 §23)
 *   commercial notes (`legal.commercial.view`)     Owner, Legal, CEO, Finance —
 *                                           not the Project Manager (PRD #18 §22)
 *
 * Each "may" is a positive control on a named surface; each "may not" is the
 * sweep. Approvals (RP-12): deciding needs both the record in sight and the
 * action grant — each missing half is tried alone — and a link from a task or
 * a document to a record never opens the record to somebody its own policy
 * refuses.
 */

const SENTINEL = {
  pay: "918273",
  payNote: "AUD06-SENTINEL-PAY-NOTE",
  contract: "AUD06-SENTINEL-EMPLOYMENT-CONTRACT",
  hrOnly: "AUD06-SENTINEL-HR-ONLY-LETTER",
  restricted: "AUD06-SENTINEL-RESTRICTED-NOTE",
  legal: "AUD06-SENTINEL-LEGAL-NOTES",
  commercial: "AUD06-SENTINEL-COMMERCIAL-NOTES",
} as const;
type Secret = keyof typeof SENTINEL;
/** Pay formatted as a person would read it, too: a CSV or a KPI may group the digits. */
const SPELLINGS: Record<Secret, string[]> = {
  pay: [SENTINEL.pay, "918,273", "918.273", "918 273"],
  payNote: [SENTINEL.payNote],
  contract: [SENTINEL.contract],
  hrOnly: [SENTINEL.hrOnly],
  restricted: [SENTINEL.restricted],
  legal: [SENTINEL.legal],
  commercial: [SENTINEL.commercial],
};

const ALL: Secret[] = ["pay", "payNote", "contract", "hrOnly", "restricted", "legal", "commercial"];

/** Who must see nothing of which secrets: the expectation table above, as data. */
const MUST_NOT_SEE: Partial<Record<RoleKey, Secret[]>> = {
  CEO: ["pay", "payNote", "contract", "hrOnly", "restricted", "legal"],
  FINANCE: ["pay", "payNote", "contract", "hrOnly", "restricted", "legal"],
  LEGAL: ["pay", "payNote", "contract", "hrOnly", "restricted"],
  PROJECT_MANAGER: ALL,
  ENGINEER: ALL,
  ARCHITECT: ["pay", "payNote", "hrOnly", "restricted", "legal", "commercial"],
  VIEWER: ALL,
  GROUP_IT: ALL,
  SALES: ["pay", "payNote", "contract", "hrOnly", "restricted", "legal"],
};

const FIX = {
  documents: { contract: "aud06_sentinel_doc_contract", hrOnly: "aud06_sentinel_doc_hr_only", restricted: "aud06_sentinel_doc_restricted" },
  links: { contract: "aud06_sentinel_link_contract", hrOnly: "aud06_sentinel_link_hr_only", restricted: "aud06_sentinel_link_restricted" },
  versions: { contract: "aud06_sentinel_ver_contract", hrOnly: "aud06_sentinel_ver_hr_only", restricted: "aud06_sentinel_ver_restricted" },
  contractId: "contract_001",
  linkedTask: "aud06_linked_task",
  probe: { userId: "user_aud06_probe_pm", memberId: "member_aud06_probe_pm", projectId: "project_aud06_probe" },
} as const;

const actors = new Map<RoleKey, UserContext>();
let employment: { id: string; personProfileId: string };
/** The seeded pay and contract rows the fixtures overwrite, put back exactly afterwards. */
const restores: Array<() => Promise<void>> = [];
/**
 * Rows a read leaves behind by design: the audit line an export writes
 * (PRD #28 §130), and a company's productivity defaults, created the first
 * time a group-wide read asks for them. Taken away again afterwards.
 */
const SIDE_EFFECT_TABLES = ["audit_events", "productivity_settings"] as const;
const existing = new Map<string, Set<string>>();
const report: Record<string, unknown> = {};

async function removeFixtures() {
  await prisma.task.deleteMany({ where: { id: FIX.linkedTask } });
  await prisma.employeeDocumentLink.deleteMany({ where: { id: { in: Object.values(FIX.links) } } });
  await prisma.document.updateMany({ where: { id: { in: Object.values(FIX.documents) } }, data: { currentVersionId: null } });
  await prisma.documentVersion.deleteMany({ where: { id: { in: Object.values(FIX.versions) } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: Object.values(FIX.documents) } } });
  await prisma.document.deleteMany({ where: { id: { in: Object.values(FIX.documents) } } });
  await prisma.session.deleteMany({ where: { userId: FIX.probe.userId } });
  await prisma.project.deleteMany({ where: { id: FIX.probe.projectId } });
  await prisma.companyMember.deleteMany({ where: { id: FIX.probe.memberId } });
  await prisma.user.deleteMany({ where: { id: FIX.probe.userId } });
}

beforeAll(async () => {
  await removeFixtures();
  for (const table of SIDE_EFFECT_TABLES) existing.set(table, new Set((await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "${table}"`)).map((row) => row.id)));
  restores.push(await preserveRows("compensations", COMPANY.a), await preserveRows("contracts", COMPANY.a));
  employment = await prisma.employeeProfile.findFirstOrThrow({ where: { companyId: COMPANY.a, companyMember: { user: { email: "architect@nesto.test" } } }, select: { id: true, personProfileId: true } });
  const storage = await prisma.document.findFirstOrThrow({ where: { companyId: COMPANY.a, storageStatus: "AVAILABLE", storageBucket: { not: null } }, select: { storageBucket: true, storageProvider: true } });

  // One pay record per employment: the Architect's own is overwritten for the run.
  const pay = await prisma.compensation.findFirst({ where: { employeeProfileId: employment.id }, select: { id: true } });
  if (pay) await prisma.compensation.update({ where: { id: pay.id }, data: { baseAmount: "918273.64", notes: SENTINEL.payNote } });
  else await prisma.compensation.create({ data: { companyId: COMPANY.a, employeeProfileId: employment.id, currency: "EUR", payType: "SALARY", baseAmount: "918273.64", effectiveFrom: new Date("2026-01-01T00:00:00Z"), notes: SENTINEL.payNote, createdByMemberId: "member_hr" } });
  const files = [
    ["contract", "EMPLOYMENT_CONTRACT", "EMPLOYEE_AND_HR", SENTINEL.contract],
    ["hrOnly", "EMPLOYMENT_LETTER", "HR_ONLY", SENTINEL.hrOnly],
    ["restricted", "EMPLOYMENT_LETTER", "RESTRICTED_MANAGEMENT", SENTINEL.restricted],
  ] as const;
  for (const [key, category, visibility, title] of files) {
    const storageKey = `companies/${COMPANY.a}/documents/${FIX.documents[key]}/aud06.pdf`;
    await prisma.document.create({
      data: {
        id: FIX.documents[key], companyId: COMPANY.a, name: `${title}.pdf`, fileName: `${title}.pdf`, originalFileName: `${title}.pdf`, storageKey, mimeType: "application/pdf", sizeBytes: 10,
        module: "hr", entityType: "employee", entityId: employment.id, status: "ACTIVE", createdBy: "user_hr", uploadedByMemberId: "member_hr",
        storageProvider: storage.storageProvider, storageBucket: storage.storageBucket, storageStatus: "AVAILABLE", scanStatus: "NOT_REQUIRED", previewStatus: "READY", previewMimeType: "application/pdf", latestVersionNumber: 1,
      },
    });
    await prisma.documentVersion.create({
      data: { id: FIX.versions[key], companyId: COMPANY.a, documentId: FIX.documents[key], versionNumber: 1, storageProvider: storage.storageProvider, storageBucket: storage.storageBucket, storageKey, originalFileName: `${title}.pdf`, fileName: `${title}.pdf`, extension: "pdf", mimeTypeDeclared: "application/pdf", mimeTypeDetected: "application/pdf", sizeBytes: 10, storageStatus: "AVAILABLE", scanStatus: "NOT_REQUIRED", previewStatus: "READY", uploadedByMemberId: "member_hr" },
    });
    await prisma.document.update({ where: { id: FIX.documents[key] }, data: { currentVersionId: FIX.versions[key] } });
    await prisma.employeeDocumentLink.create({ data: { id: FIX.links[key], companyId: COMPANY.a, employeeProfileId: employment.id, documentId: FIX.documents[key], category, title, visibility, createdByMemberId: "member_hr" } });
  }

  await prisma.$executeRaw`UPDATE "contracts" SET "legalNotes" = ${SENTINEL.legal}, "commercialNotes" = ${SENTINEL.commercial} WHERE "id" = ${FIX.contractId}`;

  for (const role of ["OWNER", "HR", "LEGAL", "CEO", "FINANCE", "PROJECT_MANAGER", "ENGINEER", "ARCHITECT", "VIEWER", "GROUP_IT", "SALES", "PROCUREMENT"] as RoleKey[]) {
    const context = await loginAs(role);
    expect(context.companyId, role).toBe(COMPANY.a);
    actors.set(role, context);
  }
}, 120_000);

afterAll(async () => {
  actAs(null);
  if (process.env.SECURITY_REPORT) writeFileSync(process.env.SECURITY_REPORT, JSON.stringify(report, null, 2));
  await cleanupSessions();
  await removeFixtures();
  // A seeded pay record is put back; one the run had to create (none was seeded) still carries the note, and goes.
  for (const restore of restores) await restore();
  await prisma.compensation.deleteMany({ where: { notes: SENTINEL.payNote } });
  for (const table of SIDE_EFFECT_TABLES) {
    const known = existing.get(table);
    if (!known) continue;
    const now = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "${table}"`)).map((row) => row.id).filter((id) => !known.has(id));
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "id" = ANY($1::text[])`, now);
  }
  await prisma.$disconnect();
});

const actor = (role: RoleKey) => actors.get(role)!;
const textOf = (body: unknown) => (typeof body === "string" ? body : JSON.stringify(body ?? ""));
const secretsIn = (body: unknown, secrets: Secret[]) => secrets.filter((secret) => SPELLINGS[secret].some((spelling) => textOf(body).includes(spelling)));

/** A GET as `role`, by route pattern and segments, with an optional query. */
async function get(role: RoleKey, pattern: string, params: Record<string, string> = {}, query = "") {
  const handlers = await routeHandlers(pattern);
  actAs(actor(role));
  return callRoute(handlers.GET!, "GET", `${fillPattern(pattern, params)}${query ? `?${query}` : ""}`, params);
}

/** The fixture a path segment names, where there is one; the company's first row otherwise. */
function fixtureParams(pattern: string): Record<string, string> {
  const params: Record<string, string> = { employeeId: employment.id, personId: employment.personProfileId, contractId: FIX.contractId };
  if (/\/hr\/employees\/\[employeeId\]\/documents\/\[linkId\]/.test(pattern)) params.linkId = FIX.links.contract;
  if (/^\/api\/documents\/\[documentId\]/.test(pattern)) params.documentId = FIX.documents.contract;
  return params;
}

/** Extra reads a route only answers with the right selector. */
const SELECTORS: Record<string, string[]> = {
  "/api/hr/reports": ["headcount", "leave", "attendance", "compensation", "ending-soon"].map((report) => `report=${report}`),
  "/api/hr/export": ["employees", "leave", "attendance"].map((type) => `type=${type}`),
};

describe("private values stay with their grants across every read (RP-11)", () => {
  it("shows each designated reader what is theirs (positive controls)", async () => {
    const employee = { employeeId: employment.id };
    const contract = { contractId: FIX.contractId };
    const expectations: [RoleKey, string, Record<string, string>, string, Secret[]][] = [
      ["OWNER", "/api/hr/employees/[employeeId]/compensation", employee, "", ["pay", "payNote"]],
      ["HR", "/api/hr/employees/[employeeId]/compensation", employee, "", ["pay", "payNote"]],
      ["HR", "/api/hr/reports", {}, "report=compensation", ["pay"]],
      ["OWNER", "/api/hr/employees/[employeeId]/documents", employee, "", ["contract", "hrOnly", "restricted"]],
      ["HR", "/api/hr/employees/[employeeId]/documents", employee, "", ["contract", "hrOnly", "restricted"]],
      ["ARCHITECT", "/api/hr/employees/[employeeId]/documents", employee, "", ["contract"]],
      ["OWNER", "/api/contracts/[contractId]", contract, "", ["legal", "commercial"]],
      ["LEGAL", "/api/contracts/[contractId]", contract, "", ["legal", "commercial"]],
      ["CEO", "/api/contracts/[contractId]", contract, "", ["commercial"]],
      ["FINANCE", "/api/contracts/[contractId]", contract, "", ["commercial"]],
    ];
    const missing: string[] = [];
    for (const [role, pattern, params, query, secrets] of expectations) {
      const path = `${pattern}?${query}`;
      const outcome = await get(role, pattern, params, query);
      const seen = secretsIn(outcome.body, secrets);
      if (outcome.status !== 200 || seen.length !== secrets.length) missing.push(`${role} ${path} → ${outcome.status}, saw ${seen.join(",") || "nothing"} of ${secrets.join(",")}`);
    }
    expect(missing).toEqual([]);
  });

  it("gives the designated readers a download link to the files they may open, and nobody else", async () => {
    const download = await routeHandlers("/api/documents/[documentId]/download");
    const preview = await routeHandlers("/api/documents/[documentId]/preview");
    const allowed: [RoleKey, keyof typeof FIX.documents][] = [["HR", "contract"], ["HR", "hrOnly"], ["HR", "restricted"], ["OWNER", "restricted"], ["ARCHITECT", "contract"]];
    const denied: [RoleKey, keyof typeof FIX.documents][] = [
      ...(["CEO", "FINANCE", "LEGAL", "PROJECT_MANAGER", "ENGINEER", "VIEWER", "GROUP_IT"] as RoleKey[]).flatMap((role) => (["contract", "hrOnly", "restricted"] as const).map((key): [RoleKey, keyof typeof FIX.documents] => [role, key])),
      ["ARCHITECT", "hrOnly"],
      ["ARCHITECT", "restricted"],
    ];
    const wrong: string[] = [];
    for (const [role, key] of allowed) {
      actAs(actor(role));
      const id = FIX.documents[key];
      const outcome = await callRoute(download.POST!, "POST", `/api/documents/${id}/download`, { documentId: id });
      if (outcome.status !== 200) wrong.push(`${role} may download ${key}: ${outcome.status} ${textOf(outcome.body).slice(0, 160)}`);
    }
    for (const [role, key] of denied) {
      actAs(actor(role));
      const id = FIX.documents[key];
      for (const [name, handlers] of [["download", download], ["preview", preview]] as const) {
        const outcome = await callRoute(handlers.POST!, "POST", `/api/documents/${id}/${name}`, { documentId: id });
        if (outcome.status !== 404 && outcome.status !== 403) wrong.push(`${role} ${name} ${key}: ${outcome.status}`);
        if (secretsIn(outcome.body, ALL).length > 0) wrong.push(`${role} ${name} ${key}: refusal names the file`);
      }
    }
    expect(wrong).toEqual([]);
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: Object.values(FIX.documents) } } });
  });

  /** Every GET route, read by each of `readers` with the fixtures in its path and filters; the secrets each response carries. */
  async function sweepReads(readers: [RoleKey, Secret[]][]): Promise<{ calls: number; statuses: Record<string, number>; found: string[]; seen: Set<Secret> }> {
    const result = { calls: 0, statuses: {} as Record<string, number>, found: [] as string[], seen: new Set<Secret>() };
    const routes = discoverApiRoutes().filter((route) => !NON_SESSION_ROUTES.has(route.pattern) && !isPlatformRoute(route.pattern));
    const filters = `q=AUD06-SENT&search=AUD06-SENT&employeeId=${employment.id}&personId=${employment.personProfileId}&contractId=${FIX.contractId}&includeArchived=true`;
    for (const route of routes) {
      const handlers = await loadRouteModule(route);
      if (!handlers.GET) continue;
      const [variant] = await paramVariants(route.pattern, route.params, { companyId: COMPANY.a, approvals: [], sessionId: null });
      if (route.params.length > 0 && !variant) continue;
      const params = { ...(variant?.params ?? {}), ...Object.fromEntries(Object.entries(fixtureParams(route.pattern)).filter(([name]) => route.params.includes(name))) };
      const base = fillPattern(route.pattern, params);
      const paths = [base, `${base}?${filters}`, ...(SELECTORS[route.pattern] ?? []).map((query) => `${base}?${query}`)];
      for (const [role, secrets] of readers) {
        actAs(actor(role));
        for (const path of paths) {
          const outcome = await callRoute(handlers.GET, "GET", path, params);
          result.calls += 1;
          result.statuses[outcome.status] = (result.statuses[outcome.status] ?? 0) + 1;
          const seen = secretsIn(outcome.body, secrets);
          seen.forEach((secret) => result.seen.add(secret));
          if (seen.length > 0) result.found.push(`${role} GET ${path} → ${outcome.status} carries ${seen.join(", ")}`);
        }
      }
    }
    return result;
  }

  it("finds every planted value when the reader may see it: the sweep reaches the surfaces (detector control)", async () => {
    const owner = await sweepReads([["OWNER", ALL]]);
    report.ownerSweep = { calls: owner.calls, found: owner.found.length };
    expect([...owner.seen].sort()).toEqual([...ALL].sort());
  }, 900_000);

  it("carries none of them to anybody else, on any GET route, list, search, export or report", async () => {
    const result = await sweepReads(Object.entries(MUST_NOT_SEE) as [RoleKey, Secret[]][]);
    report.privateSweep = { calls: result.calls, statuses: result.statuses, leaks: result.found };
    expect(result.calls).toBeGreaterThan(3000);
    expect(result.found).toEqual([]);
  }, 900_000);

  it("keeps pay out of the HR export even for HR, as designed (PRD #16 §146)", async () => {
    for (const type of ["employees", "leave", "attendance"]) {
      const outcome = await get("HR", "/api/hr/export", {}, `type=${type}`);
      expect(outcome.status).toBe(200);
      expect(secretsIn(outcome.body, ["pay", "payNote"])).toEqual([]);
    }
    await prisma.auditEvent.deleteMany({ where: { companyId: COMPANY.a, actorUserId: actor("HR").userId, actionKey: { contains: "EXPORT" }, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } });
  });
});

/* -------------------------------------------------------------------------- */
/* Approvals and links (RP-12)                                                 */
/* -------------------------------------------------------------------------- */

describe("a decision needs the record in sight and the grant (RP-12)", () => {
  let probe: UserContext;

  beforeAll(async () => {
    // A Project Manager of another project: `timesheet.approve` held (timesheets A/P), the Engineer's project out of sight.
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "PROJECT_MANAGER" }, select: { id: true } });
    await prisma.user.create({ data: { id: FIX.probe.userId, username: "aud06-probe-pm", firstName: "Probe", lastName: "Approver", passwordHash: "not-a-login" } });
    await prisma.companyMember.create({ data: { id: FIX.probe.memberId, companyId: COMPANY.a, userId: FIX.probe.userId, roleId: role.id, jobTitle: "Project Manager", joinedAt: new Date() } });
    await prisma.project.create({ data: { id: FIX.probe.projectId, companyId: COMPANY.a, code: "AUD06-PROBE", name: "AUD-06 probe site", status: "ACTIVE", projectManagerMemberId: FIX.probe.memberId, createdBy: FIX.probe.userId, members: { create: { companyId: COMPANY.a, companyMemberId: FIX.probe.memberId, projectRole: "Project Manager", isPrimary: true } } } });
    probe = await loginAsMembership(FIX.probe.memberId);
  }, 60_000);

  async function decide(context: UserContext, providerKey: string, approvalId: string, verb: "approve" | "reject" | "return") {
    const handlers = await routeHandlers(`/api/approvals/[providerKey]/[approvalId]/${verb}`);
    actAs(context);
    return callRoute(handlers.POST!, "POST", `/api/approvals/${providerKey}/${approvalId}/${verb}`, { providerKey, approvalId }, { note: "AUD-06 forged decision", reason: "AUD-06 forged decision" });
  }

  it("refuses a grant without sight, and sight without a grant, then lets the approver decide", async () => {
    // The Engineer's submitted week, waiting for their Project Manager (seeded).
    const approval = await prisma.timesheetApproval.findUniqueOrThrow({ where: { id: "timesheet_approval_engineer_submitted" }, select: { id: true, recordId: true, status: true } });
    expect(approval.status).toBe("PENDING");
    const pending = { id: approval.id, timesheetId: approval.recordId };
    const restore = await captureCompanyRows(COMPANY.a);
    try {
      expect(probe.permissions).toContain("timesheet.approve");
      const before = await prisma.timesheet.findUniqueOrThrow({ where: { id: pending.timesheetId } });
      const refusals: string[] = [];
      // The grant, not the sight: the probe approver; nor the sight without the grant: the Engineer's own week, and the Viewer.
      for (const [who, context] of [["probe PM", probe], ["engineer", actor("ENGINEER")], ["viewer", actor("VIEWER")]] as const) {
        for (const verb of ["approve", "reject", "return"] as const) {
          const outcome = await decide(context, "timesheets", pending.id, verb);
          if (outcome.status !== 404 && outcome.status !== 403) refusals.push(`${who} ${verb}: ${outcome.status} ${textOf(outcome.body).slice(0, 160)}`);
        }
      }
      expect(refusals).toEqual([]);
      expect(await prisma.timesheet.findUniqueOrThrow({ where: { id: pending.timesheetId } })).toEqual(before);

      // Positive control: the Engineer's own Project Manager, who has both.
      const decided = await decide(actor("PROJECT_MANAGER"), "timesheets", pending.id, "approve");
      expect(decided.status, textOf(decided.body)).toBeLessThan(300);
      expect((await prisma.timesheet.findUniqueOrThrow({ where: { id: pending.timesheetId } })).status).toBe("APPROVED");
    } finally {
      actAs(null);
      expect(await restore()).toEqual([]);
    }
  }, 120_000);

  it("refuses a reader of HR without the leave decision, and the leave's own requester", async () => {
    const pending = await prisma.leaveRequest.findFirstOrThrow({ where: { companyId: COMPANY.a, status: "PENDING", companyMemberId: actor("ENGINEER").membershipId }, select: { id: true } });
    const restore = await captureCompanyRows(COMPANY.a);
    try {
      // Sight without the grant: the CEO reads HR company-wide (hr V/C) but holds no `hr.leave.approve`.
      const detail = await get("CEO", "/api/approvals/[providerKey]/[approvalId]", { providerKey: "hr", approvalId: pending.id });
      expect(detail.status).toBe(200);
      const before = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: pending.id } });
      for (const [who, context] of [["ceo", actor("CEO")], ["engineer", actor("ENGINEER")], ["finance", actor("FINANCE")]] as const) {
        const outcome = await decide(context, "hr", pending.id, "approve");
        expect([403, 404], `${who}: ${outcome.status} ${textOf(outcome.body)}`).toContain(outcome.status);
      }
      expect(await prisma.leaveRequest.findUniqueOrThrow({ where: { id: pending.id } })).toEqual(before);
      // Positive control: HR decides.
      const decided = await decide(actor("HR"), "hr", pending.id, "approve");
      expect(decided.status, textOf(decided.body)).toBeLessThan(300);
      expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("APPROVED");
    } finally {
      actAs(null);
      expect(await restore()).toEqual([]);
    }
  }, 120_000);
});

describe("a link never opens what the linked record's policy refuses (RP-12)", () => {
  it("shows the Engineer a task raised from a contract obligation without the contract", async () => {
    const source = await prisma.task.findUniqueOrThrow({ where: { id: "task_contract_001" }, select: { module: true, entityType: true, entityId: true } });
    const obligation = await prisma.contractObligation.findUniqueOrThrow({ where: { id: source.entityId! }, select: { title: true, contract: { select: { contractNumber: true, title: true } } } });
    await prisma.task.create({ data: { id: FIX.linkedTask, companyId: COMPANY.a, projectId: PROJECT.a, title: "AUD06 task raised from an obligation", status: "TODO", createdByMemberId: "member_legal", createdBy: "user_legal", module: source.module, entityType: source.entityType, entityId: source.entityId } });
    const names = [obligation.title, obligation.contract.contractNumber, obligation.contract.title];

    // The Engineer reaches the task through the project (tasks C/AS) and has no Contracts module.
    const engineer = await get("ENGINEER", "/api/tasks/[taskId]", { taskId: FIX.linkedTask });
    expect(engineer.status).toBe(200);
    expect((engineer.body as { data: { parent: unknown } }).data.parent).toBeNull();
    expect(names.filter((name) => textOf(engineer.body).includes(name))).toEqual([]);

    // Positive control: Legal, who can open the obligation, sees where the task came from.
    const legal = await get("LEGAL", "/api/tasks/[taskId]", { taskId: FIX.linkedTask });
    expect(legal.status).toBe(200);
    expect((legal.body as { data: { parent: { label: string } | null } }).data.parent?.label).toBeTruthy();
  });

  it("refuses the files of a record the reader cannot open, however they are reached", async () => {
    // A contract's file, and a purchase order's quote: the Engineer has no Contracts and is denied purchase orders.
    const files: [string, RoleKey][] = [["document_contract_01", "LEGAL"], ["document_po_142_quote", "PROCUREMENT"]];
    const download = await routeHandlers("/api/documents/[documentId]/download");
    const wrong: string[] = [];
    for (const [documentId, owner] of files) {
      const name = (await prisma.document.findUniqueOrThrow({ where: { id: documentId }, select: { name: true } })).name;
      for (const role of ["ENGINEER", "VIEWER"] as RoleKey[]) {
        const detail = await get(role, "/api/documents/[documentId]", { documentId });
        actAs(actor(role));
        const link = await callRoute(download.POST!, "POST", `/api/documents/${documentId}/download`, { documentId });
        if (detail.status !== 404 || link.status !== 404) wrong.push(`${role} ${documentId}: detail ${detail.status}, download ${link.status}`);
        if (textOf(detail.body).includes(name) || textOf(link.body).includes(name)) wrong.push(`${role} ${documentId}: refusal names the file`);
      }
      // Positive control: the record's own reader downloads it.
      actAs(actor(owner));
      const allowed = await callRoute(download.POST!, "POST", `/api/documents/${documentId}/download`, { documentId });
      if (allowed.status !== 200) wrong.push(`${owner} ${documentId}: ${allowed.status} ${textOf(allowed.body).slice(0, 160)}`);
    }
    expect(wrong).toEqual([]);
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: files.map(([id]) => id) }, actionKey: "DOCUMENT_DOWNLOAD_GRANTED", createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } });
  });
});
