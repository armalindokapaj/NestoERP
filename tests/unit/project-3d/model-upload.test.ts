import { afterEach, describe, expect, it, vi } from "vitest";
import { checkModelFile, MAX_MODEL_BYTES, putModelFile, type ModelUploadIntent } from "@/lib/3d/platform/model-upload";
import { optimizeGlbForDeliveryDetailed } from "@/lib/modules/project-3d/processing/glb.optimize";

function glb(json: object = { asset: { version: "2.0" } }) {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const size = Math.ceil(encoded.length / 4) * 4;
  const bytes = new Uint8Array(20 + size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true); view.setUint32(12, size, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20); bytes.set(encoded, 20);
  return bytes;
}

describe("GLB upload preflight", () => {
  it("accepts GLB regardless of browser MIME type and reads only twelve bytes", async () => {
    const file = new File([glb()], "building.GLB", { type: "application/octet-stream" });
    const slice = vi.spyOn(file, "slice");
    await expect(checkModelFile(file)).resolves.toBeUndefined();
    expect(slice).toHaveBeenCalledExactlyOnceWith(0, 12);
  });
  it("refuses unsupported, empty, oversized and truncated models before allocation", async () => {
    await expect(checkModelFile(new File([glb()], "model.fbx"))).rejects.toThrow("Export other formats");
    await expect(checkModelFile(new File([], "model.glb"))).rejects.toThrow("empty");
    const slice = vi.fn();
    await expect(checkModelFile({ name: "large.glb", size: MAX_MODEL_BYTES + 1, slice } as unknown as File)).rejects.toThrow("200 MB");
    expect(slice).not.toHaveBeenCalled();
    await expect(checkModelFile(new File([glb().slice(0, -4)], "broken.glb"))).rejects.toThrow("complete GLB");
  });
});

describe("private model transfer", () => {
  const intent: ModelUploadIntent = { versionId: "version", upload: { method: "PUT", url: "https://storage.invalid/signed", headers: { "Content-Type": "model/gltf-binary", "If-None-Match": "*" }, expiresAt: "2099-01-01T00:00:00Z" } };
  let request: FakeRequest;
  class FakeRequest {
    status = 200; timeout = 0;
    upload = { onprogress: vi.fn<(event: { lengthComputable: boolean; loaded: number; total: number }) => void>() };
    open = vi.fn(); setRequestHeader = vi.fn(); send = vi.fn();
    onload = () => {}; onerror = () => {}; ontimeout = () => {}; onabort = () => {};
    // Capture the constructed transport so tests can deliver browser events.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    constructor() { request = this; }
  }
  afterEach(() => vi.unstubAllGlobals());
  it("sends the File and signed headers directly, reporting measured progress", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    const file = new File([glb()], "model.glb");
    const progress = vi.fn();
    const transfer = putModelFile(intent, file, progress);
    expect(request.open).toHaveBeenCalledWith("PUT", intent.upload.url);
    expect(request.setRequestHeader).toHaveBeenCalledWith("If-None-Match", "*");
    expect(request.send).toHaveBeenCalledWith(file);
    request.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 });
    expect(progress).toHaveBeenCalledWith(50);
    request.onload();
    await expect(transfer).resolves.toBeUndefined();
  });
  it("continues to server verification after an immutable-key retry returns 412", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    const transfer = putModelFile(intent, new File([glb()], "model.glb"), vi.fn());
    request.status = 412; request.onload();
    await expect(transfer).resolves.toBeUndefined();
  });
  it.each([
    ["an S3 412", 412, ""],
    ["a Supabase duplicate", 400, JSON.stringify({ statusCode: "409", error: "Duplicate", code: "KeyAlreadyExists" })],
  ])("treats %s as bytes that already arrived, for /complete to verify", async (_name, status, body) => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    const transfer = putModelFile(intent, new File([glb()], "model.glb"), vi.fn());
    Object.assign(request, { status, responseText: body });
    request.onload();
    await expect(transfer).resolves.toBeUndefined();
  });
  it("names a Supabase size refusal as a size problem", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    const transfer = putModelFile(intent, new File([glb()], "model.glb"), vi.fn());
    Object.assign(request, { status: 400, responseText: JSON.stringify({ statusCode: "413", error: "Payload too large", code: "EntityTooLarge" }) });
    request.onload();
    await expect(transfer).rejects.toThrow("file size");
  });
  it("checks against this deployment's own limit", async () => {
    const file = new File([glb()], "model.glb");
    await expect(checkModelFile(file, 10)).rejects.toThrow("up to 0 MB");
    await expect(checkModelFile(file, 1024)).resolves.toBeUndefined();
  });
  it.each([403, 413, 500])("rejects storage HTTP %s", async (status) => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    const transfer = putModelFile(intent, new File([glb()], "model.glb"), vi.fn());
    request.status = status; request.onload();
    await expect(transfer).rejects.toThrow(status === 413 ? "file size" : String(status));
  });
  it.each(["onerror", "ontimeout", "onabort"] as const)("settles %s instead of leaving an endless spinner", async (event) => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    const transfer = putModelFile(intent, new File([glb()], "model.glb"), vi.fn());
    request[event]();
    await expect(transfer).rejects.toThrow();
  });
});

describe("compressed model delivery", () => {
  it("still optimizes ordinary geometry without increasing delivery size", async () => {
    const { Document, NodeIO } = await import("@gltf-transform/core");
    const doc = new Document();
    const buffer = doc.createBuffer();
    const positions = doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer);
    const mesh = doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute("POSITION", positions));
    doc.createScene().addChild(doc.createNode("Building").setMesh(mesh));
    const io = new NodeIO();
    const bytes = await io.writeBinary(doc);
    const result = await optimizeGlbForDeliveryDetailed(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(result.bytes.byteLength).toBeLessThanOrEqual(bytes.byteLength);
    const delivery = await io.readBinary(result.bytes);
    expect(delivery.getRoot().listNodes().map((node) => node.getName())).toContain("Building");
    expect(delivery.getRoot().listMeshes()).toHaveLength(1);
  });
  it.each(["KHR_draco_mesh_compression", "EXT_meshopt_compression"])("preserves %s bytes instead of invoking an unavailable server codec", async (extension) => {
    const bytes = glb({ asset: { version: "2.0" }, extensionsUsed: [extension], extensionsRequired: [extension] });
    const result = await optimizeGlbForDeliveryDetailed(bytes.buffer);
    expect(result.bytes).toEqual(bytes);
    expect(result.report.geometryPreservedReason).toBe(extension);
    expect(result.report.outputBytes).toBe(result.report.inputBytes);
  });
  it("does not bypass malformed-container checks for compressed input", async () => {
    const bytes = glb({ extensionsUsed: ["EXT_meshopt_compression"] });
    new DataView(bytes.buffer).setUint32(4, 1, true);
    await expect(optimizeGlbForDeliveryDetailed(bytes.buffer)).rejects.toThrow("GLB 2.0");
  });
});
