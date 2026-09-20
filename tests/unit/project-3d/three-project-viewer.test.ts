import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const engine = vi.hoisted(() => ({
  callbacks: null as Record<string, (...args: never[]) => unknown> | null,
  dispose: vi.fn(),
  mount: vi.fn(async () => undefined),
  syncModels: vi.fn(async () => undefined),
}));

vi.mock("@/lib/3d/runtime/render-engine/RenderEngine", () => ({
  RenderEngine: class {
    constructor(callbacks: Record<string, (...args: never[]) => unknown>) { engine.callbacks = callbacks; }
    mount = engine.mount;
    syncModels = engine.syncModels;
    dispose = engine.dispose;
    setPerfStatsEnabled() {}
  },
}));

import { ThreeProjectViewer } from "@/components/3d/company/ThreeProjectViewer";

describe("ThreeProjectViewer lifecycle", () => {
  beforeEach(() => {
    engine.callbacks = null;
    engine.dispose.mockClear();
    engine.mount.mockClear();
    engine.syncModels.mockClear();
  });

  it("mounts an empty published scene, forwards unit selection, and disposes on unmount", async () => {
    const onUnitClick = vi.fn();
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(ThreeProjectViewer, {
        detailModels: [],
        onUnitClick,
        className: "viewer",
      }), { createNodeMock: () => ({}) });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(engine.mount).toHaveBeenCalledTimes(1);
    expect(engine.syncModels).toHaveBeenCalledWith([]);
    expect(() => engine.callbacks?.onUnitClick?.("unit-canonical" as never)).not.toThrow();
    expect(onUnitClick).toHaveBeenCalledWith("unit-canonical");

    await act(async () => renderer!.unmount());
    expect(engine.dispose).toHaveBeenCalledTimes(1);
  });
});
