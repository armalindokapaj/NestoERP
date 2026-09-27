import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { WINDOW } from "@/lib/modules/approvals/approvals.cycle-provider";
import { approvalQuerySchema } from "@/lib/modules/approvals/approvals.schema";
import { getApprovalCounts, listApprovals } from "@/lib/modules/approvals/approvals.service";
import { cleanupSessions, loginAsMembership, prisma } from "../../helpers";

/**
 * AUD-08 §4, DT-05: the Approvals Center never presents a bounded read as the
 * whole list.
 *
 * The Center merges providers that each read a bounded window of their own
 * table and then drop what the reader may not open or decide. Before AUD-08 a
 * window that kept few rows looked complete: "Waiting" read the newest 300
 * pending cycles, kept none, and answered "nothing waiting" with no cap; a
 * history page read four windows of unreachable rows and simply ended. Now a
 * provider marks such an answer, and the list says `windowed` and its counts
 * say `capped`.
 *
 * Fixture: 300 pending and 300 approved QA/QC cycles in the fixture company,
 * on records that do not exist (the polymorphic record id has no foreign key),
 * dated in 2099 so they are the newest rows every read meets first. None is
 * reachable, so none is ever shown — only the honesty of the answer changes.
 * Everything is removed in afterAll.
 */

const COMPANY = "company_fixture";
const OWNER = "member_fixture_owner";
const PREFIX = "aud08m_ghost_";
const query = (input: Record<string, unknown>) => approvalQuerySchema.parse(input);

let owner: UserContext;

beforeAll(async () => {
  owner = await loginAsMembership(OWNER);
});

afterAll(async () => {
  await prisma.qualityApproval.deleteMany({ where: { companyId: COMPANY, recordId: { startsWith: PREFIX } } });
  await cleanupSessions();
  await prisma.$disconnect();
});

async function insertGhosts(status: "PENDING" | "APPROVED", count: number) {
  await prisma.qualityApproval.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      companyId: COMPANY,
      recordType: index % 2 === 0 ? ("NCR" as const) : ("INSPECTION" as const),
      recordId: `${PREFIX}${status.toLowerCase()}_${String(index).padStart(4, "0")}`,
      status,
      submittedByMemberId: OWNER,
      submittedAt: new Date(Date.UTC(2099, 0, 1, 0, 0, index)),
      ...(status === "APPROVED" ? { decidedByMemberId: OWNER, decidedAt: new Date(Date.UTC(2099, 0, 2, 0, 0, index)) } : {}),
    })),
  });
}

describe("Approvals Center windows are reported, never silent (AUD-08 §4, DT-05)", () => {
  it("positive control: without the fixture the QA/QC reads are complete", async () => {
    const waiting = await listApprovals(owner, query({ tab: "waiting", provider: "qaqc" }));
    expect(waiting.windowed).toBe(false);
    const history = await listApprovals(owner, query({ tab: "history", provider: "qaqc", limit: 5 }));
    expect(history.windowed).toBe(false);
    const counts = await getApprovalCounts(owner);
    expect(counts.capped).toBe(false);
  });

  it("a full Waiting window that keeps nothing is windowed and capped, not 'nothing waiting'", async () => {
    await insertGhosts("PENDING", WINDOW);
    expect(await prisma.qualityApproval.count({ where: { companyId: COMPANY, status: "PENDING", recordId: { startsWith: PREFIX } } })).toBe(300);

    const waiting = await listApprovals(owner, query({ tab: "waiting", provider: "qaqc" }));
    // None of the 300 is reachable, so none is shown …
    expect(waiting.items.filter((item) => item.sourceId.startsWith(PREFIX))).toEqual([]);
    // … and the answer says it is a window rather than the whole queue.
    expect(waiting.windowed).toBe(true);

    const counts = await getApprovalCounts(owner);
    expect(counts.capped).toBe(true);
    expect(counts.partial).toBe(false);
  });

  it("a date-ordered page whose reads run out of rounds says so instead of ending the list", async () => {
    await insertGhosts("APPROVED", WINDOW);
    // History is an exact, date-ordered read (§253): four windows of unreachable rows, then it stops.
    const history = await listApprovals(owner, query({ tab: "history", provider: "qaqc", limit: 5 }));
    expect(history.items.filter((item) => item.sourceId.startsWith(PREFIX))).toEqual([]);
    expect(history.nextCursor).toBeNull();
    expect(history.windowed).toBe(true);
  });
});
