import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { getCalendar } from "@/lib/modules/calendar/calendar.query";
import { instantFromLocal } from "@/lib/modules/calendar/calendar.time";
import { SOURCE_LIMIT } from "@/lib/modules/calendar/providers/provider.helpers";
import { cleanupSessions, loginAsMembership, prisma } from "../../helpers";

/**
 * The calendar's bounded reads (AUD-08 §4, DT-04, DT-05).
 *
 * - DT-04: events that tie on start, all-day and title still come back in one
 *   total order — by event id — so the MAX_EVENTS cut is the same on every read.
 * - DT-05: a source read that stops at SOURCE_LIMIT marks the response
 *   `truncated` and names the source, where before the range silently showed
 *   the first 500 events as if they were all.
 *
 * Fixtures are private events of the fixture company's owner in two weeks of
 * 2019 nobody else uses; ids are written out here and removed in afterAll.
 */

const ZONE = "Europe/Tirane";
const OWNER = "member_fixture_owner";
const COMPANY = "company_fixture";
const PREFIX = "aud08m_ev_";

let owner: UserContext;

const week = (monday: string, sunday: string) => ({ from: instantFromLocal(monday, "00:00", ZONE), to: instantFromLocal(sunday, "00:00", ZONE) });
const TIE_WEEK = week("2019-06-03", "2019-06-10");
const FULL_WEEK = week("2019-06-17", "2019-06-24");

function event(id: string, startsAt: Date, title: string) {
  return {
    id,
    companyId: COMPANY,
    createdByMemberId: OWNER,
    title,
    eventType: "PERSONAL_EVENT" as const,
    visibility: "PRIVATE" as const,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60_000),
    allDay: false,
    timezone: ZONE,
  };
}

beforeAll(async () => {
  owner = await loginAsMembership(OWNER);
  const tied = instantFromLocal("2019-06-05", "10:00", ZONE);
  await prisma.calendarEvent.createMany({
    data: [
      // Created out of order on purpose: the expected order is by id alone.
      event(`${PREFIX}tie_c`, tied, "aud08m tied"),
      event(`${PREFIX}tie_a`, tied, "aud08m tied"),
      event(`${PREFIX}tie_b`, tied, "aud08m tied"),
      // Earlier the same day: first whatever its id.
      event(`${PREFIX}tie_z_early`, instantFromLocal("2019-06-05", "09:00", ZONE), "aud08m tied"),
    ],
  });
  await prisma.calendarEvent.createMany({
    data: Array.from({ length: SOURCE_LIMIT }, (_, index) =>
      event(`${PREFIX}full_${String(index).padStart(3, "0")}`, instantFromLocal("2019-06-19", "08:00", ZONE), `aud08m full ${index}`),
    ),
  });
});

afterAll(async () => {
  await prisma.calendarEvent.deleteMany({ where: { companyId: COMPANY, id: { startsWith: PREFIX } } });
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("calendar order and bounds (AUD-08 §4)", () => {
  it("orders tied events by id, the same on every read (DT-04)", async () => {
    const first = await getCalendar(owner, TIE_WEEK, { providers: ["calendar"] });
    const mine = first.events.filter((row) => row.sourceId.startsWith(PREFIX)).map((row) => row.sourceId);
    expect(mine).toEqual([`${PREFIX}tie_z_early`, `${PREFIX}tie_a`, `${PREFIX}tie_b`, `${PREFIX}tie_c`]);
    const again = await getCalendar(owner, TIE_WEEK, { providers: ["calendar"] });
    expect(again.events.map((row) => row.id)).toEqual(first.events.map((row) => row.id));
    // Positive control for the bound below: a week under every limit is not truncated.
    expect(first.meta.truncated).toBeUndefined();
    expect(first.meta.cappedProviders).toBeUndefined();
  });

  it("a source read that stops at SOURCE_LIMIT marks the range truncated and names the source (DT-05)", async () => {
    const result = await getCalendar(owner, FULL_WEEK, { providers: ["calendar"] });
    expect(result.events.filter((row) => row.sourceId.startsWith(`${PREFIX}full_`))).toHaveLength(SOURCE_LIMIT);
    expect(result.meta.truncated).toBe(true);
    expect(result.meta.cappedProviders).toEqual(["calendar"]);
  });
});
