import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { addLocalDays, localDate } from "@/lib/modules/calendar/calendar.time";
import { createMeetingSchema } from "@/lib/modules/meetings/meeting.schema";
import { createMeeting } from "@/lib/modules/meetings/meeting.service";
import { cleanupSessions, loginAs, PROJECT, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";

/**
 * AUD-09 — the meeting edit contract over its route, against the real
 * database (§4, §5; FV-04, FV-05, FV-07, FV-09, FV-10, FV-22). The `meetings`
 * row is the oracle.
 */

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { PATCH } = await import("@/app/api/meetings/[meetingId]/route");

const ZONE = "Europe/Tirane";
const TITLE = "aud09b meeting";
const meetings = new Set<string>();

afterEach(async () => {
  actAs(null);
  const ids = [...meetings];
  if (ids.length === 0) return;
  const reminders = await prisma.calendarReminder.findMany({ where: { meetingId: { in: ids } }, select: { id: true } });
  await prisma.calendarReminderDelivery.deleteMany({ where: { reminderId: { in: reminders.map((row) => row.id) } } });
  await prisma.calendarReminder.deleteMany({ where: { meetingId: { in: ids } } });
  await prisma.meetingAgendaItem.deleteMany({ where: { meetingId: { in: ids } } });
  await prisma.meetingParticipant.deleteMany({ where: { meetingId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
  const threads = await prisma.collaborationThread.findMany({ where: { parentId: { in: ids } }, select: { id: true } });
  await prisma.subscription.deleteMany({ where: { threadId: { in: threads.map((row) => row.id) } } });
  await prisma.collaborationThread.deleteMany({ where: { id: { in: threads.map((row) => row.id) } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.meeting.deleteMany({ where: { id: { in: ids } } });
  meetings.clear();
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function patch(meetingId: string, body: unknown) {
  const response = await PATCH(
    new Request(`http://localhost/api/meetings/${meetingId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ meetingId }) },
  );
  return { status: response.status, body: (await response.json()) as Json };
}

const day = () => addLocalDays(localDate(new Date(), ZONE), 5);

async function onlineProjectMeeting(context: UserContext) {
  const result = await createMeeting(
    context,
    createMeetingSchema.parse({
      title: TITLE,
      description: "Coordinate the façade package",
      meetingType: "COORDINATION",
      visibility: "PROJECT",
      projectId: PROJECT.a,
      date: day(),
      startTime: "10:00",
      endTime: "11:00",
      locationType: "ONLINE",
      onlineUrl: "https://meet.example/aud09",
    }),
  );
  meetings.add(result.meeting.id);
  return result.meeting;
}

/** The fields an edit always sends: identity and schedule. */
const whole = (version: number, overrides: Record<string, unknown> = {}) => ({
  title: TITLE,
  meetingType: "COORDINATION",
  visibility: "PROJECT",
  date: day(),
  startTime: "10:00",
  endTime: "11:00",
  version,
  ...overrides,
});

describe("partial updates (FV-05)", () => {
  it("an edit that leaves the optional fields out keeps them", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const meeting = await onlineProjectMeeting(pm);
    actAs(pm);

    const saved = await patch(meeting.id, whole(meeting.version, { title: `${TITLE} renamed` }));
    expect(saved.status).toBe(200);
    // Before AUD-09 the location type fell back to Unspecified and the
    // description, link and project were erased.
    expect(await prisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } })).toMatchObject({
      title: `${TITLE} renamed`,
      description: "Coordinate the façade package",
      locationType: "ONLINE",
      onlineUrl: "https://meet.example/aud09",
      projectId: PROJECT.a,
      version: meeting.version + 1,
    });
  });

  it("null clears on purpose, and the schedule is judged in the company's zone", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const meeting = await onlineProjectMeeting(pm);
    actAs(pm);

    const cleared = await patch(meeting.id, whole(meeting.version, { description: null, startTime: "14:30", endTime: "15:15" }));
    expect(cleared.status).toBe(200);
    const row = await prisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
    expect(row.description).toBeNull();
    expect(row.onlineUrl).toBe("https://meet.example/aud09");
    // Wall-clock times in Europe/Tirane, stored as instants (PRD #40 §170).
    expect(new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(row.startsAt)).toBe("14:30");
    expect(row.endsAt.getTime() - row.startsAt.getTime()).toBe(45 * 60_000);
  });
});

describe("refusals on their fields (FV-04, FV-07, FV-09)", () => {
  it("refuses an end before the start, an impossible date, a cleared project and a forged one", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const meeting = await onlineProjectMeeting(pm);
    actAs(pm);

    for (const [body, field] of [
      [{ startTime: "11:00", endTime: "10:30" }, "endTime"],
      [{ startTime: "11:00", endTime: "11:00" }, "endTime"],
      [{ date: "2031-02-30" }, "date"],
      [{ startTime: "25:00" }, "startTime"],
      [{ projectId: null }, "projectId"],
      [{ projectId: PROJECT.b }, "projectId"],
      [{ onlineUrl: "http://insecure.example" }, "onlineUrl"],
      [{ locationType: "TELEPATHY" }, "locationType"],
    ] as const) {
      const refused = await patch(meeting.id, whole(meeting.version, body));
      expect(refused.status, JSON.stringify(body)).toBe(422);
      expect(refused.body.error.details, JSON.stringify(body)).toHaveProperty(field);
    }
    expect(await prisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } })).toMatchObject({ version: meeting.version, projectId: PROJECT.a, onlineUrl: "https://meet.example/aud09" });

    // Positive control: moving it to people-only visibility and clearing the project together is accepted.
    const moved = await patch(meeting.id, whole(meeting.version, { visibility: "PARTICIPANTS", projectId: null }));
    expect(moved.status).toBe(200);
    expect(await prisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } })).toMatchObject({ visibility: "PARTICIPANTS", projectId: null, locationType: "ONLINE" });
  });

  it("a stale version is a conflict, not an overwrite", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const meeting = await onlineProjectMeeting(pm);
    actAs(pm);
    expect((await patch(meeting.id, whole(meeting.version, { title: `${TITLE} first` }))).status).toBe(200);
    const stale = await patch(meeting.id, whole(meeting.version, { title: `${TITLE} stale` }));
    expect(stale.status).toBe(409);
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } })).title).toBe(`${TITLE} first`);
  });
});
