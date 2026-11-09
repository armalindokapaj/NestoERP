import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { dismissHelp, helpDismissalKey, isHelpDismissed } from "@/components/help/what-is-this";
import { hasActiveFilters, listEmptyKind } from "@/components/ui/empty-state";

/**
 * AUD-05 §5-§7 (UX-10, UX-11, UX-12, UX-15, UX-16): the pure rules behind the
 * five page states and the contextual help, plus source checks that keep each
 * filterable list's no-results state, each search hint and each help point
 * honest. Runs without a database.
 */

const root = join(__dirname, "..", "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("list empty kind (AUD-05 §6, UX-11)", () => {
  it("rows win; nothing with filters is no-results; nothing without is first run", () => {
    expect(listEmptyKind(3, true)).toBe("rows");
    expect(listEmptyKind(0, true)).toBe("no-results");
    expect(listEmptyKind(0, false)).toBe("first-run");
  });

  it("paging and sort never count as a filter", () => {
    expect(hasActiveFilters({ page: "2", sort: "due-asc", pageSize: "50", dir: "asc" })).toBe(false);
    expect(hasActiveFilters({ q: "  " })).toBe(false);
    expect(hasActiveFilters({ q: "north" })).toBe(true);
    expect(hasActiveFilters({ status: ["", "OPEN"] })).toBe(true);
    expect(hasActiveFilters({ status: [] })).toBe(false);
  });

  it("with explicit keys only those count, so a view default is not a filter", () => {
    expect(hasActiveFilters({ view: "pending", page: "1" }, ["q", "status"])).toBe(false);
    expect(hasActiveFilters({ view: "pending", status: "OPEN" }, ["q", "status"])).toBe(true);
  });
});

describe("What is this? dismissal (AUD-05 §7, UX-15, UX-16)", () => {
  function memoryStore() {
    const map = new Map<string, string>();
    return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value), map };
  }

  it("is keyed by the opaque identity, the tip and its version", () => {
    expect(helpDismissalKey("u-digest", "approvals.queue", 2)).toBe("nesto.help.dismissed:u-digest:approvals.queue:v2");
  });

  it("stays dismissed for the same identity and version only", () => {
    const store = memoryStore();
    dismissHelp(store, "alice", "approvals.queue", 1);
    expect(isHelpDismissed(store, "alice", "approvals.queue", 1)).toBe(true);
    // Another demo identity in the same tab sees it again (UX-06).
    expect(isHelpDismissed(store, "bob", "approvals.queue", 1)).toBe(false);
    // New text, shown once more.
    expect(isHelpDismissed(store, "alice", "approvals.queue", 2)).toBe(false);
    // Nothing but a flag is stored: no form data.
    expect([...store.map.values()]).toEqual(["1"]);
  });

  it("without an identity or storage nothing is persisted and nothing throws", () => {
    const store = memoryStore();
    dismissHelp(store, null, "x", 1);
    expect(store.map.size).toBe(0);
    expect(isHelpDismissed(null, "alice", "x", 1)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => dismissHelp(broken, "alice", "x", 1)).not.toThrow();
    expect(isHelpDismissed(broken, "alice", "x", 1)).toBe(false);
  });

  it("uses sessionStorage, never localStorage, and reads it in an effect", () => {
    const source = read("components/help/what-is-this.tsx");
    expect(source).toContain("window.sessionStorage");
    expect(source).not.toMatch(/window\.localStorage|localStorage\./);
    expect(source).toContain("tabIdentity()?.user");
    expect(source).toContain("aria-expanded");
    expect(source).not.toMatch(/onMouseEnter|onPointerEnter|onHover/);
  });
});

describe("contextual help points (AUD-05 §7, UX-15)", () => {
  const points: Array<[id: string, file: string]> = [
    ["workspace.scope.projects", "app/(nesto)/projects/(portfolio)/page.tsx"],
    ["tasks.create.project", "app/(nesto)/tasks/new/page.tsx"],
    ["approvals.queue", "components/approvals/approvals-shell.tsx"],
    ["tasks.detail.status", "app/(nesto)/tasks/[taskId]/page.tsx"],
    ["lists.search-filters", "app/(nesto)/tasks/tasks-list.tsx"],
    ["projects.detail.relationships", "app/(nesto)/projects/[projectId]/page.tsx"],
  ];

  it.each(points)("%s is placed in %s", (id, file) => {
    expect(read(file)).toContain(`<WhatIsThis id="${id}"`);
  });

  it("no help point tells a reader to create, approve or restore unconditionally", () => {
    for (const [, file] of points) {
      const source = read(file);
      const blocks = source.match(/<WhatIsThis[\s\S]*?<\/WhatIsThis>/g) ?? [];
      for (const block of blocks) expect(block).not.toMatch(/\b(Create one|create the first|Click Create|Restore it)\b/i);
    }
  });
});

describe("no-results state on every filterable list (AUD-05 §6, UX-11)", () => {
  const lists = [
    "app/(nesto)/daily-logs/page.tsx",
    "app/(nesto)/contractors/page.tsx",
    "app/(nesto)/contractors/compliance/page.tsx",
    "app/(nesto)/contractors/work-packages/page.tsx",
    "app/(nesto)/projects/[projectId]/work-packages/page.tsx",
    "app/(nesto)/engineering/drawings/page.tsx",
    "app/(nesto)/engineering/rfis/page.tsx",
    "app/(nesto)/engineering/submittals/page.tsx",
    "app/(nesto)/engineering/transmittals/page.tsx",
    "app/(nesto)/timesheets/team/page.tsx",
    "app/(nesto)/qaqc/approvals/page.tsx",
    "components/engineering/project-registers.tsx",
  ];

  it.each(lists)("%s answers a filtered empty list with NoResultsState", (file) => {
    expect(read(file)).toContain("<NoResultsState");
  });

  it("the project engineering registers answer every register", () => {
    expect(read("components/engineering/project-registers.tsx").match(/<NoResultsState/g)).toHaveLength(4);
  });

  it("the tasks list counts a due-date range as a filter", () => {
    const source = read("app/(nesto)/tasks/tasks-list.tsx");
    expect(source).toMatch(/query\.dueFrom \|\|\s*query\.dueTo/);
  });

  it("the team list counts a status chosen in the URL as a filter", () => {
    expect(read("app/(nesto)/team/team-list.tsx")).toContain('hasActiveFilters(searchParams, ["status"])');
  });
});

describe("search hints claim only what the backend searches (AUD-05 §5, UX-10)", () => {
  const hints: Array<[page: string, hint: string, service: string, fields: string[]]> = [
    ["app/(nesto)/inventory/reservations/page.tsx", "Search by reservation number…", "lib/modules/inventory/reservations/reservation.service.ts", ['searchClause(query.search, ["reservationNumber"])']],
    ["app/(nesto)/engineering/rfis/page.tsx", "Search RFI number or subject…", "lib/modules/engineering/engineering.rfis.ts", ["rfiNumber: { contains", "subject: { contains"]],
    ["app/(nesto)/engineering/submittals/page.tsx", "Search number, title or product…", "lib/modules/engineering/engineering.submittals.ts", ["submittalNumber: { contains", "title: { contains", "productName: { contains"]],
    ["app/(nesto)/engineering/transmittals/page.tsx", "Search number, subject, recipient or document number…", "lib/modules/engineering/engineering.transmittals.ts", ["transmittalNumber: { contains", "subject: { contains", "recipientText: { contains", "documentNumber: { contains"]],
    ["app/(nesto)/workforce/page.tsx", "Search name, employee number or job title…", "lib/modules/workforce/workforce.directory.ts", ["firstName: { contains", "employeeNumber: { contains", "jobTitle: { contains"]],
    ["components/qaqc/qaqc-list.tsx", "Search number, summary, location or work reference…", "lib/modules/qaqc/inspections/inspection.service.ts", ["inspectionNumber: { contains", "summary: { contains", "locationText: { contains", "workReference: { contains"]],
    ["components/qaqc/qaqc-list.tsx", "Search NCR number or title…", "lib/modules/qaqc/ncrs/ncr.service.ts", ["ncrNumber: { contains", "title: { contains"]],
    ["components/qaqc/qaqc-list.tsx", "Search number, title or location…", "lib/modules/qaqc/defects/defect.service.ts", ["defectNumber: { contains", "title: { contains", "locationText: { contains"]],
    ["app/(nesto)/daily-logs/page.tsx", "Search by project or summary…", "lib/modules/daily-logs/daily-log.service.ts", ["summary: { contains", "name: { contains"]],
  ];

  it.each(hints)("%s says %s", (page, hint, service, fields) => {
    expect(read(page)).toContain(hint);
    const source = read(service);
    for (const field of fields) expect(source).toContain(field);
  });

  it("the reservation search no longer claims items it does not search", () => {
    expect(read("app/(nesto)/inventory/reservations/page.tsx")).not.toContain("number or item");
  });
});

describe("loading and error states (AUD-05 §6, UX-11, UX-12)", () => {
  it("skeletons announce loading once and hide their shapes", () => {
    const source = read("components/ui/loading-state.tsx");
    expect(source).toContain('role="status"');
    expect(source.match(/aria-hidden="true"/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("the project error boundary asks the server again and offers the Projects list", () => {
    const source = read("app/(nesto)/projects/[projectId]/error.tsx");
    expect(source).toContain("router.refresh()");
    expect(source).toContain('href="/projects"');
    // The thrown message could name a record the reader may not see.
    expect(source).not.toMatch(/error\.message/);
  });
});
