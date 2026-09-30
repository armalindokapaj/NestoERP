import { describe, expect, it } from "vitest";

import { environmentRefFile, referencedEnvironmentFiles, resolveEnvironmentRefs } from "@/lib/3d/shared/environment-refs";
import { DEFAULT_PROJECT_3D_CONFIG, parseProject3DExperience } from "@/lib/3d/shared/experience";
import type { ArtificialLight } from "@/lib/3d/runtime/types";

const FILE = "0123456789abcdef0123456789abcdef.png";
const IES = "fedcba9876543210fedcba9876543210.ies";
const light = (iesProfileUrl: string | null) => ({ id: "l1", iesProfileUrl } as unknown as ArtificialLight);

describe("environment file references (Rozaris backdrop / IES uploads)", () => {
  it("reads only well-formed references", () => {
    expect(environmentRefFile(`nesto-env:${FILE}`)).toBe(FILE);
    expect(environmentRefFile("nesto-env:../../secrets.png")).toBeNull();
    expect(environmentRefFile("https://example.com/a.png")).toBeNull();
    expect(environmentRefFile(null)).toBeNull();
  });

  it("lists the files an Experience uses and resolves them for an audience", () => {
    const experience = { backdropImageUrl: `nesto-env:${FILE}`, artificialLights: [light(`nesto-env:${IES}`), light(null)] };
    expect([...referencedEnvironmentFiles(experience)].sort()).toEqual([FILE, IES].sort());
    const resolved = resolveEnvironmentRefs(experience, "/base");
    expect(resolved.backdropImageUrl).toBe(`/base/${FILE}`);
    expect(resolved.artificialLights?.map((item) => item.iesProfileUrl)).toEqual([`/base/${IES}`, null]);
    expect(resolveEnvironmentRefs({ backdropImageUrl: "nesto-env:bad" }, "/base").backdropImageUrl).toBeNull();
  });

  it("saves a backdrop reference or an https address, nothing else", () => {
    const parse = (backdropImageUrl: unknown) => parseProject3DExperience({ schemaVersion: 1, revision: 1, config: { ...DEFAULT_PROJECT_3D_CONFIG, backdropImageUrl } }).config.backdropImageUrl;
    expect(parse(`nesto-env:${FILE}`)).toBe(`nesto-env:${FILE}`);
    expect(parse("https://cdn.example.com/p.png")).toBe("https://cdn.example.com/p.png");
    expect(parse(null)).toBeNull();
    expect(() => parse("javascript:alert(1)")).toThrow();
    expect(() => parse(42)).toThrow();
  });
});
