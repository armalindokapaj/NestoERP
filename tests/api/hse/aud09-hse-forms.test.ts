import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { instantToWallClock, wallClockToInstant } from "@/lib/modules/hse/hse.time";
import { cleanupSessions, loginAs, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";

/**
 * AUD-09 (Forms & Validation) for HSE's forms, through the server actions the
 * pages post to:
 *
 *   FV-07  a `datetime-local` value is the company's wall clock (Tirana), so
 *          a permit typed 08:30 opens at 08:30 there, not the server's 08:30;
 *          a time the clocks skip is refused on its field;
 *   FV-14/FV-20  an incident edit from a writer who may not read incident
 *          detail is refused before anything is written.
 */

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

const actions = await import("@/lib/actions/hse");

const PREFIX = "aud09c2_";
let hse: UserContext;

beforeAll(async () => {
  hse = await loginAs("HSE");
});

afterEach(() => actAs(null));

afterAll(async () => {
  const incidents = (await prisma.hseIncident.findMany({ where: { title: { startsWith: PREFIX } }, select: { id: true } })).map((row) => row.id);
  const permits = (await prisma.hseWorkPermit.findMany({ where: { title: { startsWith: PREFIX } }, select: { id: true } })).map((row) => row.id);
  const ids = [...incidents, ...permits];
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.hseApproval.deleteMany({ where: { recordId: { in: ids } } });
  await prisma.hseIncident.deleteMany({ where: { id: { in: incidents } } });
  await prisma.hseWorkPermit.deleteMany({ where: { id: { in: permits } } });
  await cleanupSessions();
});

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("wall-clock times are the company's (FV-07)", () => {
  it("converts at the zone's offset in summer and winter, and back for the edit page", () => {
    expect(wallClockToInstant("2026-07-01T08:30", "Europe/Tirane")).toEqual({ ok: true, value: "2026-07-01T06:30:00.000Z" });
    expect(wallClockToInstant("2026-12-01T08:30", "Europe/Tirane")).toEqual({ ok: true, value: "2026-12-01T07:30:00.000Z" });
    expect(instantToWallClock("2026-07-01T06:30:00.000Z", "Europe/Tirane")).toBe("2026-07-01T08:30");
    // 02:30 on the last Sunday of March never happens in Tirana.
    expect(wallClockToInstant("2027-03-28T02:30", "Europe/Tirane").ok).toBe(false);
    // An hour that happens twice is the first of the two.
    expect(wallClockToInstant("2026-10-25T02:30", "Europe/Tirane")).toEqual({ ok: true, value: "2026-10-25T00:30:00.000Z" });
  });

  const permit = (overrides: Record<string, string>) =>
    form({ permitType: "HOT_WORK", title: `${PREFIX}welding bay 2`, projectId: "project_a", locationText: "Bay 2, level 3", validFrom: "2026-10-01T08:30", validUntil: "2026-10-01T17:00", ...overrides });

  it("stores a permit window as the times typed in Tirana", async () => {
    actAs(hse);
    const result = await actions.createPermitAction(permit({}));
    expect(result).toMatchObject({ ok: true });
    const row = await prisma.hseWorkPermit.findFirstOrThrow({ where: { title: `${PREFIX}welding bay 2` }, select: { validFrom: true, validUntil: true } });
    expect(row.validFrom.toISOString()).toBe("2026-10-01T06:30:00.000Z");
    expect(row.validUntil.toISOString()).toBe("2026-10-01T15:00:00.000Z");
  });

  it("refuses a time the clocks skip, on its field, and creates nothing", async () => {
    actAs(hse);
    const result = await actions.createPermitAction(permit({ title: `${PREFIX}skipped hour`, validFrom: "2027-03-28T02:30", validUntil: "2027-03-28T09:00" }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.fieldErrors?.validFrom?.[0]).toMatch(/does not exist/);
    expect(await prisma.hseWorkPermit.count({ where: { title: `${PREFIX}skipped hour` } })).toBe(0);
  });
});

describe("incident flags and the read grant (FV-05, FV-14, FV-20)", () => {
  const incident = (overrides: Record<string, string>) =>
    form({ incidentType: "INCIDENT", title: `${PREFIX}ladder slip`, description: "A worker slipped from the second rung.", projectId: "project_a", occurredAt: "2026-09-01T10:15", severity: "LOW", ...overrides });

  it("refuses an edit from a writer who may not read incident detail before anything is written", async () => {
    actAs(hse);
    expect(await actions.createIncidentAction(incident({ injuryOccurred: "on", firstAidRequired: "on" }))).toMatchObject({ ok: true });
    const row = await prisma.hseIncident.findFirstOrThrow({ where: { title: `${PREFIX}ladder slip` }, select: { id: true, updatedAt: true } });

    // Such a writer is never shown the injury flags; the edit used to commit and then answer "refused".
    const blind: UserContext = { ...hse, permissions: hse.permissions.filter((permission) => permission !== "hse.incident.view") };
    actAs(blind);
    expect(await actions.updateIncidentAction(row.id, incident({ title: `${PREFIX}forged` }))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    const stored = await prisma.hseIncident.findUniqueOrThrow({ where: { id: row.id }, select: { title: true, injuryOccurred: true, firstAidRequired: true, updatedAt: true } });
    expect(stored).toEqual({ title: `${PREFIX}ladder slip`, injuryOccurred: true, firstAidRequired: true, updatedAt: row.updatedAt });

    // Positive control: a reader of incident detail clears flags by unticking them.
    actAs(hse);
    expect(await actions.updateIncidentAction(row.id, incident({ firstAidRequired: "on" }))).toMatchObject({ ok: true });
    expect(await prisma.hseIncident.findUniqueOrThrow({ where: { id: row.id }, select: { injuryOccurred: true, firstAidRequired: true } })).toEqual({ injuryOccurred: false, firstAidRequired: true });
  });

  it("stores the occurrence as the time typed in Tirana", async () => {
    const row = await prisma.hseIncident.findFirstOrThrow({ where: { title: { startsWith: `${PREFIX}ladder slip` } }, select: { occurredAt: true } });
    expect(row.occurredAt.toISOString()).toBe("2026-09-01T08:15:00.000Z");
  });
});
