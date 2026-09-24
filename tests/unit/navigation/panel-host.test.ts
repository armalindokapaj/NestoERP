import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPanelLoader, resetPanelWarmingForTests, warmPanel } from "@/lib/navigation/panel-host";

/**
 * The panel host's loaders and code warming (NAV-03 §6: PANEL-02, PANEL-03,
 * PANEL-06; cases P05, P07, P13). What a person sees is in the browser specs.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("a panel's loader (P05, P07)", () => {
  it("makes one attempt however often it is asked, and keeps a loaded body", async () => {
    const pending = deferred<{ body: string }>();
    const importer = vi.fn(() => pending.promise);
    const loader = createPanelLoader("search", importer);
    const first = loader.load();
    const second = loader.load();
    expect(importer).toHaveBeenCalledTimes(1);
    pending.resolve({ body: "search" });
    await expect(first).resolves.toEqual({ body: "search" });
    await expect(second).resolves.toEqual({ body: "search" });
    // Closed and reopened: the code is kept, and a reset cannot drop it.
    loader.reset();
    await expect(loader.load()).resolves.toEqual({ body: "search" });
    expect(importer).toHaveBeenCalledTimes(1);
    expect(loader.peek()).toEqual({ body: "search" });
  });

  it("keeps a rejected attempt until one explicit reset replaces it, and counts failures for the reload advice", async () => {
    const importer = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error("chunk")).mockRejectedValueOnce(new Error("chunk")).mockResolvedValueOnce("body");
    const loader = createPanelLoader("activity", importer);
    await expect(loader.load()).rejects.toThrow("chunk");
    // Without a retry the same rejected attempt answers: no silent import loop.
    await expect(loader.load()).rejects.toThrow("chunk");
    expect(importer).toHaveBeenCalledTimes(1);
    expect(loader.failures()).toBe(1);

    loader.reset();
    await expect(loader.load()).rejects.toThrow("chunk");
    expect(loader.failures()).toBe(2); // the host now offers Reload (PANEL-03)

    loader.reset();
    await expect(loader.load()).resolves.toBe("body");
    expect(importer).toHaveBeenCalledTimes(3);
  });
});

describe("code warming (P13, PANEL-06)", () => {
  const originalNavigator = globalThis.navigator;

  beforeEach(() => resetPanelWarmingForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalNavigator) vi.stubGlobal("navigator", originalNavigator);
  });

  const loaderFor = () => createPanelLoader("quick_create", vi.fn(async () => "code"));

  it("warms at most twice a minute, 1.5 s apart, and never a loaded body", () => {
    const loaders = [loaderFor(), loaderFor(), loaderFor(), loaderFor()];
    expect(warmPanel(loaders[0], 0)).toBe(true);
    expect(warmPanel(loaders[1], 1_000)).toBe(false); // inside the spacing
    expect(warmPanel(loaders[1], 1_600)).toBe(true);
    expect(warmPanel(loaders[2], 10_000)).toBe(false); // two in the minute already
    expect(warmPanel(loaders[2], 60_001)).toBe(true); // the first has left the window
    expect(warmPanel(loaders[3], 61_700)).toBe(true);
  });

  it("does not spend the budget on a body that is already loaded", async () => {
    const loaded = loaderFor();
    await loaded.load();
    expect(warmPanel(loaded, 0)).toBe(false);
    expect(warmPanel(loaderFor(), 0)).toBe(true);
  });

  it.each([
    ["offline", { onLine: false }],
    ["Save-Data", { onLine: true, connection: { saveData: true } }],
    ["2g", { onLine: true, connection: { effectiveType: "2g" } }],
    ["slow-2g", { onLine: true, connection: { effectiveType: "slow-2g" } }],
  ])("warms nothing when %s", (_label, navigatorState) => {
    vi.stubGlobal("navigator", navigatorState);
    const loader = loaderFor();
    expect(warmPanel(loader, 0)).toBe(false);
    expect(loader.peek()).toBeNull();
  });

  it("warms nothing while the page is hidden", () => {
    vi.stubGlobal("document", { visibilityState: "hidden" });
    expect(warmPanel(loaderFor(), 0)).toBe(false);
  });

  it("warming loads code only: the importer is the only call made", async () => {
    const importer = vi.fn(async () => "code");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    warmPanel(createPanelLoader("search", importer), 0);
    await Promise.resolve();
    expect(importer).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a failed warm is forgotten, so a later open imports again", async () => {
    const importer = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error("chunk")).mockResolvedValueOnce("code");
    const loader = createPanelLoader("workspace", importer);
    warmPanel(loader, 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(loader.load()).resolves.toBe("code");
    expect(importer).toHaveBeenCalledTimes(2);
  });
});
