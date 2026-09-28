import { afterEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ create: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() }));
vi.mock("@/lib/database/prisma", () => ({ prisma: { session: db } }));
vi.mock("@/lib/auth/events", () => ({ recordAuthEvent: vi.fn() }));
import { createSession, SESSION_TTL_MS } from "@/lib/auth/session-store";
import { resolveContextForSession } from "@/lib/context/build-context";

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
describe("absolute work shift", () => {
  it("creates authoritative timestamps exactly eight hours apart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T08:00:00Z"));
    db.create.mockImplementation(async ({ data }) => ({ id: "session", ...data }));
    const row = await createSession({ userId: "u", membershipId: null, companyId: null });
    expect(SESSION_TTL_MS).toBe(8 * 60 * 60 * 1000);
    expect(row.expiresAt.toISOString()).toBe("2026-09-28T16:00:00.000Z");
    expect(db.create.mock.calls[0][0].data.createdAt.toISOString()).toBe("2026-09-28T08:00:00.000Z");
  });
  it("accepts 7h59m activity without renewal, then rejects exactly at eight hours", async () => {
    vi.useFakeTimers();
    const expiresAt = new Date("2026-09-28T16:00:00Z");
    const row = { id: "s", userId: "u", membership: null, currentCompanyId: null, expiresAt, user: { status: "ACTIVE", platformAccess: { status: "ACTIVE" } } };
    db.findUnique.mockResolvedValue(row);
    db.deleteMany.mockResolvedValue({ count: 1 });
    vi.setSystemTime(new Date("2026-09-28T15:59:00Z"));
    // PLATFORM_SESSION is the resolver's valid-platform routing outcome.
    expect(await resolveContextForSession("s")).toMatchObject({ reason: "PLATFORM_SESSION" });
    expect(await resolveContextForSession("s")).toMatchObject({ reason: "PLATFORM_SESSION" });
    expect(row.expiresAt).toEqual(expiresAt);
    expect(db.deleteMany).not.toHaveBeenCalled();
    vi.setSystemTime(expiresAt);
    expect(await resolveContextForSession("s")).toEqual({ ok: false, reason: "SESSION_EXPIRED" });
    expect(db.deleteMany).toHaveBeenCalled();
  });
});
