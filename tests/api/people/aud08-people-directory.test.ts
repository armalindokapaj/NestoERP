import { afterAll, describe, expect, it } from "vitest";

import { auditQuerySchema, listAuditEvents } from "@/lib/core/audit/audit-query.service";
import { directoryQuerySchema } from "@/lib/modules/people/people.schema";
import { listPeople } from "@/lib/modules/people/people.service";
import { cleanupSessions, loginAs, PROJECT, prisma } from "../../helpers";

/**
 * AUD-08 on the people directory and the Settings audit log (DT-05, DT-22).
 *
 * The directory's project filter used to accept any project in the group, so a
 * reader could list the team of a project they cannot open. The audit log's
 * page past the end used to come back empty with a count beside it.
 */

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("people directory (AUD-08 §3, DT-22)", () => {
  it("a project the reader cannot open lists nobody; their own project lists its team", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    // Positive control first: the reader's own project, with its active members, independently counted.
    const expectedOwn = await prisma.personProfile.count({
      where: { user: { is: { memberships: { some: { projectMemberships: { some: { projectId: PROJECT.a, status: "ACTIVE" } } } } } } },
    });
    expect(expectedOwn).toBeGreaterThan(0);
    const own = await listPeople(pm, directoryQuerySchema.parse({ project: PROJECT.a, company: "all", limit: 50 }));
    expect(own.pagination.total).toBe(expectedOwn);

    // Company B's project has members, but this reader cannot open it.
    const members = await prisma.projectMember.count({ where: { projectId: PROJECT.b, status: "ACTIVE" } });
    expect(members).toBeGreaterThan(0);
    const foreign = await listPeople(pm, directoryQuerySchema.parse({ project: PROJECT.b, company: "all" }));
    expect(foreign.pagination.total).toBe(0);
    expect(foreign.data).toEqual([]);
  });

  it("DT-05: a page past the end reads the last page with the filters kept", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const first = await listPeople(pm, directoryQuerySchema.parse({ company: "all", limit: 10 }));
    const past = await listPeople(pm, directoryQuerySchema.parse({ company: "all", limit: 10, page: 999 }));
    expect(past.pagination.page).toBe(first.pagination.totalPages);
    expect(past.pagination.total).toBe(first.pagination.total);
    expect(past.data.length).toBeGreaterThan(0);
  });
});

describe("Settings audit log (AUD-08 §4)", () => {
  it("DT-05: a page past the end reads the last page; a page that is not a number is page 1", async () => {
    const owner = await loginAs("OWNER");
    expect(auditQuerySchema.parse({ page: "x" }).page).toBe(1);
    const first = await listAuditEvents(owner, auditQuerySchema.parse({ pageSize: 10, from: "2000-01-01" }));
    const past = await listAuditEvents(owner, auditQuerySchema.parse({ pageSize: 10, page: 100000, from: "2000-01-01" }));
    expect(first.pagination.total).toBeGreaterThan(0);
    expect(past.pagination.page).toBe(first.pagination.totalPages);
    expect(past.data.length).toBe(first.pagination.total - (first.pagination.totalPages - 1) * 10);
  });
});
