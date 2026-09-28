import { crc32, deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { DEFAULT_PROJECT_3D_CONFIG } from "@/lib/3d/shared/experience";
import { parseByteRange, readProject3DAssetHandle, signProject3DAssetHandle } from "@/lib/modules/project-3d/project-3d.delivery";
import { project3DAvailability } from "@/lib/modules/project-3d/project-3d.lifecycle";
import { stripJpegMetadata, stripPngMetadata, stripWebpMetadata } from "@/lib/modules/project-3d/processing/glb.public";
import { projectPublicExperience, PUBLIC_EXPERIENCE_KEYS, PUBLIC_REBUILT_KEYS, WITHHELD_EXPERIENCE_KEYS } from "@/lib/modules/project-3d/public/public-experience";

describe("public experience allowlist (ADM-04A §7)", () => {
  it("decides every configuration key: public, rebuilt or withheld — a new key fails here until someone decides", () => {
    const decided = new Set<string>([...PUBLIC_EXPERIENCE_KEYS, ...PUBLIC_REBUILT_KEYS, ...WITHHELD_EXPERIENCE_KEYS]);
    const undecided = Object.keys(DEFAULT_PROJECT_3D_CONFIG).filter((key) => !decided.has(key));
    expect(undecided).toEqual([]);
    expect(PUBLIC_EXPERIENCE_KEYS.filter((key) => (WITHHELD_EXPERIENCE_KEYS as readonly string[]).includes(key))).toEqual([]);
  });

  it("withholds location, backdrop URLs and author text; keeps rendering behaviour", () => {
    const authored = {
      ...(DEFAULT_PROJECT_3D_CONFIG as unknown as Record<string, unknown>),
      exposure: 1.7, geoLatitude: 41.3, geoLongitude: 19.8, mapViewEnabled: true, mapViewLatitude: 41.3, siteEnabled: true,
      backdropEnabled: true, backdropImageUrl: "https://internal.example/backdrop.jpg",
      cameraPresets: [{ id: "x", label: "Owner's terrace", position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 }, fov: 50, durationMs: 700 }],
      sections: [{ id: "s", name: "Block A — investor floor", buildingName: "Secret block", scope: "building", centerX: 1, centerZ: 2, widthM: 3, depthM: 4, rotationDeg: 0, heightM: 5, bottomEnabled: true, fillGapsEnabled: false, fillColor: "#abcdef" }],
      artificialLights: [{ id: "l", name: "Lobby", type: "ies", iesProfileUrl: "https://internal.example/p.ies" }],
    };
    const out = projectPublicExperience(authored, { availability: false });
    const json = JSON.stringify(out);
    for (const leak of ["41.3", "19.8", "internal.example", "Owner's terrace", "investor", "Secret block", "Lobby"]) expect(json).not.toContain(leak);
    expect(out).toMatchObject({ exposure: 1.7, mapViewEnabled: false, siteEnabled: false, backdropEnabled: false, solarPathMode: "manual", unitBlocksStatusColorsEnabled: false });
    expect(out.cameraPresets).toEqual([{ id: "c1", label: "View 1", position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 }, fov: 50, durationMs: 700 }]);
    expect(out.artificialLights).toEqual([]);
    expect(out.viewerUI).toMatchObject({ unitPageLinkEnabled: false, filterPriceEnabled: false, statusColorsEnabled: false });
  });
});

describe("delivery handles and ranges (ADM-04A §8, EV-25)", () => {
  const claims = { c: "config", r: "release", a: "m1", au: "public" as const, e: 3 };

  it("accepts only handles this server signed, unaltered", () => {
    const handle = signProject3DAssetHandle(claims);
    expect(readProject3DAssetHandle(handle)).toEqual({ v: 1, ...claims });
    const [payload, signature] = handle.split(".");
    const other = Buffer.from(JSON.stringify({ v: 1, ...claims, e: 4 })).toString("base64url");
    expect(readProject3DAssetHandle(`${other}.${signature}`)).toBeNull();
    expect(readProject3DAssetHandle(`${payload}.${signature}x`)).toBeNull();
    expect(readProject3DAssetHandle(`${payload}.${signature}.extra`)).toBeNull();
    expect(readProject3DAssetHandle("a".repeat(700))).toBeNull();
    expect(readProject3DAssetHandle("")).toBeNull();
  });

  it("serves one bounded byte range and refuses anything unusual", () => {
    expect(parseByteRange(null, 100)).toBeNull();
    expect(parseByteRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=50-5000", 100)).toEqual({ start: 50, end: 99 });
    for (const header of ["bytes=0-1,5-6", "items=0-1", "bytes=-", "bytes=100-", "bytes=9-3", "bytes=-0", "bytes=abc", "bytes=0-99999999999999999"]) {
      expect(parseByteRange(header, 100)).toBe("unsatisfiable");
    }
  });
});

describe("embedded image metadata (EV-11)", () => {
  const pngChunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
    return out;
  };

  it("keeps PNG pixels and drops text, time and EXIF chunks", () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])),
      pngChunk("tEXt", Buffer.from("Author\0Jane")),
      pngChunk("eXIf", Buffer.from("GPS 41.3")),
      pngChunk("IDAT", deflateSync(Buffer.from([0, 1, 2, 3]))),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    const clean = Buffer.from(stripPngMetadata(png)).toString("latin1");
    expect(clean).not.toContain("Jane");
    expect(clean).not.toContain("GPS");
    expect(clean).toContain("IDAT");
  });

  it("drops JPEG EXIF/XMP and comments but keeps JFIF and the scan", () => {
    const segment = (marker: number, body: string) => Buffer.concat([Buffer.from([0xff, marker]), Buffer.from([0, body.length + 2]), Buffer.from(body, "latin1")]);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), segment(0xe0, "JFIF\0"), segment(0xe1, "Exif\0GPS 41.3"), segment(0xfe, "Jane"), Buffer.from([0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9])]);
    const clean = Buffer.from(stripJpegMetadata(jpeg)).toString("latin1");
    expect(clean).toContain("JFIF");
    expect(clean).not.toContain("GPS");
    expect(clean).not.toContain("Jane");
  });

  it("drops WebP EXIF/XMP chunks and their VP8X flags", () => {
    const chunk = (fourcc: string, body: Buffer) => { const size = Buffer.alloc(4); size.writeUInt32LE(body.length); return Buffer.concat([Buffer.from(fourcc, "ascii"), size, body, body.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]); };
    const vp8x = Buffer.alloc(10);
    vp8x[0] = 0x08 | 0x04;
    const body = Buffer.concat([Buffer.from("WEBP"), chunk("VP8X", vp8x), chunk("VP8L", Buffer.from([1, 2, 3, 4])), chunk("EXIF", Buffer.from("GPS 41.3")), chunk("XMP ", Buffer.from("<x>Jane</x>"))]);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(body.length);
    const clean = Buffer.from(stripWebpMetadata(Buffer.concat([Buffer.from("RIFF"), size, body])));
    expect(clean.toString("latin1")).not.toContain("GPS");
    expect(clean.toString("latin1")).not.toContain("Jane");
    expect(clean.readUInt32LE(4)).toBe(clean.length - 8);
    expect(clean[20] & 0x0c).toBe(0);
  });
});

describe("availability is not visibility (ADM-04A §3)", () => {
  const live = { visibility: "COMPANY_ONLY" as const, deletedAt: null, activeRelease: { status: "PUBLISHED", publicManifestHash: null }, entitlement: { status: "ACTIVE" as const, viewerEnabled: true, activatedAt: null, expiresAt: null }, project: { archivedAt: null, status: "FINISHED" }, companyStatus: "ACTIVE", groupStatus: "ACTIVE" };

  it("names each blocker, keeps completed projects eligible, and needs an approved projection only for PUBLIC", () => {
    expect(project3DAvailability(live)).toEqual({ available: true, blockers: [] });
    expect(project3DAvailability({ ...live, visibility: "PUBLIC" }).blockers).toEqual(["PUBLIC_PROJECTION_MISSING"]);
    expect(project3DAvailability({ ...live, entitlement: { ...live.entitlement, expiresAt: new Date(Date.now() - 1000) } }).blockers).toEqual(["ENTITLEMENT_INACTIVE"]);
    expect(project3DAvailability({ ...live, companyStatus: "SUSPENDED", project: { archivedAt: new Date(), status: "ARCHIVED" } }).blockers).toEqual(["ORGANIZATION_INACTIVE", "PROJECT_INELIGIBLE"]);
    expect(project3DAvailability({ ...live, visibility: "OFFLINE", deletedAt: new Date(), activeRelease: null }).blockers).toEqual(["DELETED", "OFFLINE", "NO_RELEASE"]);
  });
});
