import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/database/prisma";
import { createSession, endOwnSession, revokeSessions, SESSION_TTL_MS } from "@/lib/auth/session-store";
import { resolvePlatformContextForSession } from "@/lib/context/platform-context";

let userId: string;
beforeAll(async () => {
  const user = await prisma.user.create({ data: {
    username: `work-session-${randomUUID()}`, firstName: "Session", lastName: "Test",
    passwordHash: "unusable-test-account", platformAccess: { create: { roleKey: "PLATFORM_ADMIN" } },
  } });
  userId = user.id;
});
afterAll(async () => {
  if (!userId) return;
  await prisma.authEvent.deleteMany({ where: { userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.platformAccess.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
});
async function fresh() {
  const row = await createSession({ userId, membershipId: null, companyId: null });
  return row;
}
describe("real database work-session lifecycle, independent of demo seeds", () => {
  it("creates fixed eight-hour timestamps and a new identity for each login", async () => {
    const first = await fresh();
    const second = await fresh();
    expect(first.id).not.toBe(second.id);
    const row = await prisma.session.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(SESSION_TTL_MS);
    await resolvePlatformContextForSession(first.id);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: first.id } })).expiresAt).toEqual(row.expiresAt);
  });
  it("accepts a 7h59m session, rejects expiration, and audits it only once", async () => {
    const row = await fresh();
    await prisma.session.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - SESSION_TTL_MS + 60_000), expiresAt: new Date(Date.now() + 60_000) } });
    expect((await resolvePlatformContextForSession(row.id)).ok).toBe(true);
    await prisma.session.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    for (let i = 0; i < 2; i++) expect(await resolvePlatformContextForSession(row.id)).toEqual({ ok: false, reason: "SESSION_EXPIRED" });
    expect(await prisma.authEvent.count({ where: { sessionId: row.id, type: "SESSION_EXPIRED" } })).toBe(1);
  });
  it("revokes a platform session without a company, rejects replay, and tolerates duplicate logout", async () => {
    const row = await fresh();
    expect(await endOwnSession({ sessionId: row.id, userId })).toEqual({ ended: true, companyId: null });
    expect(await endOwnSession({ sessionId: row.id, userId })).toEqual({ ended: false, companyId: null });
    expect(await resolvePlatformContextForSession(row.id)).toEqual({ ok: false, reason: "SESSION_EXPIRED" });
    expect(await prisma.authEvent.count({ where: { sessionId: row.id, type: "SESSION_REVOKED" } })).toBe(1);
  });
  it("does not revoke somebody else's session", async () => {
    const row = await fresh();
    expect((await endOwnSession({ sessionId: row.id, userId: "other-person" })).ended).toBe(false);
    expect((await resolvePlatformContextForSession(row.id)).ok).toBe(true);
  });
  it("audits bulk revocation for each session and preserves the excluded session", async () => {
    const kept = await fresh();
    const removed = await fresh();
    await revokeSessions(prisma, { userId, exceptSessionId: kept.id });
    expect((await resolvePlatformContextForSession(kept.id)).ok).toBe(true);
    expect((await resolvePlatformContextForSession(removed.id)).ok).toBe(false);
    expect(await prisma.authEvent.count({ where: { sessionId: removed.id, type: "SESSION_REVOKED" } })).toBe(1);
    expect(await prisma.authEvent.count({ where: { sessionId: kept.id, type: "SESSION_REVOKED" } })).toBe(0);
  });
  it("rolls back revocation and its audit together with a failed account transaction", async () => {
    const row = await fresh();
    await expect(prisma.$transaction(async (tx) => {
      await revokeSessions(tx, { sessionId: row.id });
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect((await resolvePlatformContextForSession(row.id)).ok).toBe(true);
    expect(await prisma.authEvent.count({ where: { sessionId: row.id, type: "SESSION_REVOKED" } })).toBe(0);
  });
  it("ends demo impersonation when another-device revocation removes the session", async () => {
    const row = await fresh();
    await prisma.authEvent.create({ data: { type: "IMPERSONATION_STARTED", userId, sessionId: row.id } });
    await revokeSessions(prisma, { sessionId: row.id });
    expect(await prisma.authEvent.count({ where: { sessionId: row.id, type: "IMPERSONATION_ENDED" } })).toBe(1);
  });
  it("records simultaneous duplicate revocations only once", async () => {
    const row = await fresh();
    const results = await Promise.all([endOwnSession({ sessionId: row.id, userId }), endOwnSession({ sessionId: row.id, userId })]);
    expect(results.filter((result) => result.ended)).toHaveLength(1);
    expect(await prisma.authEvent.count({ where: { sessionId: row.id, type: "SESSION_REVOKED" } })).toBe(1);
  });

});
