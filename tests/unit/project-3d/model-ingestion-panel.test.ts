import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModelIngestionPanel, type IngestionSlot } from "@/components/3d/platform/ModelIngestionPanel";

const mocks = vi.hoisted(() => ({ api: vi.fn(), put: vi.fn(), check: vi.fn(), toast: vi.fn(), router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("@/components/3d/platform/RemoveModelDialog", () => ({ RemoveModelDialog: () => null }));
vi.mock("@/components/engineering/engineering-api", async (original) => ({ ...await original<object>(), engineeringApi: mocks.api }));
vi.mock("@/lib/3d/platform/model-upload", async (original) => ({ ...await original<object>(), checkModelFile: mocks.check, putModelFile: mocks.put }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const intent = { versionId: "v1", upload: { method: "PUT", url: "/signed", headers: {}, expiresAt: "2099-01-01T00:00:00Z" } };
const slot: IngestionSlot = { id: "slot1", displayName: "Building", role: "BUILDING", versions: [] };
const networkFailure = { status: 0, code: "NETWORK", message: "Connection lost", details: {} };
let renderer: ReactTestRenderer;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.check.mockResolvedValue(undefined);
  mocks.put.mockResolvedValue(undefined);
  vi.stubGlobal("window", { setInterval, clearInterval, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("document", { visibilityState: "visible" });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function prepare(options: { existing?: boolean; onQueued?: (id: string) => void; limit?: number } = {}) {
  await act(async () => {
    renderer = create(React.createElement(ModelIngestionPanel, { compact: true, projectId: "project1", slots: options.existing ? [slot] : [], uploadLimitBytes: options.limit, onQueued: options.onQueued }));
  });
  await act(async () => {
    if (options.existing) renderer.root.findAllByType("select")[0].props.onChange({ target: { value: "slot1" } });
  });
  await act(async () => {
    await renderer.root.findByProps({ type: "file" }).props.onChange({ target: { files: [new File(["model"], "building.glb")] } });
  });
}
async function submit() {
  await act(async () => { await renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
}
const paths = () => mocks.api.mock.calls.map((call) => String(call[0]).replace("/api/platform/3d/projects/project1", ""));

describe("model upload", () => {
  it("creates the model, sends the bytes to the grant and verifies them, named from the file", async () => {
    const onQueued = vi.fn();
    mocks.api.mockResolvedValueOnce({ id: "slot1" }).mockResolvedValueOnce(intent).mockResolvedValueOnce({ status: "PROCESSING" });
    await prepare({ onQueued });
    await submit();
    expect(paths()).toEqual(["/slots", "/slots/slot1/uploads", "/versions/v1/complete"]);
    expect(mocks.api.mock.calls[0][1].body).toMatchObject({ kind: "DETAIL", role: "BUILDING", displayName: "building" });
    expect(mocks.api.mock.calls[0][1].body).not.toHaveProperty("reason");
    expect(mocks.api.mock.calls[0][1].body.slotKey).toMatch(/^building-[0-9a-f]{8}$/);
    expect(mocks.api.mock.calls[1][1].body).toEqual({ fileName: "building.glb", sizeBytes: 5 });
    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(onQueued).toHaveBeenCalledWith("v1");
    expect(renderer.root.findByProps({ role: "status" }).children.join("")).toContain("Preparing");
    expect(mocks.router.refresh).toHaveBeenCalled();
  });

  it("adds a version to an existing model without creating another", async () => {
    mocks.api.mockResolvedValueOnce(intent).mockResolvedValueOnce({ status: "PROCESSING" });
    await prepare({ existing: true });
    await submit();
    expect(paths()).toEqual(["/slots/slot1/uploads", "/versions/v1/complete"]);
  });

  it("checks the file against this deployment's limit before anything is created", async () => {
    mocks.check.mockRejectedValue(new Error("This model is 60 MB; this deployment accepts GLB files up to 50 MB."));
    await prepare({ limit: 50 * 1024 * 1024 });
    expect(mocks.check).toHaveBeenCalledWith(expect.any(File), 50 * 1024 * 1024);
    expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toContain("50 MB");
    await submit();
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("retries a failed verification against the same version without sending the bytes again", async () => {
    mocks.api.mockResolvedValueOnce(intent).mockRejectedValueOnce(networkFailure).mockResolvedValueOnce({ status: "PROCESSING" });
    await prepare({ existing: true });
    await submit();
    expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toBe("Connection lost");
    await submit();
    expect(paths()).toEqual(["/slots/slot1/uploads", "/versions/v1/complete", "/versions/v1/complete"]);
    expect(mocks.put).toHaveBeenCalledTimes(1);
  });

  it("keeps the grant and the version when the transfer fails", async () => {
    mocks.api.mockResolvedValueOnce(intent).mockResolvedValueOnce({ status: "PROCESSING" });
    mocks.put.mockRejectedValueOnce(new Error("Storage offline")).mockResolvedValueOnce(undefined);
    await prepare({ existing: true });
    await submit();
    await submit();
    expect(paths()).toEqual(["/slots/slot1/uploads", "/versions/v1/complete"]);
    expect(mocks.put.mock.calls[0][0]).toBe(mocks.put.mock.calls[1][0]);
  });

  it("reuses the model it already created when the grant request fails", async () => {
    mocks.api.mockResolvedValueOnce({ id: "slot1" }).mockRejectedValueOnce(networkFailure).mockResolvedValueOnce(intent).mockResolvedValueOnce({ status: "PROCESSING" });
    await prepare();
    await submit();
    await submit();
    expect(paths()).toEqual(["/slots", "/slots/slot1/uploads", "/slots/slot1/uploads", "/versions/v1/complete"]);
  });
});

describe("processing status on the Models page", () => {
  it("polls statuses only and refreshes the page data once one changes", async () => {
    const slots: IngestionSlot[] = [{ ...slot, versions: [{ id: "v1", version: 1, originalFileName: "a.glb", status: "PROCESSING", validationStatus: "PENDING" }] }];
    mocks.api.mockResolvedValueOnce([{ id: "v1", status: "PROCESSING", stalled: false }]).mockResolvedValueOnce([{ id: "v1", status: "READY", stalled: false }]);
    await act(async () => { renderer = create(React.createElement(ModelIngestionPanel, { projectId: "project1", slots })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(paths()).toEqual(["/model-status"]);
    expect(mocks.router.refresh).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not poll when nothing is being prepared", async () => {
    const slots: IngestionSlot[] = [{ ...slot, versions: [{ id: "v1", version: 1, originalFileName: "a.glb", status: "READY", validationStatus: "READY" }] }];
    await act(async () => { renderer = create(React.createElement(ModelIngestionPanel, { projectId: "project1", slots })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(mocks.api).not.toHaveBeenCalled();
  });
});
