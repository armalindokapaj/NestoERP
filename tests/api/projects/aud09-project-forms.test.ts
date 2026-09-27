import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { projectFormOptions } from "@/lib/modules/projects/project.options";
import { createProjectSchema } from "@/lib/modules/projects/project.schema";
import * as projects from "@/lib/modules/projects/project.service";
import { cleanupSessions, COMPANY, loginAs, prisma, projectTypeId } from "../../helpers";
import { actAs } from "../../security/harness/actor";

/**
 * AUD-09 — the project form's payload contract, over the route and the server
 * action, against the real database (§3, §4, §5; FV-04, FV-05, FV-07, FV-09,
 * FV-10, FV-11, FV-22). The `projects` row is the oracle.
 */

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { PATCH } = await import("@/app/api/projects/[projectId]/route");
const actions = await import("@/lib/actions/projects");

const PREFIX = "AUD09B-";
const created: string[] = [];
const restoreMembers: string[] = [];
let residential = "";

beforeAll(async () => {
  residential = await projectTypeId();
});

afterEach(async () => {
  actAs(null);
  for (const id of restoreMembers.splice(0)) await prisma.companyMember.update({ where: { id }, data: { status: "ACTIVE" } });
  if (created.length === 0) return;
  await prisma.activity.deleteMany({ where: { entityId: { in: created } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: created } } });
  await prisma.project.deleteMany({ where: { id: { in: created } } });
  created.length = 0;
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function patch(projectId: string, body: unknown) {
  const response = await PATCH(
    new Request(`http://localhost/api/projects/${projectId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ projectId }) },
  );
  return { status: response.status, body: (await response.json()) as Json };
}

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const unique = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const row = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });

async function fullProject(owner: UserContext, overrides: Record<string, unknown> = {}) {
  const project = await projects.createProject(
    owner,
    createProjectSchema.parse({
      code: `${PREFIX}${unique()}`,
      name: "AUD-09 full project",
      description: "Six storeys over a podium",
      clientId: "client_acme",
      projectManagerMemberId: "member_pm",
      priority: "HIGH",
      projectTypeId: residential,
      startDate: "2031-04-01",
      endDate: "2032-06-30",
      address: "Rruga Kavajës 10",
      city: "Tirana",
      country: "Albania",
      builtArea: "12500.50",
      isKeyProject: "YES",
      status: "PENDING",
      ...overrides,
    }),
  );
  created.push(project.id);
  return project;
}

describe("partial updates (FV-05)", () => {
  it("a PATCH naming only the city keeps every other field", async () => {
    const owner = await loginAs("OWNER");
    const project = await fullProject(owner);
    actAs(owner);

    expect((await patch(project.id, { city: "Durrës" })).status).toBe(200);
    // Before AUD-09 this erased the description, client, manager, priority,
    // type, dates, address, country and built area.
    const saved = await row(project.id);
    expect(saved).toMatchObject({
      city: "Durrës",
      description: "Six storeys over a podium",
      clientId: "client_acme",
      projectManagerMemberId: "member_pm",
      priority: "HIGH",
      projectTypeId: residential,
      startDate: new Date("2031-04-01T00:00:00.000Z"),
      endDate: new Date("2032-06-30T00:00:00.000Z"),
      address: "Rruga Kavajës 10",
      country: "Albania",
      isKeyProject: true,
      status: "PENDING",
    });
    expect(saved.builtArea?.toFixed(2)).toBe("12500.50");
  });

  it("null and empty clear on purpose; refusals name their field and change nothing", async () => {
    const owner = await loginAs("OWNER");
    const project = await fullProject(owner);
    actAs(owner);

    expect((await patch(project.id, { description: "", clientId: null, builtArea: null })).status).toBe(200);
    expect(await row(project.id)).toMatchObject({ description: null, clientId: null, builtArea: null, city: "Tirana", projectManagerMemberId: "member_pm" });

    for (const [body, field] of [
      [{ endDate: "2031-02-30" }, "endDate"],
      [{ startDate: "01/04/2031" }, "startDate"],
      [{ builtArea: "abc" }, "builtArea"],
      [{ builtArea: -5 }, "builtArea"],
      [{ priority: "URGENT" }, "priority"],
      [{ name: "x" }, "name"],
      [{ startDate: "2032-01-01", endDate: "2031-01-01" }, "endDate"],
    ] as const) {
      const refused = await patch(project.id, body);
      expect(refused.status, JSON.stringify(body)).toBe(422);
      expect(refused.body.error.details, JSON.stringify(body)).toHaveProperty(field);
    }
    expect(await row(project.id)).toMatchObject({ endDate: new Date("2032-06-30T00:00:00.000Z"), priority: "HIGH" });
  });

  it("an end date before the saved start is refused on the end date, across transports", async () => {
    const owner = await loginAs("OWNER");
    const project = await fullProject(owner);
    actAs(owner);

    const viaRoute = await patch(project.id, { endDate: "2031-03-31" });
    expect(viaRoute.status).toBe(422);
    expect(viaRoute.body.error.details).toEqual({ endDate: ["End date must be on or after the start date."] });

    const viaAction = await actions.updateProjectAction(project.id, form({ endDate: "2031-03-31" }));
    expect(viaAction).toMatchObject({ ok: false, code: "VALIDATION_ERROR", fieldErrors: { endDate: ["End date must be on or after the start date."] } });
    expect((await row(project.id)).endDate).toEqual(new Date("2032-06-30T00:00:00.000Z"));

    // Positive control: the start date itself is allowed.
    expect((await patch(project.id, { endDate: "2031-04-01" })).status).toBe(200);
    expect((await row(project.id)).endDate).toEqual(new Date("2031-04-01T00:00:00.000Z"));
  });
});

describe("relations (FV-09, FV-10, FV-11)", () => {
  it("keeps an inactive manager on an untouched save and refuses one as a new choice", async () => {
    const owner = await loginAs("OWNER");
    const project = await fullProject(owner, { projectManagerMemberId: "member_architect" });
    restoreMembers.push("member_architect");
    await prisma.companyMember.update({ where: { id: "member_architect" }, data: { status: "INACTIVE" } });
    actAs(owner);

    // The picker still shows the saved manager, marked, so the form sends it back.
    const options = await projectFormOptions(owner, { managerMemberId: "member_architect" });
    expect(options.managers).toContainEqual({ value: "member_architect", label: expect.stringContaining("inactive") });
    // …but does not offer another inactive member.
    const fresh = await projectFormOptions(owner);
    expect(fresh.managers.map((option) => option.value)).not.toContain("member_architect");

    // Before AUD-09 an untouched save was refused ("not available").
    const kept = await actions.updateProjectAction(project.id, form({ name: "AUD-09 kept manager", projectManagerMemberId: "member_architect" }));
    expect(kept).toMatchObject({ ok: true });
    expect(await row(project.id)).toMatchObject({ name: "AUD-09 kept manager", projectManagerMemberId: "member_architect" });

    const other = await fullProject(owner);
    const refused = await actions.updateProjectAction(other.id, form({ projectManagerMemberId: "member_architect" }));
    expect(refused).toMatchObject({ ok: false, code: "VALIDATION_ERROR", fieldErrors: { projectManagerMemberId: [expect.any(String)] } });
    expect((await row(other.id)).projectManagerMemberId).toBe("member_pm");
  });

  it("refuses forged foreign client, manager and type ids on their fields", async () => {
    const owner = await loginAs("OWNER");
    const project = await fullProject(owner);
    actAs(owner);
    const foreignClient = await prisma.client.findFirstOrThrow({ where: { companyId: COMPANY.b }, select: { id: true } });
    const foreignType = await projectTypeId(COMPANY.b);

    for (const [body, field] of [
      [{ clientId: foreignClient.id }, "clientId"],
      [{ projectManagerMemberId: "member_owner__b" }, "projectManagerMemberId"],
      [{ projectTypeId: foreignType }, "projectTypeId"],
    ] as const) {
      const refused = await actions.updateProjectAction(project.id, form(body));
      expect(refused, JSON.stringify(body)).toMatchObject({ ok: false, fieldErrors: { [field]: [expect.any(String)] } });
    }
    expect(await row(project.id)).toMatchObject({ clientId: "client_acme", projectManagerMemberId: "member_pm", projectTypeId: residential });
  });

  it("a taken project code is a business error on the code field", async () => {
    const owner = await loginAs("OWNER");
    const first = await fullProject(owner);
    const second = await fullProject(owner);
    actAs(owner);
    const refused = await actions.updateProjectAction(second.id, form({ code: first.code }));
    expect(refused).toMatchObject({ ok: false, code: "PROJECT_CODE_TAKEN", fieldErrors: { code: [expect.stringContaining("already exists")] } });
    expect((await row(second.id)).code).toBe(second.code);
  });
});
