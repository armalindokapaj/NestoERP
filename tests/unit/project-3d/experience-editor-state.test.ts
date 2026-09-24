import { describe, expect, it } from "vitest";

import {
  clampPanelWidth,
  classifySaveFailure,
  editorSaveStatus,
  noticeForStateCheck,
  PANEL_LIMITS,
  SAVE_STATUS_LABEL,
} from "@/components/3d/platform/editor/save-state";

describe("Experience Editor save state", () => {
  it("moves Saved → Unsaved → Saving → Saved, and keeps a failed save unsaved", () => {
    expect(editorSaveStatus({ dirty: false, saving: false, failed: false })).toBe("saved");
    expect(editorSaveStatus({ dirty: true, saving: false, failed: false })).toBe("unsaved");
    expect(editorSaveStatus({ dirty: true, saving: true, failed: false })).toBe("saving");
    expect(editorSaveStatus({ dirty: true, saving: false, failed: true })).toBe("failed");
    // A failure that is later resolved, or a draft that became clean, reads as saved.
    expect(editorSaveStatus({ dirty: false, saving: false, failed: true })).toBe("saved");
    expect(Object.values(SAVE_STATUS_LABEL)).toEqual(["Saved", "Unsaved changes", "Saving…", "Save failed"]);
  });

  it("tells a concurrent edit, an ended session and changed access apart from other failures", () => {
    expect(classifySaveFailure({ status: 409, code: "CONFLICT", message: "", detailCode: "EXPERIENCE_RACED", details: {} })).toBe("conflict");
    expect(classifySaveFailure({ status: 409, code: "CONFLICT", message: "", detailCode: "MODEL_RACED", details: {} })).toBe("conflict");
    expect(classifySaveFailure({ status: 409, code: "CONFLICT", message: "", detailCode: "MODEL_NOT_READY", details: {} })).toBe("other");
    expect(classifySaveFailure({ status: 401, code: "UNAUTHENTICATED", message: "", details: {} })).toBe("session");
    expect(classifySaveFailure({ status: 403, code: "FORBIDDEN", message: "", details: {} })).toBe("access");
    expect(classifySaveFailure({ status: 422, code: "VALIDATION_ERROR", message: "", details: {} })).toBe("other");
    expect(classifySaveFailure({ status: 0, code: "NETWORK", message: "", details: {} })).toBe("other");
    expect(classifySaveFailure(new Error("boom"))).toBe("other");
  });

  it("turns a focus check into a notice only when something changed", () => {
    expect(noticeForStateCheck({ ok: true, revision: 4 }, 4)).toBeNull();
    expect(noticeForStateCheck({ ok: true, revision: 5 }, 4)).toEqual({ kind: "conflict", revision: 5 });
    expect(noticeForStateCheck({ ok: true, revision: Number.NaN }, 4)).toBeNull();
    expect(noticeForStateCheck({ ok: false, status: 401 }, 4)).toEqual({ kind: "session" });
    expect(noticeForStateCheck({ ok: false, status: 403 }, 4)).toEqual({ kind: "access" });
    expect(noticeForStateCheck({ ok: false, status: 404 }, 4)).toEqual({ kind: "access" });
    expect(noticeForStateCheck({ ok: false, status: 503 }, 4)).toBeNull();
  });

  it("keeps side panels inside their limits so the viewport keeps its area", () => {
    expect(clampPanelWidth("left", 10)).toBe(PANEL_LIMITS.left.min);
    expect(clampPanelWidth("left", 10_000)).toBe(PANEL_LIMITS.left.max);
    expect(clampPanelWidth("right", 300.4)).toBe(300);
    expect(clampPanelWidth("right", Number.NaN)).toBe(PANEL_LIMITS.right.initial);
  });
});
