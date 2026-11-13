import { describe, expect, it } from "vitest";

import { SHOWCASE_CONVERSATIONS } from "@/prisma/seed/showcase/conversations";
import { SHOWCASE_EXTRA_COMPANIES, SHOWCASE_NEW_PEOPLE, SHOWCASE_PEOPLE, SHOWCASE_PROJECTS, SHOWCASE_COMPANIES, showcaseReplacements, usernameOf } from "@/prisma/seed/showcase/dataset";
import { proseReplacementSql } from "@/prisma/seed/showcase/prose";
import { PLANS } from "@/prisma/seed/showcase/fill/sales";
import { LAYOUTS } from "@/prisma/seed/showcase/fill/units";
import { unitLabel } from "@/lib/modules/project-structure/structure.rules";
import { DEMO_PROJECTS } from "@/prisma/seed/demo/projects";
import { COMPANY_USERS, GROUP_USERS, isMemberOf } from "@/prisma/seed/demo/users";

const SEED_USERS = new Set([...GROUP_USERS, ...COMPANY_USERS].map((user) => user.id));

describe("the selling demo's dataset", () => {
  it("re-dresses only accounts and projects the standard seed has", () => {
    for (const userId of Object.keys(SHOWCASE_PEOPLE)) expect(SEED_USERS.has(userId) || userId === "user_admin", userId).toBe(true);
    const projects = new Set<string>(Object.values(DEMO_PROJECTS).map((project) => project.id));
    for (const projectId of Object.keys(SHOWCASE_PROJECTS)) expect(projects.has(projectId), projectId).toBe(true);
  });

  it("gives every added company a head who exists", () => {
    const heads = new Set([...SHOWCASE_NEW_PEOPLE.map((person) => person.id), ...SEED_USERS]);
    for (const company of SHOWCASE_EXTRA_COMPANIES) if (company.head) expect(heads.has(company.head), company.name).toBe(true);
  });

  it("uses registry numbers no real company has and addresses nothing can reach", () => {
    const companies = [...Object.values(SHOWCASE_COMPANIES), ...SHOWCASE_EXTRA_COMPANIES];
    for (const company of companies) {
      expect(company.nipt, company.name).toMatch(/^X\d{8}[A-Z]$/);
      expect(company.domain, company.name).toMatch(/\.test$/);
    }
  });

  it("makes sign-in names from names, without accents, one each", () => {
    expect(usernameOf({ firstName: "Erion", lastName: "Daci" })).toBe("erion.daci");
    expect(usernameOf({ firstName: "Arta", lastName: "Çeliku" })).toBe("arta.celiku");
    const names = [...Object.values(SHOWCASE_PEOPLE), ...SHOWCASE_NEW_PEOPLE].map(usernameOf);
    expect(new Set(names).size).toBe(names.length);
  });

  it("rewrites the long names before the short ones, whole words last", () => {
    const pairs = showcaseReplacements();
    const words = pairs.findIndex((pair) => pair.word);
    expect(pairs.slice(words).every((pair) => pair.word)).toBe(true);
    for (let i = 1; i < words; i += 1) expect(pairs[i - 1].old.length).toBeGreaterThanOrEqual(pairs[i].old.length);
    const index = (old: string) => pairs.findIndex((pair) => pair.old === old);
    expect(index("Aurelia Construction sh.p.k.")).toBeLessThan(index("Aurelia Construction"));
  });

  it("writes every replacement into one statement, quoted", () => {
    const sql = proseReplacementSql([{ old: "O'Brien", new: "O'Neill" }, { old: "Forma", new: "Arvela", word: true }]);
    expect(sql).toContain("O''''Brien");
    expect(sql).toContain("\\mForma\\M");
    expect(sql.trim().startsWith("DO $showcase$")).toBe(true);
  });
});

describe("the selling demo's conversations", () => {
  it("names one person for each mention and only people of the project's company", () => {
    for (const conversation of SHOWCASE_CONVERSATIONS) {
      const companyId = Object.values(DEMO_PROJECTS).find((project) => project.id === conversation.projectId)!.companyId;
      for (const comment of conversation.comments) {
        const placeholders = new Set([...comment.text.matchAll(/\{(\d)\}/g)].map((match) => Number(match[1])));
        expect([...placeholders].sort(), comment.text).toEqual(comment.mentions.map((_, index) => index));
        for (const userId of [comment.author, ...comment.mentions]) expect(isMemberOf(userId, companyId), `${userId} in ${companyId}`).toBe(true);
      }
    }
  });

  it("runs forward in time", () => {
    for (const conversation of SHOWCASE_CONVERSATIONS) {
      const days = conversation.comments.map((comment) => comment.daysAgo);
      expect(days).toEqual([...days].sort((a, b) => b - a));
    }
  });
});

describe("the selling demo's fill", () => {
  const codesOf = (projectId: string) => LAYOUTS.find((layout) => layout.projectId === projectId)!.buildings.flatMap((building) => building.levels.flatMap((level) => level.units.map((unit) => unitLabel(building.code, unit.code))));

  it("gives every unit a code of its own in its project", () => {
    for (const layout of LAYOUTS) {
      const codes = codesOf(layout.projectId);
      expect(new Set(codes).size, layout.projectId).toBe(codes.length);
    }
  });

  it("only pins the story on units that exist", () => {
    for (const plan of PLANS.filter((row) => row.key !== null)) {
      const codes = new Set(codesOf(plan.projectId));
      for (const code of Object.keys(plan.force ?? {})) expect(codes.has(code), `${plan.projectId} ${code}`).toBe(true);
    }
  });

  it("prices every building it puts on the market", () => {
    for (const plan of PLANS.filter((row) => row.key !== null)) {
      const layout = LAYOUTS.find((row) => row.projectId === plan.projectId)!;
      for (const building of Object.keys(plan.launch)) expect(layout.buildings.some((row) => row.code === building), `${plan.projectId} ${building}`).toBe(true);
    }
  });
});
