import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { dispatchNotifications } from "@/lib/core/notifications/notification.dispatch";
import { updatePreference } from "@/lib/core/notifications/notification.preferences";
import { loadRecord } from "@/lib/core/records/record.registry";
import { globalSearch } from "@/lib/core/search/search.service";
import { findConflicts, getAvailability } from "@/lib/modules/calendar/calendar.availability";
import { calendarProviders } from "@/lib/modules/calendar/calendar.providers";
import { getCalendar } from "@/lib/modules/calendar/calendar.query";
import { runCalendarReminders } from "@/lib/modules/calendar/calendar.reminders";
import { createEventSchema, rangeQuerySchema, updateEventSchema } from "@/lib/modules/calendar/calendar.schema";
import {
  addParticipants,
  addReminder,
  archiveEvent,
  createEvent,
  getEvent,
  moveEvent,
  removeParticipant,
  removeReminder,
  respondToEvent,
  updateEvent,
} from "@/lib/modules/calendar/calendar.service";
import { addLocalDays, instantFromLocal, localDate } from "@/lib/modules/calendar/calendar.time";
import { financeProvider } from "@/lib/modules/calendar/providers/finance.provider";
import { accessibleProjectIds } from "@/lib/access/scope";
import { cleanupSessions, loginAs, loginAsEmail, prisma, PROJECT } from "../../helpers";

/**
 * The calendar, against the real database (PRD #39 §174-§195).
 */

const ZONE = "Europe/Tirane";
const created: string[] = [];
const TITLE = "CALTEST";

afterEach(async () => {
  if (created.length === 0) return;
  const reminders = await prisma.calendarReminder.findMany({ where: { eventId: { in: created } }, select: { id: true } });
  await prisma.calendarReminderDelivery.deleteMany({ where: { reminderId: { in: reminders.map((row) => row.id) } } });
  await prisma.calendarReminder.deleteMany({ where: { eventId: { in: created } } });
  await prisma.calendarEventParticipant.deleteMany({ where: { eventId: { in: created } } });
  await prisma.notification.deleteMany({ where: { entityType: "calendar_event", entityId: { in: created } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityType: "calendar_event", entityId: { in: created } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: created } } });
  await prisma.calendarEvent.deleteMany({ where: { id: { in: created } } });
  created.length = 0;
  await prisma.notificationPreference.deleteMany({ where: { memberId: "member_engineer", category: "calendar" } });
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

const today = () => localDate(new Date(), ZONE);
const monthRange = () => ({
  from: instantFromLocal(addLocalDays(today(), -14), "00:00", ZONE),
  to: instantFromLocal(addLocalDays(today(), 45), "00:00", ZONE),
});

async function make(context: UserContext, overrides: Record<string, unknown> = {}) {
  const input = createEventSchema.parse({
    title: `${TITLE} ${Math.random().toString(36).slice(2, 7)}`,
    eventType: "PERSONAL_EVENT",
    visibility: "PRIVATE",
    startDate: addLocalDays(today(), 3),
    startTime: "10:00",
    endTime: "11:00",
    ...overrides,
  });
  const result = await createEvent(context, input);
  created.push(result.event.id);
  return result;
}

const idsOf = async (context: UserContext) => (await getCalendar(context, monthRange(), {})).events.map((row) => row.sourceId);

describe("provider architecture (§11-§14, §202)", () => {
  it("registers every required provider once", () => {
    const keys = calendarProviders.all().map((provider) => provider.key);
    for (const key of ["calendar", "tasks", "hr", "finance", "legal", "procurement", "qaqc", "hse", "documents"]) expect(keys).toContain(key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("rejects a range longer than 93 days, or backwards", () => {
    const from = new Date("2026-01-01T00:00:00Z").toISOString();
    expect(() => rangeQuerySchema.parse({ from, to: new Date("2026-04-05T00:00:00Z").toISOString() })).toThrow();
    expect(() => rangeQuerySchema.parse({ from, to: from })).toThrow();
  });

  it("never queries a provider whose module is switched off (§177)", async () => {
    const owner = await loginAs("OWNER");
    const spy = vi.spyOn(financeProvider, "getEvents");
    const financeOff: UserContext = {
      ...owner,
      moduleAccess: { ...owner.moduleAccess, finance: { ...owner.moduleAccess.finance, enabled: false, accessLevel: "NONE", permissions: [] } },
      permissions: owner.permissions.filter((permission) => !permission.startsWith("finance.")),
    };
    const response = await getCalendar(financeOff, monthRange(), {});
    expect(spy).not.toHaveBeenCalled();
    expect(response.events.some((row) => row.category === "FINANCE")).toBe(false);
    spy.mockRestore();
  });
});

describe("isolation, permission and scope (§176-§179)", () => {
  it("gives another company nothing of this company's calendar", async () => {
    const owner = await loginAs("OWNER");
    const ownerB = await loginAsEmail("owner-b@nesto.test");
    const event = await make(owner, { eventType: "COMPANY_EVENT", visibility: "COMPANY" });
    const bIds = await idsOf(ownerB);
    expect(bIds).not.toContain(event.event.id);
    expect(bIds).not.toContain("calendar_training_001");
    await expect(getEvent(ownerB, event.event.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("shows no finance dates to a role without Finance (§178)", async () => {
    const qaqc = await loginAs("QAQC");
    const response = await getCalendar(qaqc, monthRange(), {});
    expect(response.events.some((row) => row.category === "FINANCE")).toBe(false);
    expect(Object.keys(response.meta.providerCounts)).not.toContain("finance");
  });

  it("keeps an engineer's task dates inside their projects (§179)", async () => {
    const engineer = await loginAs("ENGINEER");
    const allowed = new Set(await accessibleProjectIds(engineer));
    const tasks = (await getCalendar(engineer, monthRange(), { categories: ["TASK"] })).events;
    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks) if (task.project) expect(allowed.has(task.project.id)).toBe(true);
  });

  it("opens every source event onto its owning record (§191)", async () => {
    const owner = await loginAs("OWNER");
    const patterns: Record<string, RegExp> = {
      task: /^\/tasks\/[^/]+$/,
      invoice: /^\/finance\/invoices\/[^/]+$/,
      contract: /^\/contracts\/[^/]+$/,
      obligation: /^\/contracts\/[^/]+\/obligations$/,
      amendment: /^\/contracts\/[^/]+\/amendments\/[^/]+$/,
      purchase_request: /^\/procurement\/requests\/[^/]+$/,
      rfq: /^\/procurement\/rfqs\/[^/]+$/,
      purchase_order: /^\/procurement\/orders\/[^/]+$/,
      quality_inspection: /^\/qaqc\/inspections\/[^/]+$/,
      corrective_action: /^\/qaqc\/corrective-actions\/[^/]+$/,
      non_conformance_report: /^\/qaqc\/ncrs\/[^/]+$/,
      hse_inspection: /^\/hse\/inspections\/[^/]+$/,
      toolbox_talk: /^\/hse\/toolbox-talks\/[^/]+$/,
      work_permit: /^\/hse\/permits\/[^/]+$/,
      risk_assessment: /^\/hse\/risk-assessments\/[^/]+$/,
      hse_action: /^\/hse\/actions\/[^/]+$/,
      leave_request: /^\/hr\/leave\/[^/]+$/,
      calendar_event: /^\/calendar\?event=[^&]+$/,
      document_review: /^\/documents\/[^/]+$/,
      meeting: /^\/meetings\/[^/]+$/,
      project_milestone: /^\/projects\/[^/]+\/planning\?milestone=[^&]+$/,
      announcement: /^\/announcements\/[^/]+$/,
      rfi: /^\/projects\/[^/]+\/engineering\/rfis\/[^/]+$/,
      technical_submittal: /^\/projects\/[^/]+\/engineering\/submittals\/[^/]+$/,
      contractor_compliance: /^\/contractors\/[^/]+\/compliance\?item=[^&]+$/,
    };
    const events = (await getCalendar(owner, monthRange(), {})).events;
    for (const event of events) {
      expect(patterns[event.sourceType], `unexpected source ${event.sourceType}`).toBeDefined();
      expect(event.href).toMatch(patterns[event.sourceType]);
      expect(event.editable && event.sourceType !== "calendar_event").toBe(false);
    }
  });
});

describe("visibility of Calendar-owned events (§49-§53, §181)", () => {
  it("keeps a private event to its creator", async () => {
    const engineer = await loginAs("ENGINEER");
    const { event } = await make(engineer);
    expect(await idsOf(engineer)).toContain(event.id);
    for (const role of ["PROJECT_MANAGER", "OWNER", "HR"] as const) {
      expect(await idsOf(await loginAs(role))).not.toContain(event.id);
    }
  });

  it("shows selected-member events to the chosen people only", async () => {
    const legal = await loginAs("LEGAL");
    const finance = await loginAs("FINANCE");
    const { event } = await make(legal, { eventType: "TEAM_EVENT", visibility: "SELECTED_MEMBERS", participantIds: [finance.membershipId] });
    expect(await idsOf(finance)).toContain(event.id);
    expect(await idsOf(await loginAs("SALES"))).not.toContain(event.id);
  });

  it("resolves project events through project access", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const { event } = await make(pm, { eventType: "TEAM_EVENT", visibility: "PROJECT", projectId: PROJECT.a });
    expect(await idsOf(pm)).toContain(event.id);
    for (const role of ["ENGINEER", "ARCHITECT", "QAQC", "HSE", "VIEWER"] as const) {
      const reader = await loginAs(role);
      const canSeeProject = (await accessibleProjectIds(reader)).includes(PROJECT.a);
      expect((await idsOf(reader)).includes(event.id), role).toBe(canSeeProject);
    }
  });

  it("resolves department events through the member's department", async () => {
    const finance = await loginAs("FINANCE");
    const { event } = await make(finance, { eventType: "INTERNAL_DEADLINE", visibility: "DEPARTMENT", departmentId: finance.department!.id, allDay: true, startTime: undefined, endTime: undefined });
    expect(await idsOf(finance)).toContain(event.id);
    expect(await idsOf(await loginAs("LEGAL"))).not.toContain(event.id);
  });

  it("does not name a project the reader cannot open, on an event they were invited to (§46)", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const sales = await loginAs("SALES");
    const { event } = await make(pm, { eventType: "TEAM_EVENT", visibility: "PROJECT", projectId: PROJECT.a, participantIds: [sales.membershipId] });
    const salesCanSeeProject = (await accessibleProjectIds(sales)).includes(PROJECT.a);
    const detail = await getEvent(sales, event.id);
    expect(detail.project === null).toBe(!salesCanSeeProject);
  });
});

describe("HR privacy and busy-only (§47, §48, §180, §182)", () => {
  const range = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-20T00:00:00Z") };

  it("shows the leave type to those who decide leave, 'Unavailable' to the CEO and the project manager, and nothing to others", async () => {
    const find = async (role: Parameters<typeof loginAs>[0]) =>
      (await getCalendar(await loginAs(role), range, {})).events.filter((row) => row.sourceId === "leave_006");

    const hr = await find("HR");
    expect(hr).toHaveLength(1);
    expect(hr[0].title).toContain("Parental leave");

    for (const role of ["CEO", "PROJECT_MANAGER"] as const) {
      const rows = await find(role);
      for (const row of rows) {
        expect(row.privacyMode).toBe("BUSY_ONLY");
        expect(row.title).toMatch(/— Unavailable$/);
        expect(row.title).not.toMatch(/parental|annual|sick/i);
      }
    }
    expect(await find("ENGINEER")).toHaveLength(0);
    expect(await find("VIEWER")).toHaveLength(0);
  });

  it("carries nothing in a busy-only event beyond a name and a time", async () => {
    const ceo = await loginAs("CEO");
    const busy = (await getCalendar(ceo, range, {})).events.filter((row) => row.privacyMode === "BUSY_ONLY");
    expect(busy.length).toBeGreaterThan(0);
    for (const row of busy) {
      expect(row.href).toBe("");
      expect(row.project).toBeUndefined();
      expect(row.participants).toBeUndefined();
      expect(row.status).toBeUndefined();
      expect(row.metadata).toBeUndefined();
      expect(row.category).not.toBe("HR");
    }
  });
});

describe("creating, editing and archiving (§43, §68, §190, §194, §195)", () => {
  it("refuses the Viewer, and company-wide events to people who do not manage them", async () => {
    await expect(make(await loginAs("VIEWER"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(make(await loginAs("ENGINEER"), { eventType: "COMPANY_HOLIDAY", visibility: "COMPANY" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { event } = await make(await loginAs("OWNER"), { eventType: "COMPANY_HOLIDAY", visibility: "COMPANY", allDay: true, startTime: undefined, endTime: undefined });
    expect(event.capabilities.canEdit).toBe(true);
  });

  it("rejects bad input: order, foreign participant, project and department, recurrence, reminders, title", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const base = { title: "x", eventType: "TEAM_EVENT", visibility: "SELECTED_MEMBERS", startDate: "2026-10-01", startTime: "10:00", participantIds: ["member_engineer"] };
    expect(() => createEventSchema.parse({ ...base, endTime: "09:00" })).toThrow();
    expect(() => createEventSchema.parse({ ...base, visibility: "EVERYONE" })).toThrow();
    expect(() => createEventSchema.parse({ ...base, title: "x".repeat(181) })).toThrow();
    expect(() => createEventSchema.parse({ ...base, recurrence: { frequency: "HOURLY", interval: 1 } })).toThrow();
    expect(() => createEventSchema.parse({ ...base, reminders: [10, 30, 60, 1440].map((minutesBefore) => ({ minutesBefore })) })).toThrow();
    await expect(make(pm, { eventType: "TEAM_EVENT", visibility: "SELECTED_MEMBERS", participantIds: ["member_owner_b"] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(make(pm, { eventType: "TEAM_EVENT", visibility: "PROJECT", projectId: PROJECT.companyB })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const foreignDepartment = await prisma.department.findFirstOrThrow({ where: { companyId: "company_demo_b" } });
    const owner = await loginAs("OWNER");
    await expect(make(owner, { eventType: "TRAINING", visibility: "DEPARTMENT", departmentId: foreignDepartment.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("lets only the creator edit their event, and a manager edit company events (event IDOR)", async () => {
    const engineer = await loginAs("ENGINEER");
    const pm = await loginAs("PROJECT_MANAGER");
    const { event } = await make(engineer, { eventType: "TEAM_EVENT", visibility: "SELECTED_MEMBERS", participantIds: [pm.membershipId] });
    const edit = updateEventSchema.parse({ title: "Changed", eventType: "TEAM_EVENT", visibility: "SELECTED_MEMBERS", startDate: addLocalDays(today(), 4), startTime: "09:00", endTime: "10:00" });
    await expect(updateEvent(pm, event.id, edit)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateEvent(await loginAs("OWNER"), event.id, edit)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const updated = await updateEvent(engineer, event.id, edit);
    expect(updated.event.title).toBe("Changed");

    // Archive is not delete: the row stays, readers stop seeing it.
    await expect(archiveEvent(pm, event.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await archiveEvent(engineer, event.id);
    expect((await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } })).archivedAt).not.toBeNull();
    expect(await idsOf(pm)).not.toContain(event.id);
  });

  it("records a visibility change as an access decision", async () => {
    const engineer = await loginAs("ENGINEER");
    const { event } = await make(engineer);
    await updateEvent(engineer, event.id, updateEventSchema.parse({
      title: "Now shared",
      eventType: "TEAM_EVENT",
      visibility: "SELECTED_MEMBERS",
      startDate: addLocalDays(today(), 3),
      startTime: "10:00",
      endTime: "11:00",
      participantIds: ["member_architect"],
    }));
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: event.id, actionKey: "CALENDAR_VISIBILITY_CHANGED" } });
    expect(audit).not.toBeNull();
    await prisma.auditEvent.deleteMany({ where: { entityId: event.id } });
  });

  it("drags a single timed event, never one occurrence of a series (§82, §190)", async () => {
    const engineer = await loginAs("ENGINEER");
    const { event } = await make(engineer);
    const startsAt = instantFromLocal(addLocalDays(today(), 5), "14:00", ZONE);
    const moved = await moveEvent(engineer, event.id, { startsAt });
    expect(moved.event.startsAt).toBe(startsAt.toISOString());
    expect(new Date(moved.event.endsAt!).getTime() - startsAt.getTime()).toBe(3_600_000);

    const series = await make(engineer, { recurrence: { frequency: "WEEKLY", interval: 1 } });
    await expect(moveEvent(engineer, series.event.id, { startsAt })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(moveEvent(await loginAs("ARCHITECT"), event.id, { startsAt })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("guards participants: only editors change them, and anyone may leave (participant IDOR)", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const architect = await loginAs("ARCHITECT");
    const { event } = await make(pm, { eventType: "TEAM_EVENT", visibility: "SELECTED_MEMBERS", participantIds: [engineer.membershipId] });
    await expect(addParticipants(engineer, event.id, [architect.membershipId])).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(removeParticipant(architect, event.id, engineer.membershipId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(addParticipants(pm, event.id, ["member_owner_b"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const detail = await respondToEvent(engineer, event.id, "TENTATIVE");
    expect(detail.myStatus).toBe("TENTATIVE");
    await removeParticipant(engineer, event.id, engineer.membershipId);
    await expect(getEvent(engineer, event.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("aims reminders at the caller only, three at most (reminder target injection)", async () => {
    const engineer = await loginAs("ENGINEER");
    const pm = await loginAs("PROJECT_MANAGER");
    const { event } = await make(engineer, { reminders: [{ minutesBefore: 10 }] });
    await addReminder(engineer, event.id, { minutesBefore: 30, channel: "IN_APP" });
    await addReminder(engineer, event.id, { minutesBefore: 60, channel: "IN_APP" });
    await expect(addReminder(engineer, event.id, { minutesBefore: 1440, channel: "IN_APP" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(addReminder(pm, event.id, { minutesBefore: 10, channel: "IN_APP" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const mine = await prisma.calendarReminder.findFirstOrThrow({ where: { eventId: event.id } });
    expect(mine.memberId).toBe(engineer.membershipId);
    await expect(removeReminder(pm, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("reminders (§109, §110, §187)", () => {
  it("fires once per occurrence, is delivered through the dispatcher, and never twice", async () => {
    const engineer = await loginAs("ENGINEER");
    const soon = new Date(Date.now() + 20 * 60_000);
    const date = localDate(soon, ZONE);
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(soon);
    const { event } = await make(engineer, { startDate: date, startTime: time, endTime: undefined, reminders: [{ minutesBefore: 30 }] });

    const first = await runCalendarReminders();
    expect(first.fired).toBeGreaterThanOrEqual(1);
    const second = await runCalendarReminders();
    expect(await prisma.calendarReminderDelivery.count({ where: { reminder: { eventId: event.id } } })).toBe(1);
    expect(second.fired).toBe(0);

    await dispatchNotifications(500);
    const rows = await prisma.notification.findMany({ where: { entityType: "calendar_event", entityId: event.id, eventType: "CALENDAR_REMINDER" } });
    expect(rows.map((row) => row.recipientMemberId)).toEqual([engineer.membershipId]);
    expect((await loadRecord(engineer, "calendar_event", event.id))?.href).toBe(`/calendar?event=${event.id}`);
  });

  it("reminds about the next occurrence of a series, and respects a switched-off preference", async () => {
    const engineer = await loginAs("ENGINEER");
    await updatePreference(engineer, { category: "calendar", inAppEnabled: false, emailEnabled: false });
    const soon = new Date(Date.now() + 10 * 60_000 - 7 * 86_400_000);
    const { event } = await make(engineer, {
      startDate: localDate(soon, ZONE),
      startTime: new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(soon),
      endTime: undefined,
      reminders: [{ minutesBefore: 30 }],
      recurrence: { frequency: "WEEKLY", interval: 1 },
    });
    await runCalendarReminders();
    const delivery = await prisma.calendarReminderDelivery.findFirstOrThrow({ where: { reminder: { eventId: event.id } } });
    expect(delivery.occurrenceStartsAt.getTime()).toBeGreaterThan(Date.now());
    await dispatchNotifications(500);
    expect(await prisma.notification.count({ where: { entityId: event.id, eventType: "CALENDAR_REMINDER" } })).toBe(0);
  });
});

describe("availability and conflicts (§86-§90, §188, §189)", () => {
  it("returns busy intervals with no event detail, and ignores declined invitations", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const { event } = await make(engineer, { title: `${TITLE} secret dentist` });
    const day = addLocalDays(today(), 3);
    const window = { from: instantFromLocal(day, "00:00", ZONE), to: instantFromLocal(addLocalDays(day, 1), "00:00", ZONE) };
    const answer = await getAvailability(pm, { memberIds: [engineer.membershipId, "member_owner_b"], ...window }, ZONE);
    expect(answer.map((row) => row.memberId)).toEqual([engineer.membershipId]);
    expect(JSON.stringify(answer)).not.toContain("dentist");
    expect(answer[0].busy.some((slot) => slot.startsAt === event.startsAt)).toBe(true);

    const invite = await make(pm, { eventType: "TEAM_EVENT", visibility: "SELECTED_MEMBERS", participantIds: [engineer.membershipId], startTime: "15:00", endTime: "16:00" });
    await respondToEvent(engineer, invite.event.id, "DECLINED");
    const after = await getAvailability(pm, { memberIds: [engineer.membershipId], ...window }, ZONE);
    expect(after[0].busy.some((slot) => slot.startsAt === invite.event.startsAt)).toBe(false);

    await expect(getAvailability(await loginAs("VIEWER"), { memberIds: [engineer.membershipId], ...window }, ZONE)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("warns about an overlapping participant without refusing the event", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    await make(engineer);
    const clash = await make(pm, { eventType: "TEAM_EVENT", visibility: "SELECTED_MEMBERS", participantIds: [engineer.membershipId], startTime: "10:30", endTime: "11:30" });
    expect(clash.conflicts.map((row) => row.memberId)).toEqual([engineer.membershipId]);
    const direct = await findConflicts(pm, [engineer.membershipId], { startsAt: new Date(clash.event.startsAt), endsAt: new Date(clash.event.endsAt!) }, { excludeEventId: clash.event.id, timezone: ZONE });
    expect(direct).toHaveLength(1);
  });
});

describe("search (§115)", () => {
  it("finds a Calendar-owned event only for those who can see it", async () => {
    const engineer = await loginAs("ENGINEER");
    const { event } = await make(engineer, { title: `${TITLE} findable zebra` });
    const mine = await globalSearch(engineer, "findable zebra");
    expect(mine.results.some((row) => row.entityId === event.id)).toBe(true);
    const theirs = await globalSearch(await loginAs("OWNER"), "findable zebra");
    expect(theirs.results.some((row) => row.entityId === event.id)).toBe(false);
  });
});

describe("performance (§118, §205)", () => {
  it("answers a month for the widest reader well inside the P95 target", async () => {
    const owner = await loginAs("OWNER");
    await getCalendar(owner, monthRange(), {}); // warm the connection pool
    const timings: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const started = performance.now();
      const response = await getCalendar(owner, monthRange(), {});
      timings.push(performance.now() - started);
      expect(response.meta.partialFailureProviders).toBeUndefined();
    }
    timings.sort((a, b) => a - b);
    // Median under the 300 ms P50 target; the slowest of five under the 1.2 s P95.
    expect(timings[2]).toBeLessThan(300);
    expect(timings[4]).toBeLessThan(1_200);
  });
});
