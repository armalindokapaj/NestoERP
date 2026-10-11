import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ reset: vi.fn(), leave: vi.fn() }));
vi.mock("@/components/layout/user-scoped-state", () => ({ resetUserScopedClientState: state.reset }));
vi.mock("@/lib/unsaved/coordinator", () => ({ unsaved: { forceLeave: state.leave } }));
const replace = vi.fn();
const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  const location = { replace, protocol: "https:" };
  vi.stubGlobal("location", location);
  vi.stubGlobal("window", { location, dispatchEvent: vi.fn() });
  vi.stubGlobal("document", { cookie: "", documentElement: { setAttribute: vi.fn() } });
  vi.stubGlobal("localStorage", { setItem: vi.fn() });
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("fail-safe browser logout", () => {
  it("coalesces double clicks and clears local state before awaiting the server", async () => {
    let complete!: (value: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { complete = resolve; }));
    const { logout } = await import("@/lib/auth/client-lifecycle");
    const first = logout();
    expect(logout()).toBe(first);
    expect(state.reset).toHaveBeenCalledOnce();
    expect(state.leave).toHaveBeenCalledOnce();
    expect(document.cookie).toContain("nesto.signed-out=1");
    // The request leaves once the device-side sign-out hooks have had their turn (MOB-08 §36).
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    complete(new Response());
    await first;
    expect(replace).toHaveBeenCalledWith("/login?reason=signed-out");
  });
  it("leaves even if both storage and the network fail", async () => {
    vi.stubGlobal("localStorage", { setItem: () => { throw new Error("storage blocked"); } });
    fetchMock.mockRejectedValue(new Error("offline"));
    const { logout } = await import("@/lib/auth/client-lifecycle");
    await expect(logout()).resolves.toBeUndefined();
    expect(replace).toHaveBeenCalledWith("/login?reason=signed-out");
  });
  it("bounds a hanging network request to five seconds", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))));
    const { logout } = await import("@/lib/auth/client-lifecycle");
    const pending = logout();
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(replace).toHaveBeenCalledWith("/login?reason=signed-out");
  });
  it("does not deny a newly authenticated browser session when an old request expires", async () => {
    document.cookie = "fresh-session-marker=1";
    const { leaveSession } = await import("@/lib/auth/client-lifecycle");
    leaveSession("session-expired");
    expect(document.cookie).toBe("fresh-session-marker=1");
    expect(replace).toHaveBeenCalledWith("/login?reason=session-expired");
  });

});
