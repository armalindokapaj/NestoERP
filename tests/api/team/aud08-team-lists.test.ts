import { afterAll, describe, expect, it } from "vitest";

import { can } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import { parseTeamListQuery } from "@/lib/modules/team/team.query";
import * as team from "@/lib/modules/team/team.service";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/**
 * AUD-08 on the Team directory (DT-02, DT-05, DT-09).
 *
 * People and Inactive are one list with a section restriction; the address used
 * to be able to swap it for the other section. A reader who may not see last
 * login used to be able to sort by it. A manager's project count used to drop a
 * managed project whenever anybody else on the page was a member of it.
 */

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

const PEOPLE = { status: ["ACTIVE", "INVITED"] as ("ACTIVE" | "INVITED")[] };
const INACTIVE = { status: ["INACTIVE", "SUSPENDED"] as ("INACTIVE" | "SUSPENDED")[], sort: "updated-desc" as const };

describe("team sections (AUD-08 §3, DT-02)", () => {
  it("a status in the address narrows within the section and never steps outside it", () => {
    expect(parseTeamListQuery({ status: "INACTIVE" }, PEOPLE).status).toEqual(["ACTIVE", "INVITED"]);
    expect(parseTeamListQuery({ status: "INVITED" }, PEOPLE).status).toEqual(["INVITED"]);
    expect(parseTeamListQuery({ status: "ACTIVE,SUSPENDED" }, INACTIVE).status).toEqual(["SUSPENDED"]);
    expect(parseTeamListQuery({}, INACTIVE).status).toEqual(["INACTIVE", "SUSPENDED"]);
    // The API has no section: the address is read as it is.
    expect(parseTeamListQuery({ status: "INACTIVE" }).status).toEqual(["INACTIVE"]);
  });

  it("the People section lists no inactive member even when the address asks for them", async () => {
    const owner = await loginAs("OWNER");
    const result = await team.listMembers(owner, parseTeamListQuery({ status: "INACTIVE", limit: "100" }, PEOPLE));
    expect(result.data.every((row) => row.status === "ACTIVE" || row.status === "INVITED")).toBe(true);
    const expected = await prisma.companyMember.count({ where: { companyId: owner.companyId, status: { in: ["ACTIVE", "INVITED"] } } });
    expect(result.pagination.total).toBe(expected);
  });
});

describe("team pages and sorts (AUD-08 §4)", () => {
  it("DT-05: a page past the end reads the last page; pages never overlap", async () => {
    const owner = await loginAs("OWNER");
    const first = await team.listMembers(owner, parseTeamListQuery({ limit: "5" }, PEOPLE));
    const past = await team.listMembers(owner, parseTeamListQuery({ limit: "5", page: "500" }, PEOPLE));
    expect(past.pagination.page).toBe(first.pagination.totalPages);
    const all: string[] = [];
    for (let page = 1; page <= first.pagination.totalPages; page += 1) {
      all.push(...(await team.listMembers(owner, parseTeamListQuery({ limit: "5", page: String(page), sort: "role-asc" }, PEOPLE))).data.map((row) => row.id));
    }
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(first.pagination.total);
  });

  it("DT-09: a reader who may not see last login cannot order by it; a reader who may, can", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    expect(can(pm, "team.member.view")).toBe(true);
    expect(can(pm, "team.member.security_metadata.view")).toBe(false);
    const byLogin = await team.listMembers(pm, parseTeamListQuery({ sort: "last-login-desc", limit: "100" }, PEOPLE));
    const byName = await team.listMembers(pm, parseTeamListQuery({ sort: "name-asc", limit: "100" }, PEOPLE));
    expect(byLogin.data.map((row) => row.id)).toEqual(byName.data.map((row) => row.id));
    expect(byLogin.data.every((row) => row.lastLoginAt === null)).toBe(true);

    // Positive control: the Owner may, and the order is by last login, newest first.
    const owner = await loginAs("OWNER");
    const ownerRows = (await team.listMembers(owner, parseTeamListQuery({ sort: "last-login-desc", limit: "100" }, PEOPLE))).data;
    const stamps = ownerRows.map((row) => row.lastLoginAt).filter((value): value is string => value !== null);
    expect(stamps.length).toBeGreaterThan(0);
    expect([...stamps].sort().reverse()).toEqual(stamps);
  });

  it("a project count counts each visible project a person manages or works on, once", async () => {
    const owner = await loginAs("OWNER");
    const rows = (await team.listMembers(owner, parseTeamListQuery({ limit: "100" }, PEOPLE))).data;
    const scope = buildProjectScopeWhere(owner);
    for (const row of rows) {
      // Written independently of the list: one count per person, straight from the projects.
      const expected = await prisma.project.count({
        where: { AND: [scope, { OR: [{ members: { some: { companyMemberId: row.id, status: "ACTIVE" } } }, { projectManagerMemberId: row.id }] }] },
      });
      expect({ id: row.id, projects: row.projectCount }).toEqual({ id: row.id, projects: expected });
    }
  });
});
