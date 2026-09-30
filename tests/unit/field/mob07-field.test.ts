import { describe, expect, it } from "vitest";

import { getCaptureService, setCaptureService, webCaptureService, CaptureError, type CaptureService } from "@/lib/field/capture-service";
import { viewerKindFor } from "@/lib/field/document-service";
import { prepareImage } from "@/lib/field/image-prepare";
import { hasExif } from "@/lib/modules/daily-logs/daily-log.exif";

/** A tiny JPEG carrying an EXIF (GPS) segment, as a phone would write it. */
function jpegWithExif(): Uint8Array {
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x47, 0x50, 0x53];
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, exif.length + 2, ...exif, 0xff, 0xd9]);
}

describe("viewerKindFor", () => {
  it("picks the viewer from the type the list already knows", () => {
    expect(viewerKindFor("application/pdf")).toBe("pdf");
    expect(viewerKindFor(null, "PDF")).toBe("pdf");
    expect(viewerKindFor("image/jpeg")).toBe("image");
    expect(viewerKindFor(null, ".png")).toBe("image");
    expect(viewerKindFor("application/vnd.ms-excel", "xlsx")).toBeNull();
  });
});

describe("prepareImage", () => {
  it("removes location metadata from a small JPEG without touching its pixels", async () => {
    const file = new File([jpegWithExif() as BlobPart], "site.jpg", { type: "image/jpeg" });
    const prepared = await prepareImage(file);
    expect(hasExif(new Uint8Array(await prepared.arrayBuffer()))).toBe(false);
    expect(prepared.name).toBe("site.jpg");
  });

  it("leaves a PNG (drawings, screenshots, text) exactly as chosen", async () => {
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "plan.png", { type: "image/png" });
    expect(await prepareImage(file)).toBe(file);
  });

  it("keeps the original when evidence policy says so", async () => {
    const file = new File([jpegWithExif() as BlobPart], "original.jpg", { type: "image/jpeg" });
    expect(await prepareImage(file, { keepOriginal: true })).toBe(file);
  });

  it("does not throw on a file that is not really a JPEG", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "broken.jpg", { type: "image/jpeg" });
    await expect(prepareImage(file)).resolves.toBe(file);
  });
});

describe("CaptureService boundary", () => {
  it("defaults to the web adapter and can be replaced by a native one", async () => {
    expect(getCaptureService()).toBe(webCaptureService);
    const native: CaptureService = {
      supportsCamera: true,
      capturePhoto: async () => {
        throw new CaptureError("PERMISSION_DENIED");
      },
      selectPhotos: async () => [],
      selectFiles: async () => [],
    };
    setCaptureService(native);
    try {
      expect(getCaptureService()).toBe(native);
      await expect(getCaptureService().capturePhoto()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    } finally {
      setCaptureService(webCaptureService);
    }
  });
});
