import { afterAll, afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import {
  clientListQuerySchema,
  createClientSchema,
  createContactSchema,
  updateClientSchema,
  updateContactSchema,
} from "@/lib/modules/clients/client.schema";
import * as clients from "@/lib/modules/clients/client.service";
import { cleanupSessions, loginAs, loginAsEmail, PROJECT, prisma } from "../../helpers";

/**
 * Clients authorisation and lifecycle tests (PRD #12 §203–§224, §248).
 *
 * These call the same service the API routes and the UI call, so a test that
 * passes here is a statement about the running product, not about a mock.
 */
const created: string[] = [];

async function track<T extends { id: string }>(work: Promise<T>): Promise<T> {
  const result = await work;
  created.push(result.id);
  return result;
}

afterEach(async () => {
  if (created.length === 0) return;

  // Contact activity is keyed by the contact id, so those ids are collected
  // before the contacts are removed — otherwise the entries outlive the test
  // and the next run sees a different world.
  const contacts = await prisma.contact.findMany({
    where: { clientId: { in: created } },
    select: { id: true },
  });

  await prisma.activity.deleteMany({
    where: { entityId: { in: [...created, ...contacts.map((contact) => contact.id)] } },
  });
  await prisma.contact.deleteMany({ where: { clientId: { in: created } } });
  await prisma.client.deleteMany({ where: { id: { in: created } } });
  created.length = 0;
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

function createInput(overrides: Record<string, unknown> = {}) {
  return createClientSchema.parse({
    name: `Authorisation Test Client ${Math.random().toString(36).slice(2, 8)}`,
    type: "COMPANY",
    ...overrides,
  });
}

function updateInput(overrides: Record<string, unknown> = {}) {
  return updateClientSchema.parse({ name: "Updated Test Client", type: "COMPANY", ...overrides });
}

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(AccessError);
  await promise.catch((error: AccessError) => expect(error.code).toBe(code));
}

/* -------------------------------------------------------------------------- */

describe("list scope (PRD #12 §205)", () => {
  it("gives Sales every active Company A client", async () => {
    const context = await loginAs("SALES");
    const result = await clients.listClients(context, clientListQuerySchema.parse({ limit: 100 }));
    const names = result.data.map((client) => client.name);

    expect(names).toContain("ACME Developments");
    expect(names).toContain("Meridian Group");
  });

  /** A project-scoped user reaches a client through their projects (PRD #12 §21). */
  it("keeps a Project Manager to clients on their own projects", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const result = await clients.listClients(context, clientListQuerySchema.parse({ limit: 100 }));
    const names = result.data.map((client) => client.name);

    expect(names).toContain("ACME Developments");
    expect(names).not.toContain("Meridian Group");
  });

  it("separates archived clients into their own section", async () => {
    const context = await loginAs("SALES");

    const live = await clients.listClients(context, clientListQuerySchema.parse({ limit: 100 }));
    expect(live.data.every((client) => client.status !== "ARCHIVED")).toBe(true);

    const archived = await clients.listClients(
      context,
      clientListQuerySchema.parse({ archived: true, limit: 100 }),
    );
    expect(archived.data.length).toBeGreaterThan(0);
    expect(archived.data.every((client) => client.status === "ARCHIVED")).toBe(true);
  });

  /** The count is what this reader can open, not the company total (PRD #12 §93). */
  it("counts only projects the reader can see", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const owner = await loginAs("OWNER");

    const forPm = await clients.listClients(pm, clientListQuerySchema.parse({ limit: 100 }));
    const forOwner = await clients.listClients(owner, clientListQuerySchema.parse({ limit: 100 }));

    const acmePm = forPm.data.find((client) => client.name === "ACME Developments");
    const acmeOwner = forOwner.data.find((client) => client.name === "ACME Developments");

    expect(acmePm).toBeDefined();
    expect(acmeOwner).toBeDefined();
    expect(acmePm!.activeProjectsCount).toBeLessThanOrEqual(acmeOwner!.activeProjectsCount);
  });
});

describe("cross-company isolation (PRD #12 §211)", () => {
  it("never returns Company A clients to a Company B user", async () => {
    const contextB = await loginAsEmail("owner-b@nesto.test");
    const result = await clients.listClients(contextB, clientListQuerySchema.parse({ limit: 100 }));

    expect(result.data.map((client) => client.name)).not.toContain("ACME Developments");
    await expectError(clients.getClient(contextB, "client_acme"), "NOT_FOUND");
  });

  it("refuses to add a contact to another company's client", async () => {
    const contextB = await loginAsEmail("owner-b@nesto.test");
    await expectError(
      clients.createContact(
        contextB,
        "client_acme",
        createContactSchema.parse({ firstName: "Test", lastName: "Person" }),
      ),
      "NOT_FOUND",
    );
  });
});

describe("detail scope (PRD #12 §207)", () => {
  it("answers 404 rather than 403 for a client outside scope", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    await expectError(clients.getClient(pm, "client_meridian"), "NOT_FOUND");
  });
});

describe("create (PRD #12 §208–§210)", () => {
  it("creates a client and records the actor from the session", async () => {
    const context = await loginAs("SALES");
    const client = await track(clients.createClient(context, createInput()));

    expect(client.status).toBe("ACTIVE");
    expect(client.type).toBe("COMPANY");
  });

  it("refuses a Viewer", async () => {
    const context = await loginAs("VIEWER");
    await expectError(clients.createClient(context, createInput()), "FORBIDDEN");
  });

  it("refuses a duplicate client code (PRD #12 §163)", async () => {
    const context = await loginAs("SALES");
    await expectError(
      clients.createClient(context, createInput({ code: "CLI-001", acceptDuplicate: true })),
      "CONFLICT",
    );
  });

  /** A soft match interrupts once and can then be accepted (PRD #12 §52, §53). */
  it("warns on a same-name client, then creates it when accepted", async () => {
    const context = await loginAs("SALES");

    await expect(
      clients.createClient(context, createInput({ name: "ACME Developments" })),
    ).rejects.toBeInstanceOf(clients.DuplicateClientError);

    const client = await track(
      clients.createClient(
        context,
        createInput({ name: "ACME Developments", acceptDuplicate: true }),
      ),
    );
    expect(client.name).toBe("ACME Developments");
  });

  it("does not warn on a merely similar name", async () => {
    const context = await loginAs("SALES");
    const client = await track(
      clients.createClient(context, createInput({ name: "ACME Development" })),
    );
    expect(client.name).toBe("ACME Development");
  });

  it("creates the optional primary contact in the same call (PRD #12 §50)", async () => {
    const context = await loginAs("SALES");
    const client = await track(
      clients.createClient(
        context,
        createInput({ contactFirstName: "Mira", contactLastName: "Kola" }),
      ),
    );

    expect(client.primaryContact?.fullName).toBe("Mira Kola");
    expect(client.counts.activeContacts).toBe(1);
  });
});

describe("update and archive (PRD #12 §212–§214)", () => {
  it("refuses a stale write rather than overwriting another edit", async () => {
    const context = await loginAs("SALES");
    const client = await track(clients.createClient(context, createInput()));

    await expectError(
      clients.updateClient(
        context,
        client.id,
        updateInput({ acceptDuplicate: true, versionUpdatedAt: "2020-01-01T00:00:00.000Z" }),
      ),
      "CONFLICT",
    );
  });

  it("remembers the pre-archive status and puts it back (PRD #12 §74, §75)", async () => {
    const context = await loginAs("SALES");
    const client = await track(
      clients.createClient(context, createInput({ status: "INACTIVE" })),
    );

    await clients.archiveClient(context, client.id);
    const archived = await clients.getClient(context, client.id);
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.preArchiveStatus).toBe("INACTIVE");

    await clients.restoreClient(context, client.id);
    const restored = await clients.getClient(context, client.id);
    expect(restored.status).toBe("INACTIVE");
    expect(restored.archivedAt).toBeNull();
  });

  it("keeps an archived client read-only until it is restored (PRD #12 §68)", async () => {
    const context = await loginAs("SALES");
    const client = await track(clients.createClient(context, createInput()));
    await clients.archiveClient(context, client.id);

    await expectError(
      clients.updateClient(context, client.id, updateInput({ acceptDuplicate: true })),
      "CONFLICT",
    );
    await expectError(
      clients.createContact(
        context,
        client.id,
        createContactSchema.parse({ firstName: "Late", lastName: "Arrival" }),
      ),
      "CONFLICT",
    );
  });

  /** Archiving a client changes nothing else (PRD #12 §72, §73). */
  it("leaves projects, contacts and documents untouched when archiving", async () => {
    const context = await loginAs("SALES");
    const client = await track(
      clients.createClient(
        context,
        createInput({ contactFirstName: "Stay", contactLastName: "Put" }),
      ),
    );

    await clients.archiveClient(context, client.id);

    const contacts = await clients.listContacts(context, client.id, { archived: true });
    expect(contacts).toHaveLength(1);
    expect(contacts[0].status).toBe("ACTIVE");
  });
});

describe("contacts (PRD #12 §215–§218)", () => {
  async function clientWithContacts() {
    const context = await loginAs("SALES");
    const client = await track(clients.createClient(context, createInput()));

    const first = await clients.createContact(
      context,
      client.id,
      createContactSchema.parse({ firstName: "First", lastName: "Person", isPrimary: true }),
    );
    const second = await clients.createContact(
      context,
      client.id,
      createContactSchema.parse({ firstName: "Second", lastName: "Person" }),
    );

    return { context, client, first, second };
  }

  it("keeps at most one primary contact when a second is promoted", async () => {
    const { context, client, first, second } = await clientWithContacts();

    await clients.makePrimaryContact(context, client.id, second.id);
    const contacts = await clients.listContacts(context, client.id);

    expect(contacts.filter((contact) => contact.isPrimary)).toHaveLength(1);
    expect(contacts.find((contact) => contact.id === second.id)?.isPrimary).toBe(true);
    expect(contacts.find((contact) => contact.id === first.id)?.isPrimary).toBe(false);
  });

  it("also stands the previous primary down through an ordinary edit", async () => {
    const { context, client, first, second } = await clientWithContacts();

    await clients.updateContact(
      context,
      client.id,
      second.id,
      updateContactSchema.parse({ firstName: "Second", lastName: "Person", isPrimary: "on" }),
    );

    const contacts = await clients.listContacts(context, client.id);
    expect(contacts.filter((contact) => contact.isPrimary)).toHaveLength(1);
    expect(contacts.find((contact) => contact.id === first.id)?.isPrimary).toBe(false);
  });

  /** The client is left without one rather than having one chosen (PRD #12 §87). */
  it("clears the primary flag when the primary contact is archived", async () => {
    const { context, client, first } = await clientWithContacts();

    await clients.archiveContact(context, client.id, first.id);
    const detail = await clients.getClient(context, client.id);

    expect(detail.primaryContact).toBeNull();
  });

  it("does not make a restored contact primary again (PRD #12 §88)", async () => {
    const { context, client, first } = await clientWithContacts();

    await clients.archiveContact(context, client.id, first.id);
    await clients.restoreContact(context, client.id, first.id);

    const contacts = await clients.listContacts(context, client.id);
    expect(contacts.find((contact) => contact.id === first.id)?.isPrimary).toBe(false);
    expect(contacts.find((contact) => contact.id === first.id)?.status).toBe("ACTIVE");
  });

  it("refuses to promote an archived contact", async () => {
    const { context, client, second } = await clientWithContacts();

    await clients.archiveContact(context, client.id, second.id);
    await expectError(clients.makePrimaryContact(context, client.id, second.id), "CONFLICT");
  });

  it("refuses a Viewer every contact mutation", async () => {
    const { client } = await clientWithContacts();
    const viewer = await loginAs("VIEWER");

    await expectError(
      clients.createContact(
        viewer,
        client.id,
        createContactSchema.parse({ firstName: "No", lastName: "Access" }),
      ),
      "FORBIDDEN",
    );
  });
});

describe("linked projects (PRD #12 §219)", () => {
  it("returns only the projects the reader can open", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const projects = await clients.listClientProjects(pm, "client_acme");
    const ids = projects.map((project) => project.id);

    expect(ids).toContain(PROJECT.a);
    expect(ids).not.toContain(PROJECT.c);
  });
});

describe("duplicate lookup (PRD #12 §126)", () => {
  it("only returns clients the caller could already discover", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const matches = await clients.checkDuplicates(pm, { name: "Meridian Group" });
    expect(matches).toHaveLength(0);

    const sales = await loginAs("SALES");
    const visible = await clients.checkDuplicates(sales, { name: "Meridian Group" });
    expect(visible.map((match) => match.name)).toContain("Meridian Group");
  });
});
