import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { createClientSchema, createContactSchema } from "@/lib/modules/clients/client.schema";
import * as clients from "@/lib/modules/clients/client.service";
import { cleanupSessions, COMPANY, loginAs, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";

/**
 * AUD-09 — the client and contact forms' payload contract, over the route and
 * the server actions, against the real database (§3, §4, §5; FV-04, FV-05,
 * FV-10, FV-11, FV-22).
 *
 * The concurrent create uses a barrier, not timing: a second connection
 * inserts the same client code and holds its transaction open; the create
 * under test is started and the test waits until Postgres reports it blocked
 * behind that insert on the unique index (`pg_blocking_pids`); then the
 * holder commits and the create meets the committed duplicate.
 */

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { PATCH } = await import("@/app/api/clients/[clientId]/route");
const { POST } = await import("@/app/api/clients/route");
const actions = await import("@/lib/actions/clients");

const PREFIX = "aud09b_";
const locker = new PrismaClient();

afterEach(async () => {
  actAs(null);
  const rows = await prisma.client.findMany({ where: { companyId: COMPANY.a, OR: [{ name: { startsWith: PREFIX } }, { code: { startsWith: "AUD09B-" } }] }, select: { id: true } });
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;
  const contacts = await prisma.contact.findMany({ where: { clientId: { in: ids } }, select: { id: true } });
  await prisma.activity.deleteMany({ where: { entityId: { in: [...ids, ...contacts.map((contact) => contact.id)] } } });
  await prisma.contact.deleteMany({ where: { clientId: { in: ids } } });
  await prisma.client.deleteMany({ where: { id: { in: ids } } });
});

afterAll(async () => {
  await cleanupSessions();
  await locker.$disconnect();
  await prisma.$disconnect();
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function patch(clientId: string, body: unknown) {
  const response = await PATCH(
    new Request(`http://localhost/api/clients/${clientId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ clientId }) },
  );
  return { status: response.status, body: (await response.json()) as Json };
}

async function post(body: unknown) {
  const response = await POST(new Request("http://localhost/api/clients", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: response.status, body: (await response.json()) as Json };
}

function form(values: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

const unique = () => Math.random().toString(36).slice(2, 8);

async function fullClient(context: UserContext, overrides: Record<string, unknown> = {}) {
  return clients.createClient(
    context,
    createClientSchema.parse({
      name: `${PREFIX}Full ${unique()}`,
      legalName: "Full Legal Sh.p.k.",
      code: `AUD09B-${unique()}`,
      type: "COMPANY",
      email: `full-${unique()}@aud09.test`,
      phone: "+355 69 000 0000",
      website: "https://full.example",
      address: "Rruga e Durrësit 1",
      city: "Tirana",
      country: "Albania",
      status: "INACTIVE",
      acceptDuplicate: true,
      ...overrides,
    }),
  );
}

describe("partial updates (FV-05)", () => {
  it("a PATCH naming only the city keeps the status and every other field", async () => {
    const sales = await loginAs("SALES");
    const client = await fullClient(sales);
    const before = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    actAs(sales);

    expect((await patch(client.id, { city: "Durrës" })).status).toBe(200);
    // Before AUD-09 the status fell back to Active (reactivating the client)
    // and the code, legal name, contact details and address were erased.
    expect(await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).toMatchObject({
      city: "Durrës",
      status: "INACTIVE",
      code: before.code,
      legalName: "Full Legal Sh.p.k.",
      email: before.email,
      phone: "+355 69 000 0000",
      website: "https://full.example",
      address: "Rruga e Durrësit 1",
      country: "Albania",
      name: before.name,
    });
  });

  it("an explicit empty string or null clears; an invalid value is refused on its field", async () => {
    const sales = await loginAs("SALES");
    const client = await fullClient(sales);
    actAs(sales);

    expect((await patch(client.id, { legalName: "", website: null })).status).toBe(200);
    expect(await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).toMatchObject({ legalName: null, website: null, city: "Tirana" });

    for (const [body, field] of [
      [{ website: "javascript:alert(1)" }, "website"],
      [{ email: "not-an-email" }, "email"],
      [{ name: " " }, "name"],
      [{ status: "ARCHIVED" }, "status"],
      [{ type: "ALIEN" }, "type"],
    ] as const) {
      const refused = await patch(client.id, body);
      expect(refused.status, JSON.stringify(body)).toBe(422);
      expect(refused.body.error.details, JSON.stringify(body)).toHaveProperty(field);
    }
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).status).toBe("INACTIVE");
  });

  it("a contact's unticked Primary box is an explicit false; an absent one keeps it", async () => {
    const sales = await loginAs("SALES");
    const client = await fullClient(sales);
    const contact = await clients.createContact(sales, client.id, createContactSchema.parse({ firstName: "Mira", lastName: "Kola", isPrimary: true, jobTitle: "Director" }));
    actAs(sales);

    // A request that does not mention the box keeps the contact primary and its job title.
    expect(await actions.updateContactAction(client.id, contact.id, form({ firstName: "Mira", lastName: "Kola" }))).toMatchObject({ ok: true });
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).toMatchObject({ isPrimary: true, jobTitle: "Director", status: "ACTIVE" });

    // The dialog's hidden `false` with the box unticked: no longer primary.
    expect(await actions.updateContactAction(client.id, contact.id, form({ firstName: "Mira", lastName: "Kola", isPrimary: "false" }))).toMatchObject({ ok: true });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).isPrimary).toBe(false);

    // Ticked: the checkbox's value follows the hidden input and wins.
    expect(await actions.updateContactAction(client.id, contact.id, form({ firstName: "Mira", lastName: "Kola", isPrimary: ["false", "true"] }))).toMatchObject({ ok: true });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).isPrimary).toBe(true);

    // A refusal names its field.
    const refused = await actions.updateContactAction(client.id, contact.id, form({ email: "nope" }));
    expect(refused).toMatchObject({ ok: false, code: "VALIDATION_ERROR", fieldErrors: { email: ["Enter a valid email address"] } });
  });
});

describe("Create anyway and hard uniqueness (FV-11)", () => {
  it("a soft duplicate interrupts once; Create anyway creates; it never passes a taken code", async () => {
    const sales = await loginAs("SALES");
    const existing = await fullClient(sales, { status: "ACTIVE" });
    actAs(sales);

    // Same name: the warning, with the match, and no row.
    const warned = await actions.createClientAction(form({ name: existing.name, type: "COMPANY" }));
    expect(warned).toMatchObject({ ok: false, code: "DUPLICATE_SUSPECTED", duplicates: [expect.objectContaining({ id: existing.id, reason: "name" })] });
    expect(await prisma.client.count({ where: { companyId: COMPANY.a, name: existing.name } })).toBe(1);

    // "Create anyway" with the same code as the existing client: the soft
    // answer does not reach past the unique index.
    const taken = await actions.createClientAction(form({ name: existing.name, type: "COMPANY", code: existing.code!, acceptDuplicate: "true" }));
    expect(taken).toMatchObject({ ok: false, code: "CLIENT_CODE_TAKEN", fieldErrors: { code: [expect.stringContaining("already used")] } });
    expect(await prisma.client.count({ where: { companyId: COMPANY.a, name: existing.name } })).toBe(1);

    // Positive control: Create anyway with a free code creates the second client.
    const accepted = await actions.createClientAction(form({ name: existing.name, type: "COMPANY", code: `AUD09B-${unique()}`, acceptDuplicate: "true" }));
    expect(accepted).toMatchObject({ ok: true, redirectTo: expect.stringMatching(/^\/clients\//) });
    expect(await prisma.client.count({ where: { companyId: COMPANY.a, name: existing.name } })).toBe(2);
  });

  it("the route answers a taken code on the field too", async () => {
    const sales = await loginAs("SALES");
    const existing = await fullClient(sales);
    actAs(sales);
    const refused = await post({ name: `${PREFIX}Other ${unique()}`, type: "COMPANY", code: existing.code, acceptDuplicate: true });
    expect(refused.status).toBe(409);
    // The business code and the field it names (lib/forms/errors: a field called `code` is named by `field`).
    expect(refused.body.error).toMatchObject({ message: "That client code is already used in your company. Choose another code.", details: { code: "CLIENT_CODE_TAKEN", field: "code" } });

    // Editing another client onto the taken code is the same refusal.
    const other = await fullClient(sales);
    const clash = await patch(other.id, { code: existing.code, acceptDuplicate: true });
    expect(clash.status).toBe(409);
    expect(clash.body.error.details.code).toBe("CLIENT_CODE_TAKEN");
    expect((await prisma.client.findUniqueOrThrow({ where: { id: other.id } })).code).toBe(other.code);
  });

  it("two creates of the same code at the same moment: one row, and a business error on the field", async () => {
    const sales = await loginAs("SALES");
    const code = `AUD09B-${unique()}`;
    const name = `${PREFIX}Race ${unique()}`;

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let holding!: (pid: number) => void;
    const holderPid = new Promise<number>((resolve) => (holding = resolve));
    const holder = locker.$transaction(
      async (tx) => {
        const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS "pid"`;
        await tx.$executeRaw`
          INSERT INTO "clients" ("id", "companyId", "code", "name", "normalizedName", "createdBy", "updatedAt")
          VALUES (${`aud09b_race_${unique()}`}, ${COMPANY.a}, ${code}, ${`${name} (first)`}, ${`${name} (first)`.toLowerCase()}, ${sales.userId}, now())`;
        holding(pid);
        await gate;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );

    const pid = await holderPid;
    const second = clients.createClient(sales, createClientSchema.parse({ name, type: "COMPANY", code, acceptDuplicate: true })).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    // Synchronise on the database's own lock graph, not a sleep.
    const deadline = Date.now() + 15_000;
    for (;;) {
      const [{ blocked }] = await locker.$queryRaw<Array<{ blocked: number }>>`
        SELECT count(*)::int AS "blocked" FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids("pid"))`;
      if (blocked >= 1) break;
      if (Date.now() > deadline) throw new Error("the second create never reached the unique index");
      await new Promise((resolve) => setImmediate(resolve));
    }
    release();
    await holder;

    const outcome = await second;
    expect(outcome.ok).toBe(false);
    const error = (outcome as { error: unknown }).error;
    expect(error).toBeInstanceOf(AccessError);
    expect(error).toMatchObject({ code: "CONFLICT", details: { code: "CLIENT_CODE_TAKEN", field: "code" } });
    // Exactly the first row: the second create left nothing behind.
    const rows = await prisma.client.findMany({ where: { companyId: COMPANY.a, code } });
    expect(rows.map((row) => row.name)).toEqual([`${name} (first)`]);
    expect(await prisma.client.count({ where: { companyId: COMPANY.a, name } })).toBe(0);
  });
});
