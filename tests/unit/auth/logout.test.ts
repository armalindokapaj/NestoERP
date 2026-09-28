import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), signOut: vi.fn(), end: vi.fn(), event: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth, signOut: mocks.signOut, signIn: vi.fn() }));
vi.mock("@/lib/auth/session-store", () => ({ endOwnSession: mocks.end }));
vi.mock("@/lib/auth/events", () => ({ recordAuthEvent: mocks.event }));
vi.mock("@/lib/auth/password-recovery", () => ({}));
vi.mock("@/lib/core/security/throttle", () => ({}));
vi.mock("@/lib/core/observability/logger", () => ({ logger: { error: vi.fn() }, serialiseError: () => ({}) }));
import { endSessionAction } from "@/lib/actions/auth";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user", sessionId: "session" } });
  mocks.end.mockResolvedValue({ ended: true, companyId: null });
});
describe("canonical server logout", () => {
  it("revokes the authenticated session without resolving role or workspace", async () => {
    expect(await endSessionAction()).toEqual({ ok: true });
    expect(mocks.end).toHaveBeenCalledWith({ userId: "user", sessionId: "session" });
    expect(mocks.signOut).toHaveBeenCalledWith({ redirect: false });
  });
  it("clears cookies even when revocation fails", async () => {
    mocks.end.mockRejectedValue(new Error("offline database"));
    expect(await endSessionAction()).toEqual({ ok: false });
    expect(mocks.signOut).toHaveBeenCalled();
  });
  it("clears cookies even when reading authentication fails", async () => {
    mocks.auth.mockRejectedValue(new Error("invalid cookie"));
    await endSessionAction();
    expect(mocks.signOut).toHaveBeenCalled();
  });
  it("is idempotent for an already revoked session", async () => {
    mocks.end.mockResolvedValue({ ended: false, companyId: null });
    expect(await endSessionAction()).toEqual({ ok: true });
    expect(await endSessionAction()).toEqual({ ok: true });
    expect(mocks.event).not.toHaveBeenCalled();
  });
  it("succeeds without any credential", async () => {
    mocks.auth.mockResolvedValue(null);
    expect(await endSessionAction()).toEqual({ ok: true });
    expect(mocks.end).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalled();
  });
});
