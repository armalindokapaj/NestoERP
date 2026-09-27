import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { activityFilters, activityQuerySchema } from "@/lib/modules/activity/activity-center.schema";
import { listActivity } from "@/lib/modules/activity/activity-center.service";
import { cleanupSessions, loginAsMembership, prisma } from "../../helpers";

/**
 * Activity Center date filters (AUD-08 §3, DT-03).
 *
 * `from`/`to` are inclusive calendar days read in the company's zone
 * (Europe/Tirane for the fixture company): a day runs from its local midnight
 * to the instant before the next one, across the March daylight-saving change
 * too. Before AUD-08 the days were read in the server process's own zone, so
 * the same query matched different rows on a UTC server and a Tirane laptop.
 *
 * Fixtures are the fixture owner's own notifications, dated 2019 so they sort
 * below everything else, with ids and instants written out here.
 */

const OWNER = "member_fixture_owner";
const COMPANY = "company_fixture";
const PREFIX = "aud08m_act_";

/** id → instant. Winter day 2019-01-15 is 23:00Z..23:00Z; DST day 2019-03-31 is 23:00Z (Mar 30)..22:00Z. */
const ROWS: Record<string, string> = {
  [`${PREFIX}jan14_last`]: "2019-01-14T22:59:59.999Z", // 23:59:59.999 on 14 Jan in Tirane
  [`${PREFIX}jan15_first`]: "2019-01-14T23:00:00.000Z", // 00:00 on 15 Jan
  [`${PREFIX}jan15_last`]: "2019-01-15T22:59:59.999Z", // 23:59:59.999 on 15 Jan
  [`${PREFIX}jan16_first`]: "2019-01-15T23:00:00.000Z", // 00:00 on 16 Jan
  [`${PREFIX}mar31_first`]: "2019-03-30T23:00:00.000Z", // 00:00 on 31 Mar (CET)
  [`${PREFIX}mar31_last`]: "2019-03-31T21:59:59.999Z", // 23:59:59.999 on 31 Mar (CEST)
  [`${PREFIX}apr01_first`]: "2019-03-31T22:00:00.000Z", // 00:00 on 1 Apr (CEST)
};

let owner: UserContext;

beforeAll(async () => {
  owner = await loginAsMembership(OWNER);
  await prisma.notification.createMany({
    data: Object.entries(ROWS).map(([id, at]) => ({
      id,
      companyId: COMPANY,
      recipientMemberId: OWNER,
      eventType: "aud08.fixture",
      moduleKey: "tasks",
      title: `aud08m activity ${id}`,
      dedupeKey: id,
      readState: "READ" as const,
      createdAt: new Date(at),
    })),
  });
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { companyId: COMPANY, id: { startsWith: PREFIX } } });
  await cleanupSessions();
  await prisma.$disconnect();
});

async function ids(input: Record<string, string>): Promise<string[]> {
  const parsed = activityQuerySchema.parse({ type: "NOTIFICATION", q: "aud08m activity", limit: "50", ...input });
  const page = await listActivity(owner, activityFilters(parsed));
  return page.items.map((item) => item.id);
}

describe("Activity Center day filters are company-zone calendar days (AUD-08 §3, DT-03)", () => {
  it("one winter day: from local midnight to the instant before the next", async () => {
    expect(await ids({ from: "2019-01-15", to: "2019-01-15" })).toEqual([`${PREFIX}jan15_last`, `${PREFIX}jan15_first`]);
  });

  it("the daylight-saving day is 23 hours long and keeps both of its edges", async () => {
    expect(await ids({ from: "2019-03-31", to: "2019-03-31" })).toEqual([`${PREFIX}mar31_last`, `${PREFIX}mar31_first`]);
  });

  it("open-ended bounds and the positive control: no date filter returns every fixture, newest first", async () => {
    expect(await ids({ from: "2019-01-16" })).toEqual([`${PREFIX}apr01_first`, `${PREFIX}mar31_last`, `${PREFIX}mar31_first`, `${PREFIX}jan16_first`]);
    expect(await ids({ to: "2019-01-14" })).toEqual([`${PREFIX}jan14_last`]);
    expect(await ids({})).toEqual([
      `${PREFIX}apr01_first`,
      `${PREFIX}mar31_last`,
      `${PREFIX}mar31_first`,
      `${PREFIX}jan16_first`,
      `${PREFIX}jan15_last`,
      `${PREFIX}jan15_first`,
      `${PREFIX}jan14_last`,
    ]);
  });
});
