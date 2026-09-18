import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import { armaarPassword, seedArmaar } from "../../../prisma/seed/armaar/seed";
import { verifyDemoTenant } from "../../../prisma/seed/armaar/verify";
import { PROJECT_FACTS } from "../../../prisma/seed/armaar/public-facts";
import { prisma } from "../../helpers";

/**
 * The ARMAAR demo tenant as D-01 accepts it (§93-§99, §107, §108, §110, §111):
 * idempotent, public facts untouched, provenance on what a presenter talks
 * about, one person per login, no ARMAAR in product code.
 */

const ARMAAR = "armaar_group";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the ARMAAR demo tenant", () => {
  it("is what D-01 says it is (§93-§99, §108)", async () => {
    expect(await verifyDemoTenant(prisma, ARMAAR)).toEqual([]);
  });

  it("seeds again without adding or changing anything (§73, §110)", async () => {
    const count = async () => ({
      companies: await prisma.company.count({ where: { parentGroupId: ARMAAR } }),
      users: await prisma.user.count({ where: { personProfile: { parentGroupId: ARMAAR } } }),
      logins: await prisma.companyMember.count({ where: { company: { parentGroupId: ARMAAR } } }),
      projects: await prisma.project.count({ where: { company: { parentGroupId: ARMAAR } } }),
      units: await prisma.projectUnit.count({ where: { company: { parentGroupId: ARMAAR } } }),
      contracts: await prisma.contract.count({ where: { company: { parentGroupId: ARMAAR } } }),
      payments: await prisma.payment.count({ where: { company: { parentGroupId: ARMAAR } } }),
      tasks: await prisma.task.count({ where: { company: { parentGroupId: ARMAAR } } }),
      documents: await prisma.document.count({ where: { company: { parentGroupId: ARMAAR } } }),
      history: await prisma.employmentAssignment.count({ where: { company: { parentGroupId: ARMAAR } } }),
      records: await prisma.demoRecord.count({ where: { parentGroupId: ARMAAR } }),
    });
    const before = await count();
    // ARMAAR's own rows only: the steps over every group's rows run beside other suites' writes.
    await seedArmaar(prisma, await hashPassword(armaarPassword()), { shared: false });
    expect(await count()).toEqual(before);
    expect(await verifyDemoTenant(prisma, ARMAAR)).toEqual([]);
  }, 120_000);

  it("records where each fact comes from, field by field where a record mixes them (§3, §107)", async () => {
    const lake = await prisma.demoRecord.findUniqueOrThrow({ where: { key: "ARMAAR:PROJECT:TIRANA_LAKE" } });
    expect(lake).toMatchObject({ sourceType: "PUBLIC", sourceVerifiedAt: expect.any(Date) });
    expect(lake.fieldSources).toMatchObject({ name: "PUBLIC", builtArea: "PUBLIC", company: "PUBLIC", status: "SYNTHETIC", progress: "SYNTHETIC" });

    const square = await prisma.demoRecord.findUniqueOrThrow({ where: { key: "ARMAAR:PROJECT:SQUARE_21" } });
    expect(square.fieldSources).toMatchObject({ name: "PUBLIC", company: "SYNTHETIC" });
    expect(square.note).toMatch(/not in the source set/);

    const person = await prisma.demoRecord.findUniqueOrThrow({ where: { key: "ARMAAR:PERSON:armaar.owner" } });
    expect(person.sourceType).toBe("SYNTHETIC");
    // Nothing is public that the source set does not say.
    const projects = await prisma.project.findMany({ where: { company: { parentGroupId: ARMAAR } }, select: { name: true, builtArea: true } });
    for (const project of projects) {
      const fact = PROJECT_FACTS.find((candidate) => candidate.name === project.name)!;
      expect(project.builtArea === null ? undefined : Number(project.builtArea), project.name).toBe(fact.builtArea);
    }
  });

  it("gives each person one person record and addresses nobody real (§11, §76, §95)", async () => {
    const users = await prisma.user.findMany({ where: { personProfile: { parentGroupId: ARMAAR } }, select: { email: true, personProfileId: true } });
    expect(new Set(users.map((user) => user.personProfileId)).size).toBe(users.length);
    // The reserved .test domain: no address here can reach a mailbox.
    expect(users.every((user) => user.email?.endsWith("@armaar-demo.test"))).toBe(true);
    const suppliers = await prisma.supplier.findMany({ where: { company: { parentGroupId: ARMAAR } }, select: { taxId: true } });
    // No Albanian NIPT begins with X: none of these can be a real company's.
    expect(suppliers.every((supplier) => supplier.taxId?.startsWith("X"))).toBe(true);
  });

  it("keeps suspended companies visible and free of new work (§5, §93)", async () => {
    const suspended = await prisma.company.findMany({ where: { parentGroupId: ARMAAR, status: "SUSPENDED" }, select: { id: true } });
    expect(suspended).toHaveLength(4);
    expect(await prisma.project.count({ where: { companyId: { in: suspended.map((row) => row.id) } } })).toBe(0);
    expect(await prisma.task.count({ where: { companyId: { in: suspended.map((row) => row.id) } } })).toBe(0);
  });

  it("is data, never product behaviour: no product code names ARMAAR (§92)", () => {
    const named: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const file = path.join(dir, entry);
        if (statSync(file).isDirectory()) walk(file);
        else if (/\.(ts|tsx)$/.test(entry) && /armaar/i.test(readFileSync(file, "utf8"))) named.push(file);
      }
    };
    for (const root of ["app", "components", "config", "lib"]) walk(path.resolve(process.cwd(), root));
    expect(named).toEqual([]);
  });
});
