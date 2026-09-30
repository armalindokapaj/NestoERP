import { describe, expect, it } from "vitest";

import { switchProjectHref } from "@/lib/modules/projects/project.switch";

const segments = ["planning", "units", "sales", "tasks", "calendar", "documents"];

describe("switchProjectHref (MOB-05 §58)", () => {
  it("keeps the section the person is in", () => {
    expect(switchProjectHref("/projects/a/tasks", "a", "b", segments)).toBe("/projects/b/tasks");
  });
  it("falls back to Overview from the overview itself", () => {
    expect(switchProjectHref("/projects/a", "a", "b", segments)).toBe("/projects/b");
  });
  it("falls back to Overview for a section the person's tabs do not include", () => {
    expect(switchProjectHref("/projects/a/hse", "a", "b", segments)).toBe("/projects/b");
  });
  it("lands on the section's list, never on the old project's record", () => {
    expect(switchProjectHref("/projects/a/units/unit-1", "a", "b", segments)).toBe("/projects/b/units");
  });
  it("never keeps the 3D section", () => {
    expect(switchProjectHref("/projects/a/3d", "a", "b", [...segments, "3d"])).toBe("/projects/b");
  });
});
