import { Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { StaleWorkspaceError } from "@/lib/context/tab-workspace";
import { decimalRule } from "@/lib/forms/decimal";
import { errorCategory } from "@/lib/forms/errors";
import { decimalText, requiredText } from "@/lib/modules/shared/fields";
import { cleanupSessions, COMPANY, loginAs, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";

/**
 * The server error envelope (AUD-09 §3, FV-04, FV-13).
 *
 * The route envelope and the server-action result are drawn from one reading
 * of a failure (`lib/actions/result.ts`), so the same thrown error answers
 * the same code, category and field errors on both transports. Real database
 * violations are produced against the real table (owned `aud09a_` rows), and
 * the tasks module's real route and real action are compared on the same
 * invalid input. Nothing internal — SQL, constraint names, Prisma codes,
 * stacks — ever reaches a body.
 */

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`redirect ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
  notFound: () => {
    throw Object.assign(new Error("notFound"), { digest: "NEXT_NOT_FOUND" });
  },
}));

const { apiOk, withContext, readJson } = await import("@/lib/api/respond");
const { actionFailure, describeFailure, validationFailure, fieldLabel } = await import("@/lib/actions/result");
const taskRoute = await import("@/app/api/tasks/route");
const taskActions = await import("@/lib/actions/tasks");

const PREFIX = "aud09a_";
const TYPE_NAME = `${PREFIX}type`;
/** Words that would mean the database or the runtime spoke to the person. */
const LEAKS = [/unique constraint/i, /prisma/i, /project_types/i, /P20\d\d/, /\bINSERT\b/i, /\bSELECT\b/i, /duplicate key/i, /\bat .+\.ts:\d+/, /stack/i, /23505/];

let pm: UserContext;

beforeAll(async () => {
  pm = await loginAs("PROJECT_MANAGER");
});

afterEach(() => actAs(null));

afterAll(async () => {
  await prisma.projectType.deleteMany({ where: { name: { startsWith: PREFIX } } });
  const tasks = await prisma.task.findMany({ where: { title: { startsWith: PREFIX } }, select: { id: true } });
  const ids = tasks.map((task) => task.id);
  if (ids.length) {
    await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
    const threads = await prisma.collaborationThread.findMany({ where: { parentType: "task", parentId: { in: ids } }, select: { id: true } });
    await prisma.subscription.deleteMany({ where: { threadId: { in: threads.map((row) => row.id) } } });
    await prisma.collaborationThread.deleteMany({ where: { id: { in: threads.map((row) => row.id) } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.task.deleteMany({ where: { id: { in: ids } } });
  }
  await cleanupSessions();
  await prisma.$disconnect();
});

type Envelope = { status: number; body: { error?: Record<string, unknown> } & Record<string, unknown>; text: string };

async function answer(response: Response): Promise<Envelope> {
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {}, text };
}

/** Runs a handler through the real guard sequence as the project manager. */
async function throughRoute(handler: () => Promise<Response>): Promise<Envelope> {
  actAs(pm);
  return answer(await withContext(async () => handler()));
}

function noLeaks(text: string) {
  for (const pattern of LEAKS) expect(text, String(pattern)).not.toMatch(pattern);
}

async function captured(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error("expected the work to fail");
}

describe("a database uniqueness violation is a safe business conflict naming the field", () => {
  it("answers 409 UNIQUE_VIOLATION with the field, after a first create that succeeds (P2002)", async () => {
    const create = () => prisma.projectType.create({ data: { companyId: COMPANY.a, name: TYPE_NAME } });

    // Positive control: the first one is created.
    const first = await throughRoute(async () => apiOk({ data: await create() }, { status: 201 }));
    expect(first.status).toBe(201);

    const second = await throughRoute(async () => apiOk({ data: await create() }, { status: 201 }));
    expect(second.status).toBe(409);
    expect(second.body.error).toEqual({
      code: "CONFLICT",
      message: "Another record already uses this name. Choose a different name.",
      requestId: expect.any(String),
      details: { code: "UNIQUE_VIOLATION", field: "name" },
      category: "conflict",
      fieldErrors: { name: ["Another record already uses this name. Choose a different name."] },
    });
    noLeaks(second.text);
    expect(await prisma.projectType.count({ where: { companyId: COMPANY.a, name: TYPE_NAME } })).toBe(1);

    // The action transport reads the same violation the same way.
    const thrown = await captured(create);
    expect(thrown).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(actionFailure(thrown, "aud09a")).toEqual({
      ok: false,
      code: "UNIQUE_VIOLATION",
      error: "Another record already uses this name. Choose a different name.",
      category: "conflict",
      fieldErrors: { name: ["Another record already uses this name. Choose a different name."] },
    });
  });

  it("answers a raw query's violation (P2010 / 23505) without the SQL", async () => {
    const insert = () =>
      prisma.$executeRaw`INSERT INTO "project_types" ("id", "companyId", "name", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES (${`${PREFIX}raw`}, ${COMPANY.a}, ${TYPE_NAME}, true, 0, now(), now())`;
    const refused = await throughRoute(async () => apiOk({ data: await insert() }));
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: "CONFLICT", category: "conflict", details: { code: "UNIQUE_VIOLATION" } });
    expect(String(refused.body.error?.message)).toMatch(/^(That conflicts with an existing record|Another record already uses this)/);
    noLeaks(refused.text);
    expect(await prisma.projectType.count({ where: { id: `${PREFIX}raw` } })).toBe(0);
  });

  it("names columns the way a person would", () => {
    expect(fieldLabel("contractNumber")).toBe("contract number");
    expect(fieldLabel("normalizedName")).toBe("name");
    expect(fieldLabel("unit_type_id")).toBe("unit type");
  });
});

const lineSchema = z.object({
  title: requiredText(2, 40, "Title"),
  lineItems: z
    .array(z.object({ description: requiredText(1, 200, "Description"), unitPrice: decimalText(decimalRule("unitPrice", "Unit price")) }))
    .max(3, "At most three lines."),
});

function jsonRequest(body: unknown, url = "http://localhost/api/aud09"): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("schema refusals keep their full paths (line items included)", () => {
  const invalid = {
    title: "x",
    lineItems: [
      { description: "Rebar", unitPrice: "12.5" },
      { description: "Concrete", unitPrice: "80" },
      { description: "Formwork", unitPrice: "1,234" },
    ],
  };

  it("keys a row's error by its index and field, beside the legacy top-level details", async () => {
    const refused = await throughRoute(async () => apiOk(lineSchema.parse(await readJson(jsonRequest(invalid)))));
    expect(refused.status).toBe(422);
    const error = refused.body.error!;
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.category).toBe("validation");
    expect(error.fieldErrors).toEqual({
      title: ["Title must be at least 2 characters"],
      "lineItems.2.unitPrice": ['Unit price "1,234" is ambiguous: write 1234 for 1 thousand 234, or 1.234 for 1 point 234.'],
    });
    // Backward compatible: `details` is still zod's top-level flattening.
    expect(Object.keys(error.details as object).sort()).toEqual(["lineItems", "title"]);

    // Positive control: the corrected payload passes, normalised once.
    const accepted = await throughRoute(async () => apiOk(lineSchema.parse(await readJson(jsonRequest({ ...invalid, title: "Level 3", lineItems: [{ description: "Formwork", unitPrice: "1234,5" }] })))));
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ title: "Level 3", lineItems: [{ description: "Formwork", unitPrice: "1234.5" }] });
  });

  it("answers the same paths to a server action", () => {
    const result = lineSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    expect(validationFailure(result.error!)).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Please review the highlighted fields.",
      category: "validation",
      fieldErrors: {
        title: ["Title must be at least 2 characters"],
        "lineItems.2.unitPrice": ['Unit price "1,234" is ambiguous: write 1234 for 1 thousand 234, or 1.234 for 1 point 234.'],
      },
    });
  });

  it("says a rule over the whole payload as the form-level message", async () => {
    const tooMany = { title: "Level 3", lineItems: [1, 2, 3, 4].map(() => ({ description: "d", unitPrice: "1" })) };
    const refused = await throughRoute(async () => apiOk(lineSchema.parse(tooMany)));
    expect(refused.status).toBe(422);
    expect(refused.body.error?.fieldErrors).toEqual({ lineItems: ["At most three lines."] });
    const whole = z.object({ start: z.string(), end: z.string() }).refine((value) => value.end >= value.start, { message: "End must be on or after the start." });
    const ruled = await throughRoute(async () => apiOk(whole.parse({ start: "2026-09-27", end: "2026-09-01" })));
    expect(ruled.status).toBe(422);
    expect(ruled.body.error?.message).toBe("End must be on or after the start.");
    expect(ruled.body.error).not.toHaveProperty("fieldErrors");
  });
});

describe("the route and the action answer the same code for the same failure", () => {
  const cases: Array<{ name: string; error: () => unknown; code: string; category: string; access?: boolean }> = [
    { name: "a permission refusal", error: () => new AccessError("FORBIDDEN"), code: "FORBIDDEN", category: "permission", access: true },
    { name: "a hidden record", error: () => new AccessError("NOT_FOUND"), code: "NOT_FOUND", category: "permission", access: true },
    { name: "a service's field refusal", error: () => new AccessError("VALIDATION_ERROR", "Give the review a due date.", { field: "dueAt", code: "SUBMITTAL_DUE_REQUIRED" }), code: "SUBMITTAL_DUE_REQUIRED", category: "validation" },
    { name: "a stale version", error: () => new AccessError("CONFLICT", "This task changed since you opened it.", { code: "TASK_VERSION_CONFLICT" }), code: "TASK_VERSION_CONFLICT", category: "conflict" },
    { name: "a missing precondition", error: () => new AccessError("PRECONDITION_REQUIRED", undefined, { code: "TASK_VERSION_REQUIRED" }), code: "TASK_VERSION_REQUIRED", category: "conflict" },
    { name: "a transient failure", error: () => new AccessError("TEMPORARILY_UNAVAILABLE"), code: "TEMPORARILY_UNAVAILABLE", category: "failure" },
    { name: "a workspace changed in another tab", error: () => new StaleWorkspaceError(), code: "WORKSPACE_CHANGED", category: "session" },
    { name: "a nested schema refusal", error: () => lineSchema.safeParse({ title: "ok title", lineItems: [{ description: "", unitPrice: "1" }] }).error, code: "VALIDATION_ERROR", category: "validation" },
  ];

  for (const testCase of cases) {
    it(testCase.name, async () => {
      const thrown = testCase.error();
      const route = await throughRoute(async () => {
        throw thrown;
      });
      const envelope = route.body.error!;
      const details = envelope.details as { code?: string } | undefined;
      const action = actionFailure(thrown);

      expect(action.code).toBe(testCase.code);
      expect(details?.code ?? envelope.code).toBe(testCase.code);
      expect(action.category).toBe(testCase.category);
      expect(action.error).toBe(envelope.message);
      if (testCase.access) {
        // A refusal about access keeps the bare envelope (PRD #47 §116): its category is its code's.
        expect(Object.keys(envelope).sort()).toEqual(["code", "message", "requestId"]);
        expect(errorCategory(String(envelope.code), details?.code)).toBe(testCase.category);
        expect(action).not.toHaveProperty("fieldErrors");
      } else {
        expect(envelope.category).toBe(testCase.category);
        expect(envelope.fieldErrors).toEqual(action.fieldErrors);
      }
      noLeaks(route.text);
    });
  }

  it("an unexpected error: a generic sentence and a reference on both, and the cause only in the logs", async () => {
    const thrown = new Error("boom: SELECT * FROM users WHERE password = 'x'");
    const route = await throughRoute(async () => {
      throw thrown;
    });
    expect(route.status).toBe(500);
    expect(route.body.error).toMatchObject({ code: "INTERNAL_ERROR", category: "failure", requestId: expect.any(String) });
    expect(route.text).not.toContain("boom");
    noLeaks(route.text);
    const action = actionFailure(thrown, "aud09a");
    expect(action).toMatchObject({ ok: false, code: "INTERNAL_ERROR", category: "failure", error: "We couldn't save your changes. Please try again.", reference: expect.any(String) });
    expect(JSON.stringify(action)).not.toContain("boom");
    expect(describeFailure(thrown).expected).toBe(false);
  });

  it("Next's own control flow is thrown on, never turned into a failure", () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/tasks;307;" });
    expect(() => actionFailure(redirect)).toThrow(redirect);
  });
});

describe("a real module: the Tasks route and action refuse the same input the same way (FV-04)", () => {
  it("refuses a one-letter title on both, then accepts a valid one on both", async () => {
    actAs(pm);
    const route = await answer(await taskRoute.POST(jsonRequest({ title: "x" }, "http://localhost/api/tasks")));
    expect(route.status).toBe(422);
    expect(route.body.error).toMatchObject({ code: "VALIDATION_ERROR", category: "validation" });
    const routeTitle = (route.body.error?.fieldErrors as Record<string, string[]>).title;
    expect(routeTitle?.length).toBeGreaterThan(0);

    const formData = new FormData();
    formData.set("title", "x");
    const action = await taskActions.createTaskAction(formData);
    expect(action.ok).toBe(false);
    if (action.ok) return;
    expect(action.code).toBe("VALIDATION_ERROR");
    expect(action.fieldErrors?.title).toEqual(routeTitle);
    expect(await prisma.task.count({ where: { title: "x", companyId: pm.companyId, createdAt: { gt: new Date(Date.now() - 60_000) } } })).toBe(0);

    // Positive controls on both transports.
    const created = await answer(await taskRoute.POST(jsonRequest({ title: `${PREFIX}route task` }, "http://localhost/api/tasks")));
    expect(created.status).toBe(201);
    const good = new FormData();
    good.set("title", `${PREFIX}action task`);
    const saved = await taskActions.createTaskAction(good);
    expect(saved).toMatchObject({ ok: true, redirectTo: expect.stringMatching(/^\/tasks\//) });
    expect(await prisma.task.count({ where: { title: { startsWith: PREFIX }, companyId: pm.companyId } })).toBe(2);
  });
});
