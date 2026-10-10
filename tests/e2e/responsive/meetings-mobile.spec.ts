import { expect, test } from "../pw";

import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";
import { removeMeetings } from "../meetings-cleanup";

/**
 * Meetings on a phone (PRD #40 §125-§127, §300): see what is coming up, reply,
 * open a meeting, add an action in meeting mode, read final minutes.
 */

const PREFIX = "E2E mobile meeting";
const ZONE = "Europe/Tirane";

async function member(email: string) {
  return db.companyMember.findFirstOrThrow({ where: { user: { email } }, select: { id: true, companyId: true, user: { select: { firstName: true, lastName: true } } } });
}

test.afterAll(async () => {
  await removeMeetings(PREFIX);
  await db.$disconnect();
});

test("views upcoming meetings, replies from the sticky bar, and reads final minutes", async ({ page }) => {
  const pm = await member("pm@nesto.test");
  const engineer = await member("engineer@nesto.test");
  const start = new Date(Date.now() + 2 * 86_400_000);
  const title = `${PREFIX} site walk ${Date.now().toString(36)}`;
  const meeting = await db.meeting.create({
    data: {
      companyId: pm.companyId,
      createdByMemberId: pm.id,
      organizerMemberId: pm.id,
      title,
      meetingType: "SITE",
      visibility: "PARTICIPANTS",
      startsAt: start,
      endsAt: new Date(start.getTime() + 3_600_000),
      timezone: ZONE,
      locationType: "IN_PERSON",
      locationText: "Gate 3",
      participants: {
        create: [
          { memberId: pm.id, companyId: pm.companyId, role: "ORGANIZER", response: "ACCEPTED", displayName: "Alex Morgan" },
          { memberId: engineer.id, companyId: pm.companyId, role: "ATTENDEE", response: "PENDING", displayName: "Ethan Cole" },
        ],
      },
    },
  });

  await signIn(page, "ENGINEER", { to: "/meetings/mine" });
  const row = page.locator("#nesto-main").getByTestId("meeting-row").filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Awaiting reply");
  await row.click();

  await expect(page).toHaveURL(new RegExp(`/meetings/${meeting.id}`));
  const sticky = page.getByTestId("meeting-sticky-actions");
  await expect(sticky).toBeVisible();
  await sticky.getByRole("button", { name: "Accept" }).click();
  await expect(sticky.getByRole("button", { name: "Accept" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await db.meetingParticipant.findUniqueOrThrow({ where: { meetingId_memberId: { meetingId: meeting.id, memberId: engineer.id } } })).response).toBe("ACCEPTED");

  // Last week's seeded coordination: final minutes read as a record on a phone.
  await page.goto("/meetings/meeting_riverside_000?tab=minutes");
  await expect(mainRegion(page).getByTestId("minutes-record")).toContainText("Level 3 slab pour confirmed");
});

test("starts a meeting and adds an action from meeting mode, one pane at a time", async ({ page }) => {
  const pm = await member("pm@nesto.test");
  const start = new Date(Date.now() + 60 * 60_000);
  const meeting = await db.meeting.create({
    data: {
      companyId: pm.companyId,
      createdByMemberId: pm.id,
      organizerMemberId: pm.id,
      title: `${PREFIX} daily huddle`,
      meetingType: "SITE",
      visibility: "PARTICIPANTS",
      startsAt: start,
      endsAt: new Date(start.getTime() + 30 * 60_000),
      timezone: ZONE,
      participants: { create: { memberId: pm.id, companyId: pm.companyId, role: "ORGANIZER", response: "ACCEPTED", displayName: "Alex Morgan" } },
    },
  });

  await signIn(page, "PROJECT_MANAGER", { to: `/meetings/${meeting.id}` });
  await page.getByTestId("meeting-sticky-actions").getByRole("button", { name: "Start" }).click();
  const mode = page.getByTestId("meeting-mode");
  await expect(mode).toBeVisible();

  await mode.getByRole("tab", { name: "Decide & act" }).click();
  await mode.getByRole("button", { name: "Action item" }).click();
  await mode.getByLabel("What needs doing").fill("Clear the access road");
  await mode.getByLabel("Owner").selectOption({ label: "Alex Morgan" });
  await mode.getByRole("button", { name: "Add action" }).click();
  await expect(mode.getByTestId("meeting-action").filter({ hasText: "Clear the access road" })).toBeVisible();

  await mode.getByRole("tab", { name: "People" }).click();
  await expect(mode.getByRole("combobox", { name: "Attendance for Alex Morgan" })).toBeVisible();
});
