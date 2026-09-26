import { describe, expect, it } from "vitest";

import { Coordinator, DOWNLOAD_WINDOW_MS, LEAVING_WINDOW_MS, type EditorRegistration, type SaveOutcome } from "@/lib/unsaved/coordinator";

/**
 * AUD-03 — the unsaved-work coordinator's rules (UW-03, UW-09, UW-10, UW-11,
 * UW-13, UW-23): registration, what a departure affects, the one prompt, and
 * one-shot approvals bound to editor revisions and identity.
 */

function setup() {
  let now = 1_000;
  const coordinator = new Coordinator(() => now);
  coordinator.setIdentity("user:session");
  // The prompt's renderer is mounted, as in the application shell.
  coordinator.attachHost();
  return { coordinator, advance: (ms: number) => (now += ms) };
}

function editor(overrides: Partial<EditorRegistration> = {}): EditorRegistration {
  return { label: () => "Client form", module: "clients", saveKind: "save", scopes: [], ...overrides };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("registry", () => {
  it("keeps one entry per editor id, and a stale unregistration cannot remove a newer mount (Strict Mode)", () => {
    const { coordinator } = setup();
    const first = coordinator.register("a", editor());
    coordinator.unregister("a", first);
    const second = coordinator.register("a", editor());
    coordinator.unregister("a", first); // the first mount's cleanup, late
    expect(coordinator.registered()).toBe(1);
    coordinator.unregister("a", second);
    expect(coordinator.registered()).toBe(0);
  });

  it("unregistering one editor never clears another's protection (UW-03)", () => {
    const { coordinator } = setup();
    const a = coordinator.register("a", editor());
    coordinator.register("b", editor());
    coordinator.update("a", { dirty: true });
    coordinator.update("b", { dirty: true });
    coordinator.unregister("a", a);
    expect(coordinator.hasBlocking({ kind: "navigate", href: "/x" })).toBe(true);
    expect(coordinator.getSnapshot().blocking).toBe(1);
  });

  it("counts dirty, saving, pending uploads and unresolved saves as blocking, nothing else", () => {
    const { coordinator } = setup();
    coordinator.register("a", editor());
    const intent = { kind: "reload" } as const;
    expect(coordinator.hasBlocking(intent)).toBe(false);
    for (const flag of ["dirty", "saving", "pendingUploads", "unresolved"] as const) {
      coordinator.update("a", { [flag]: true });
      expect(coordinator.hasBlocking(intent)).toBe(true);
      coordinator.update("a", { [flag]: false });
    }
    expect(coordinator.hasBlocking(intent)).toBe(false);
  });

  it("asks an editor to recompute before deciding", () => {
    const { coordinator } = setup();
    let synced = 0;
    coordinator.register("a", editor({ sync: () => synced++ }));
    coordinator.hasBlocking({ kind: "navigate", href: "/x" });
    expect(synced).toBe(1);
  });
});

describe("what a departure affects", () => {
  it("closing a dialog concerns only the editors inside it (UW-08)", () => {
    const { coordinator } = setup();
    coordinator.register("page", editor({ scopes: [] }));
    coordinator.register("outer", editor({ scopes: ["dialog:1"] }));
    coordinator.register("inner", editor({ scopes: ["dialog:1", "dialog:2"] }));
    coordinator.update("page", { dirty: true });
    expect(coordinator.hasBlocking({ kind: "dismiss", scope: "dialog:1" })).toBe(false);
    coordinator.update("inner", { dirty: true });
    expect(coordinator.hasBlocking({ kind: "dismiss", scope: "dialog:2" })).toBe(true);
    expect(coordinator.hasBlocking({ kind: "dismiss", scope: "dialog:1" })).toBe(true);
    coordinator.update("inner", { dirty: false });
    coordinator.update("outer", { dirty: true });
    expect(coordinator.hasBlocking({ kind: "dismiss", scope: "dialog:2" })).toBe(false);
  });

  it("a route change spares an editor mounted in the shell; a workspace switch does not", () => {
    const { coordinator } = setup();
    coordinator.register("shell", editor({ persistsAcrossRoutes: true }));
    coordinator.update("shell", { dirty: true });
    expect(coordinator.hasBlocking({ kind: "navigate", href: "/x" })).toBe(false);
    expect(coordinator.hasBlocking({ kind: "workspace", target: "B" })).toBe(true);
    expect(coordinator.hasBlocking({ kind: "identity", action: "sign-out" })).toBe(true);
  });
});

describe("the departure flow", () => {
  it("approves at once, without a prompt, when nothing would be lost", async () => {
    const { coordinator } = setup();
    coordinator.register("a", editor());
    const approval = await coordinator.requestDeparture({ kind: "navigate", href: "/x" });
    expect(approval).not.toBeNull();
    expect(coordinator.getSnapshot().prompt).toBeNull();
  });

  it("Stay answers null and sends nothing", async () => {
    const { coordinator } = setup();
    let saves = 0;
    coordinator.register("a", editor({ save: async () => (saves++, { kind: "committed" }) }));
    coordinator.update("a", { dirty: true });
    const pending = coordinator.requestDeparture({ kind: "workspace", target: "B" });
    expect(coordinator.getSnapshot().prompt?.editors.map((entry) => entry.label)).toEqual(["Client form"]);
    coordinator.stay();
    expect(await pending).toBeNull();
    expect(saves).toBe(0);
    expect(coordinator.getSnapshot().prompt).toBeNull();
  });

  it("keeps the first intent while a prompt is open: a second request is refused, not queued (UW-23)", async () => {
    const { coordinator } = setup();
    coordinator.register("a", editor());
    coordinator.update("a", { dirty: true });
    const first = coordinator.requestDeparture({ kind: "navigate", href: "/first" });
    const second = await coordinator.requestDeparture({ kind: "navigate", href: "/second" });
    expect(second).toBeNull();
    expect(coordinator.getSnapshot().prompt?.intent).toEqual({ kind: "navigate", href: "/first" });
    coordinator.discardAll();
    expect((await first)?.intent).toEqual({ kind: "navigate", href: "/first" });
  });

  it("Discard approves once; the continuation runs once and a second run is refused (UW-23)", async () => {
    const { coordinator } = setup();
    coordinator.register("a", editor());
    coordinator.update("a", { dirty: true });
    const pending = coordinator.requestDeparture({ kind: "navigate", href: "/x" });
    coordinator.discardAll();
    const approval = (await pending)!;
    let runs = 0;
    expect(approval.run(() => runs++)).toBe(true);
    expect(approval.run(() => runs++)).toBe(false);
    expect(runs).toBe(1);
  });

  it("a new edit after approval voids it (UW-23)", async () => {
    const { coordinator } = setup();
    coordinator.register("a", editor());
    coordinator.update("a", { dirty: true });
    const pending = coordinator.requestDeparture({ kind: "navigate", href: "/x" });
    coordinator.discardAll();
    const approval = (await pending)!;
    coordinator.touch("a");
    let ran = false;
    expect(approval.run(() => (ran = true))).toBe(false);
    expect(ran).toBe(false);
  });

  it("a newly dirty editor voids an approval given before it", async () => {
    const { coordinator } = setup();
    coordinator.register("a", editor());
    coordinator.register("b", editor());
    coordinator.update("a", { dirty: true });
    const pending = coordinator.requestDeparture({ kind: "navigate", href: "/x" });
    coordinator.discardAll();
    const approval = (await pending)!;
    coordinator.update("b", { dirty: true });
    expect(approval.active).toBe(false);
  });

  it("an approval belongs to the identity it was given under", async () => {
    const { coordinator } = setup();
    coordinator.register("a", editor());
    coordinator.update("a", { dirty: true });
    const pending = coordinator.requestDeparture({ kind: "identity", action: "sign-out" });
    coordinator.discardAll();
    const approval = (await pending)!;
    coordinator.setIdentity("someone-else:session");
    expect(approval.run(() => undefined)).toBe(false);
  });

  it("the leaving window lets an approved departure out once, and ends with its time or its release", async () => {
    const { coordinator, advance } = setup();
    coordinator.register("a", editor());
    coordinator.update("a", { dirty: true });
    const pending = coordinator.requestDeparture({ kind: "reload" });
    coordinator.discardAll();
    const approval = (await pending)!;
    expect(coordinator.isLeaving()).toBe(false);
    approval.run(() => undefined);
    expect(coordinator.isLeaving()).toBe(true);
    advance(LEAVING_WINDOW_MS + 1);
    expect(coordinator.isLeaving()).toBe(false);

    const again = coordinator.requestDeparture({ kind: "reload" });
    coordinator.discardAll();
    const second = (await again)!;
    second.run(() => undefined);
    second.release();
    expect(coordinator.isLeaving()).toBe(false);
  });

  it("forgets approvals on a history restore: nothing is replayed (UW-20)", async () => {
    const { coordinator } = setup();
    coordinator.register("a", editor());
    coordinator.update("a", { dirty: true });
    const pending = coordinator.requestDeparture({ kind: "reload" });
    coordinator.discardAll();
    (await pending)!.run(() => undefined);
    coordinator.forgetApprovals();
    expect(coordinator.isLeaving()).toBe(false);
  });
});

describe("Save and continue", () => {
  it("runs the editor's own save once and goes on only when it committed (UW-09)", async () => {
    const { coordinator } = setup();
    let saves = 0;
    coordinator.register(
      "a",
      editor({
        save: async () => {
          saves++;
          coordinator.update("a", { dirty: false });
          return { kind: "committed" };
        },
      }),
    );
    coordinator.update("a", { dirty: true });
    const pending = coordinator.requestDeparture({ kind: "navigate", href: "/x" });
    await coordinator.saveAndContinue();
    await coordinator.saveAndContinue(); // a second click finds nothing to do
    expect(saves).toBe(1);
    expect(await pending).not.toBeNull();
  });

  for (const kind of ["invalid", "decision", "conflict", "refused", "failed", "unknown"] as const) {
    it(`cancels the departure and focuses the editor on "${kind}" (UW-09, UW-10, UW-12)`, async () => {
      const { coordinator } = setup();
      let focused = 0;
      coordinator.register("a", editor({ save: async () => ({ kind }) as SaveOutcome, focus: () => focused++ }));
      coordinator.update("a", { dirty: true });
      const pending = coordinator.requestDeparture({ kind: "navigate", href: "/x" });
      await coordinator.saveAndContinue();
      expect(await pending).toBeNull();
      coordinator.takeAfterClose()?.();
      expect(focused).toBe(1);
    });
  }

  it("never offers a save for an editor without an ordinary one (UW-10)", async () => {
    const { coordinator } = setup();
    let saves = 0;
    coordinator.register("a", editor({ saveKind: "none", workflow: "Send", save: async () => (saves++, { kind: "committed" }) }));
    coordinator.update("a", { dirty: true });
    const pending = coordinator.requestDeparture({ kind: "navigate", href: "/x" });
    await coordinator.saveAndContinue();
    expect(saves).toBe(0);
    expect(coordinator.getSnapshot().prompt?.editors[0]).toMatchObject({ saveKind: "none", workflow: "Send" });
    coordinator.stay();
    expect(await pending).toBeNull();
  });

  it("does not save again when the last save's outcome is unknown", async () => {
    const { coordinator } = setup();
    let saves = 0;
    coordinator.register("a", editor({ save: async () => (saves++, { kind: "committed" }) }));
    coordinator.update("a", { unresolved: true });
    const pending = coordinator.requestDeparture({ kind: "navigate", href: "/x" });
    await coordinator.saveAndContinue();
    expect(saves).toBe(0);
    coordinator.discardAll();
    expect(await pending).not.toBeNull();
  });

  it("waits for a save already running, then goes on if it left nothing unsaved (UW-13)", async () => {
    const { coordinator } = setup();
    coordinator.register("a", editor());
    coordinator.update("a", { dirty: true, saving: true });
    const pending = coordinator.requestDeparture({ kind: "navigate", href: "/x" });
    expect(coordinator.getSnapshot().prompt?.phase).toBe("waiting");
    coordinator.update("a", { dirty: false, saving: false });
    expect(await pending).not.toBeNull();
  });

  it("asks again when a running save fails", async () => {
    const { coordinator } = setup();
    coordinator.register("a", editor());
    coordinator.update("a", { dirty: true, saving: true });
    const pending = coordinator.requestDeparture({ kind: "navigate", href: "/x" });
    coordinator.update("a", { saving: false });
    expect(coordinator.getSnapshot().prompt?.phase).toBe("choose");
    coordinator.stay();
    expect(await pending).toBeNull();
  });
});

describe("several editors (UW-11)", () => {
  it("reviews one at a time; a save that succeeded stays saved when a later one fails", async () => {
    const { coordinator } = setup();
    const saved: string[] = [];
    coordinator.register(
      "a",
      editor({
        label: () => "First",
        save: async () => {
          saved.push("a");
          coordinator.update("a", { dirty: false });
          return { kind: "committed" };
        },
      }),
    );
    coordinator.register("b", editor({ label: () => "Second", save: async () => (saved.push("b"), { kind: "invalid" }) }));
    coordinator.update("a", { dirty: true });
    coordinator.update("b", { dirty: true });
    const pending = coordinator.requestDeparture({ kind: "navigate", href: "/x" });
    expect(coordinator.getSnapshot().prompt?.editors.map((entry) => entry.label)).toEqual(["First", "Second"]);
    coordinator.review();
    await coordinator.reviewSave();
    expect(coordinator.getSnapshot().prompt?.reviewIndex).toBe(1);
    await coordinator.reviewSave();
    expect(await pending).toBeNull();
    expect(saved).toEqual(["a", "b"]);
    expect(coordinator.state("a")?.dirty).toBe(false);
    expect(coordinator.state("b")?.dirty).toBe(true);
  });

  it("goes on after each editor was saved or explicitly discarded", async () => {
    const { coordinator } = setup();
    coordinator.register(
      "a",
      editor({
        save: async () => {
          coordinator.update("a", { dirty: false });
          return { kind: "committed" };
        },
      }),
    );
    coordinator.register("b", editor());
    coordinator.update("a", { dirty: true });
    coordinator.update("b", { dirty: true });
    const pending = coordinator.requestDeparture({ kind: "workspace", target: "B" });
    coordinator.review();
    await coordinator.reviewSave();
    coordinator.reviewDiscard();
    const approval = await pending;
    expect(approval).not.toBeNull();
    expect(approval!.run(() => undefined)).toBe(true);
  });

  it("Discard all approves every affected editor at once", async () => {
    const { coordinator } = setup();
    coordinator.register("a", editor());
    coordinator.register("b", editor());
    coordinator.update("a", { dirty: true });
    coordinator.update("b", { dirty: true });
    const pending = coordinator.requestDeparture({ kind: "navigate", href: "/x" });
    coordinator.discardAll();
    expect((await pending)?.run(() => undefined)).toBe(true);
  });
});

describe("one question per action", () => {
  it("a later step of the same flow is not asked again about what an earlier step approved", async () => {
    const { coordinator } = setup();
    coordinator.register("a", editor());
    coordinator.update("a", { dirty: true });
    const first = coordinator.requestDeparture({ kind: "navigate", href: "/x" });
    coordinator.discardAll();
    const prior = await first;
    const second = await coordinator.requestDeparture({ kind: "workspace", target: "B" }, { prior });
    expect(coordinator.getSnapshot().prompt).toBeNull();
    expect(second?.run(() => undefined)).toBe(true);
  });

  it("but is asked about an edit made since", async () => {
    const { coordinator } = setup();
    coordinator.register("a", editor());
    coordinator.update("a", { dirty: true });
    const first = coordinator.requestDeparture({ kind: "navigate", href: "/x" });
    coordinator.discardAll();
    const prior = await first;
    coordinator.touch("a");
    const second = coordinator.requestDeparture({ kind: "workspace", target: "B" }, { prior });
    expect(coordinator.getSnapshot().prompt).not.toBeNull();
    coordinator.stay();
    expect(await second).toBeNull();
  });
});

describe("without a host", () => {
  it("falls back to the browser's own confirmation instead of waiting for a prompt nobody draws", async () => {
    const coordinator = new Coordinator();
    coordinator.register("a", editor());
    coordinator.update("a", { dirty: true });
    const answers = [false, true];
    const confirm = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { confirm: () => answers.shift() };
    try {
      expect(await coordinator.requestDeparture({ kind: "navigate", href: "/x" })).toBeNull();
      expect(await coordinator.requestDeparture({ kind: "navigate", href: "/x" })).not.toBeNull();
      expect(coordinator.getSnapshot().prompt).toBeNull();
    } finally {
      (globalThis as { window?: unknown }).window = confirm;
    }
  });
});

describe("freeze", () => {
  it("cancels an open prompt and refuses a save meanwhile", async () => {
    const { coordinator } = setup();
    let saves = 0;
    coordinator.register("a", editor({ save: async () => (saves++, { kind: "committed" }) }));
    coordinator.update("a", { dirty: true });
    const pending = coordinator.requestDeparture({ kind: "navigate", href: "/x" });
    coordinator.freeze({ reason: "workspace-changed", from: "A", to: "B" });
    expect(await pending).toBeNull();
    await flush();
    expect(coordinator.getSnapshot().freeze?.reason).toBe("workspace-changed");
    expect(saves).toBe(0);
  });
});

describe("a dismissal", () => {
  it("keeps protecting the other editors on the page once the dialog has closed", async () => {
    const { coordinator } = setup();
    coordinator.register("page", editor({ scopes: [] }));
    const token = coordinator.register("dialog", editor({ scopes: ["dialog:1"] }));
    coordinator.update("page", { dirty: true });
    coordinator.update("dialog", { dirty: true });
    const pending = coordinator.requestDeparture({ kind: "dismiss", scope: "dialog:1" });
    coordinator.discardAll();
    const approval = await pending;
    expect(approval?.run(() => coordinator.unregister("dialog", token))).toBe(true);
    expect(coordinator.isLeaving()).toBe(false);
    expect(coordinator.hasBlocking({ kind: "reload" })).toBe(true);
  });
});

describe("a started download", () => {
  it("lets exactly one unload through, and only while it is starting", () => {
    const { coordinator, advance } = setup();
    expect(coordinator.takeDownload()).toBe(false);
    coordinator.expectDownload();
    expect(coordinator.takeDownload()).toBe(true);
    // A second unload — a real departure after the download — asks again.
    expect(coordinator.takeDownload()).toBe(false);
    coordinator.expectDownload();
    advance(DOWNLOAD_WINDOW_MS);
    expect(coordinator.takeDownload()).toBe(false);
  });
});

describe("telemetry", () => {
  it("reports event, departure and module only", async () => {
    const { coordinator } = setup();
    const events: unknown[] = [];
    coordinator.onEvent((event) => events.push(event));
    coordinator.register("a", editor({ label: () => "Secret title" }));
    coordinator.update("a", { dirty: true });
    const pending = coordinator.requestDeparture({ kind: "navigate", href: "/clients/123?q=secret" });
    coordinator.stay();
    await pending;
    expect(JSON.stringify(events)).not.toMatch(/Secret|secret|123/);
    expect(events).toContainEqual({ event: "prompt", departure: "navigate", module: "clients" });
  });
});
