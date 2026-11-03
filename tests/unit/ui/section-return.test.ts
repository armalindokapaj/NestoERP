import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RETURN_LIMIT, RETURN_STORAGE_KEY, findReturn, parseReturns, returnKey, serializeReturns, withReturn, type ReturnEntry } from "@/lib/ui/section-return";

/**
 * Coming Back to a page with sections (UI-02 §8.6, J01): what is remembered
 * per address, and the one question asked of the browser — was this arrival a
 * traversal. The arithmetic of the place itself is tests/unit/ui/ruler-math.test.ts.
 */

const entry = (key: string, id = "financials", offset = 458): ReturnEntry => ({ key, anchor: { id, offset } });

describe("what is remembered", () => {
  it("is keyed by the address without its hash", () => {
    expect(returnKey("/projects/p1", "")).toBe("/projects/p1");
    expect(returnKey("/dashboard", "from=check")).toBe("/dashboard?from=check");
    expect(returnKey("/dashboard", "?from=check")).toBe("/dashboard?from=check");
  });

  it("survives storage as a section id and a whole number", () => {
    const entries = [entry("/dashboard", "needs-attention", -36.4), entry("/projects/p1", "financials", 458.6)];
    expect(serializeReturns(entries)).toBe('[["/dashboard","needs-attention",-36],["/projects/p1","financials",459]]');
    expect(parseReturns(serializeReturns(entries))).toEqual([entry("/dashboard", "needs-attention", -36), entry("/projects/p1", "financials", 459)]);
  });

  it("drops anything that is not exactly an entry, and never throws", () => {
    expect(parseReturns(null)).toEqual([]);
    expect(parseReturns("")).toEqual([]);
    expect(parseReturns("{not json")).toEqual([]);
    expect(parseReturns('{"/dashboard":1}')).toEqual([]);
    expect(parseReturns('[["/a","s",1],["/b","",1],["/c","s","1"],["/d","s",null],["/e","s"],[1,"s",1],"x",null,["/f","s",2]]')).toEqual([entry("/a", "s", 1), entry("/f", "s", 2)]);
  });

  it("holds one place per address, the newest last", () => {
    let entries = withReturn([], "/a", { id: "one", offset: 1 });
    entries = withReturn(entries, "/b", { id: "two", offset: 2 });
    entries = withReturn(entries, "/a", { id: "three", offset: 3 });
    expect(entries.map((item) => item.key)).toEqual(["/b", "/a"]);
    expect(findReturn(entries, "/a")).toEqual({ id: "three", offset: 3 });
    expect(findReturn(entries, "/c")).toBeNull();
  });

  it("forgets a page that was left at its top", () => {
    const entries = withReturn([entry("/a"), entry("/b")], "/a", null);
    expect(entries.map((item) => item.key)).toEqual(["/b"]);
    expect(withReturn([], "/a", null)).toEqual([]);
  });

  it("keeps a bounded number of addresses, dropping the oldest", () => {
    let entries: ReturnEntry[] = [];
    for (let index = 0; index < RETURN_LIMIT + 5; index += 1) entries = withReturn(entries, `/page/${index}`, { id: "s", offset: index });
    expect(entries).toHaveLength(RETURN_LIMIT);
    expect(entries[0].key).toBe("/page/5");
    expect(entries[entries.length - 1].key).toBe(`/page/${RETURN_LIMIT + 4}`);
    expect(withReturn([entry("/a"), entry("/b"), entry("/c")], "/d", { id: "s", offset: 0 }, 2).map((item) => item.key)).toEqual(["/c", "/d"]);
  });
});

describe("in the browser", () => {
  type Listener = () => void;
  let listeners: Listener[];
  let store: Map<string, string>;
  let location: { pathname: string; search: string };
  let navigationType: string;

  /** A fresh copy of the module — it holds the traversal between a `popstate` and the page that mounts — over a stand-in window. */
  async function load() {
    vi.resetModules();
    return import("@/lib/ui/section-return");
  }

  beforeEach(() => {
    listeners = [];
    store = new Map();
    location = { pathname: "/projects", search: "" };
    navigationType = "navigate";
    vi.stubGlobal("window", {
      location,
      performance: { getEntriesByType: () => [{ type: navigationType }] },
      addEventListener: (_type: string, listener: Listener) => listeners.push(listener),
      removeEventListener: (_type: string, listener: Listener) => listeners.splice(listeners.indexOf(listener), 1),
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  const goBackTo = (pathname: string, search = "") => {
    location.pathname = pathname;
    location.search = search;
    for (const listener of [...listeners]) listener();
  };

  it("remembers under a nesto. key, which the end of a session empties", async () => {
    const { rememberReturn, recallReturn } = await load();
    expect(RETURN_STORAGE_KEY).toMatch(/^nesto[.:-]/);
    rememberReturn("/dashboard", { id: "financials", offset: 458 });
    expect(store.get(RETURN_STORAGE_KEY)).toBe('[["/dashboard","financials",458]]');
    expect(recallReturn("/dashboard")).toEqual({ id: "financials", offset: 458 });
    rememberReturn("/dashboard", null);
    expect(store.has(RETURN_STORAGE_KEY)).toBe(false);
    expect(recallReturn("/dashboard")).toBeNull();
  });

  it("works without storage: nothing is remembered and nothing throws", async () => {
    const { rememberReturn, recallReturn } = await load();
    (window as unknown as { sessionStorage: unknown }).sessionStorage = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => undefined };
    expect(() => rememberReturn("/dashboard", { id: "financials", offset: 1 })).not.toThrow();
    expect(recallReturn("/dashboard")).toBeNull();
  });

  it("Back to an address is a return to it, once", async () => {
    const { watchTraversals, takeTraversal } = await load();
    const stop = watchTraversals();
    expect(takeTraversal("/dashboard")).toBe(false);
    goBackTo("/dashboard", "?from=check");
    expect(takeTraversal("/dashboard")).toBe(false);
    expect(takeTraversal("/dashboard?from=check")).toBe(true);
    expect(takeTraversal("/dashboard?from=check")).toBe(false);
    stop();
    expect(listeners).toHaveLength(0);
  });

  it("a link to the address later is not a return", async () => {
    const { watchTraversals, keepTraversal, takeTraversal } = await load();
    watchTraversals();
    // Back to a page that takes nothing, then on by a link.
    goBackTo("/tasks");
    keepTraversal("/tasks");
    keepTraversal("/dashboard");
    location.pathname = "/tasks";
    expect(takeTraversal("/tasks")).toBe(false);
  });

  it("the page traversed to keeps its return while it is the one on screen", async () => {
    const { watchTraversals, keepTraversal, takeTraversal } = await load();
    watchTraversals();
    goBackTo("/dashboard", "?from=check");
    keepTraversal("/dashboard");
    expect(takeTraversal("/dashboard?from=check")).toBe(true);
    goBackTo("/dashboard");
    keepTraversal("/dashboard");
    expect(takeTraversal("/dashboard")).toBe(true);
    // A longer path that merely starts the same way is another page.
    goBackTo("/dashboard");
    keepTraversal("/dash");
    expect(takeTraversal("/dashboard")).toBe(false);
  });

  describe("where the browser names its history entry", () => {
    let entry: { key: string };
    /** A link: a new entry. Back or Forward: an entry that already exists. A replacement keeps the entry it is on. */
    const onEntry = (key: string) => {
      entry.key = key;
    };

    beforeEach(() => {
      entry = { key: "k1" };
      (window as unknown as { navigation: unknown }).navigation = { currentEntry: entry };
    });

    it("an entry shown before is a return, once, and needs no listener", async () => {
      const { watchTraversals, noteArrival, takeTraversal } = await load();
      watchTraversals();
      expect(listeners).toHaveLength(0);
      expect(takeTraversal("/hr/employees")).toBe(false);
      onEntry("k2");
      expect(takeTraversal("/hr/employees/e1")).toBe(false);
      onEntry("k1");
      // Whoever asks first — the page, or the watch noting the arrival — the answer is the same.
      expect(noteArrival("/hr/employees")).toEqual(expect.objectContaining({ traversal: true }));
      expect(takeTraversal("/hr/employees")).toBe(true);
      expect(takeTraversal("/hr/employees")).toBe(false);
      // Forward is a return too.
      onEntry("k2");
      expect(takeTraversal("/hr/employees/e1")).toBe(true);
    });

    it("a link, and a replacement on the same entry, are not returns", async () => {
      const { noteArrival, takeTraversal } = await load();
      noteArrival("/hr/employees");
      // A filter applied by replacing the entry.
      expect(takeTraversal("/hr/employees?status=ACTIVE")).toBe(false);
      onEntry("k2");
      expect(takeTraversal("/hr/employees/e1")).toBe(false);
      // A link back to the list makes a third entry.
      onEntry("k3");
      expect(takeTraversal("/hr/employees")).toBe(false);
    });

    it("a return that was to another address on the entry is not this address's", async () => {
      const { noteArrival, takeTraversal } = await load();
      noteArrival("/hr/employees");
      onEntry("k2");
      noteArrival("/hr/employees/e1");
      onEntry("k1");
      noteArrival("/hr/employees");
      // Replaced before anything took the return: the new address was not returned to.
      expect(takeTraversal("/hr/employees?page=2")).toBe(false);
    });

    it("a late popstate does not answer a second time", async () => {
      const { watchTraversals, noteArrival, takeTraversal } = await load();
      watchTraversals();
      noteArrival("/hr/employees");
      onEntry("k2");
      noteArrival("/hr/employees/e1");
      onEntry("k1");
      expect(takeTraversal("/hr/employees")).toBe(true);
      goBackTo("/hr/employees");
      expect(takeTraversal("/hr/employees")).toBe(false);
    });
  });

  it("a document loaded by Back or Forward is a return to its own address, whichever asks first", async () => {
    navigationType = "back_forward";
    location.pathname = "/dashboard";
    const first = await load();
    // The page's own effect runs before the watcher's: it must not need the watcher to have asked.
    expect(first.takeTraversal("/dashboard")).toBe(true);
    expect(first.takeTraversal("/dashboard")).toBe(false);
    first.watchTraversals();
    expect(first.takeTraversal("/dashboard")).toBe(false);

    const reloaded = await load();
    navigationType = "reload";
    reloaded.watchTraversals();
    expect(reloaded.takeTraversal("/dashboard")).toBe(false);
  });
});
