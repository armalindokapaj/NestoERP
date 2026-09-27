import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { personCreateSchema, personUpdateSchema } from "@/lib/modules/platform/platform-control.schema";
import { createPlatformPerson, updatePlatformPerson } from "@/lib/modules/platform/platform-control.service";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * AUD-09 (Forms & Validation) for the Platform Admin person editor (FV-04,
 * FV-05). Its dialog sends null for a blank optional field, which the schema
 * used to refuse — no person with a blank preferred name could be saved — and
 * an edit that did not carry a field erased it.
 */

const PREFIX = "aud09c2_";
const startedAt = new Date();
let admin: Awaited<ReturnType<typeof loginAsPlatformAdmin>>;

beforeAll(async () => {
  admin = await loginAsPlatformAdmin();
});

afterAll(async () => {
  const people = await prisma.personProfile.findMany({ where: { lastName: { startsWith: PREFIX } }, select: { id: true } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: people.map((row) => row.id) }, createdAt: { gte: startedAt } } });
  await prisma.personProfile.deleteMany({ where: { id: { in: people.map((row) => row.id) } } });
  await cleanupSessions();
});

describe("platform person editor (FV-04, FV-05)", () => {
  it("accepts the dialog's nulls, keeps what an edit does not carry, and clears what it names", async () => {
    const created = await createPlatformPerson(
      admin,
      personCreateSchema.parse({ parentGroupId: "group_demo_nesto", firstName: "Elira", lastName: `${PREFIX}Dervishi`, preferredName: null, jobTitle: "Site engineer", workEmail: null, workPhone: "+355 69 000 0000", lifecycleStatus: "EMPLOYEE", reason: "AUD-09 fixture" }),
    );
    let row = await prisma.personProfile.findUniqueOrThrow({ where: { id: created.id }, select: { preferredName: true, jobTitle: true, workEmail: true, workPhone: true } });
    expect(row).toEqual({ preferredName: null, jobTitle: "Site engineer", workEmail: null, workPhone: "+355 69 000 0000" });

    await updatePlatformPerson(admin, created.id, personUpdateSchema.parse({ firstName: "Elira", lastName: `${PREFIX}Dervishi`, preferredName: "Eli", lifecycleStatus: "EMPLOYEE", reason: "AUD-09 edit" }));
    row = await prisma.personProfile.findUniqueOrThrow({ where: { id: created.id }, select: { preferredName: true, jobTitle: true, workEmail: true, workPhone: true } });
    expect(row).toEqual({ preferredName: "Eli", jobTitle: "Site engineer", workEmail: null, workPhone: "+355 69 000 0000" });

    await updatePlatformPerson(admin, created.id, personUpdateSchema.parse({ firstName: "Elira", lastName: `${PREFIX}Dervishi`, jobTitle: null, workPhone: "", lifecycleStatus: "EMPLOYEE", reason: "AUD-09 clear" }));
    row = await prisma.personProfile.findUniqueOrThrow({ where: { id: created.id }, select: { preferredName: true, jobTitle: true, workEmail: true, workPhone: true } });
    expect(row).toEqual({ preferredName: "Eli", jobTitle: null, workEmail: null, workPhone: null });
  });

  it("still refuses an invalid email on its field", () => {
    const parsed = personUpdateSchema.safeParse({ firstName: "A", lastName: "B", workEmail: "nope", lifecycleStatus: "EMPLOYEE", reason: "check" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["workEmail"]);
  });
});
