import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ auth: vi.fn(), find: vi.fn(), logout: vi.fn(), expire: vi.fn(), denied: false }));
vi.mock("@/lib/auth", () => ({ auth: state.auth }));
vi.mock("@/lib/database/prisma", () => ({ prisma: { session: { findFirst: state.find } } }));
vi.mock("@/lib/actions/auth", () => ({ endSessionAction: state.logout }));
vi.mock("@/lib/auth/session-store", () => ({ expireSession: state.expire }));
vi.mock("next/headers", () => ({ cookies: async () => ({ has: () => state.denied }) }));
import { GET, POST } from "@/app/api/auth/lifecycle/route";
beforeEach(() => {
  vi.clearAllMocks();
  state.denied = false;
  state.auth.mockResolvedValue({ user: { id: "u", sessionId: "s" } });
  state.find.mockResolvedValue({ id: "s", expiresAt: new Date(Date.now() + 60_000) });
  state.logout.mockResolvedValue({ ok: true });
});
describe("workspace-independent authentication endpoint", () => {
  it("returns server remaining duration without disclosing the session credential", async () => {
    const response = await GET();
    const data = await response.json();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(data.remainingMs).toBeGreaterThan(59_000);
    expect(data.remainingMs).toBeLessThanOrEqual(60_000);
    expect(data.identity).toHaveLength(64);
    expect(data).not.toHaveProperty("sessionId");
  });
  it("rejects a local logout marker even if the old cookie still resolves", async () => {
    state.denied = true;
    expect((await GET()).status).toBe(401);
  });
  it("rejects an expired row and requests expiration auditing", async () => {
    state.find.mockResolvedValue({ id: "s", expiresAt: new Date(Date.now() - 1) });
    expect((await GET()).status).toBe(401);
    expect(state.expire).toHaveBeenCalledWith("s");
  });
  it.each([undefined, "https://attacker.example"])("refuses an untrusted origin: %s", async (origin) => {
    const response = await POST(new Request("https://nesto.test/api/auth/lifecycle", { method: "POST", headers: origin ? { origin } : {} }));
    expect(response.status).toBe(403);
    expect(state.logout).not.toHaveBeenCalled();
  });
  it("accepts the browser's Host when the internal request URL uses localhost", async () => {
    const response = await POST(new Request("http://localhost:3101/api/auth/lifecycle", { method: "POST", headers: { origin: "http://127.0.0.1:3101", host: "127.0.0.1:3101" } }));
    expect(response.status).toBe(200);
    expect(state.logout).toHaveBeenCalledOnce();
  });
});
