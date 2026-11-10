import { describe, expect, it } from "vitest";

import { siteEn } from "@/lib/i18n/site/en";
import { APPLICATION_STEPS, applicationReference, createApplicationSchema } from "@/lib/marketing/apply-schema";

/** Applying for a workspace (/apply; UI-05 §6). */
const schema = createApplicationSchema(siteEn.apply.errors);

const valid = {
  company: "Meridian Development",
  country: "Albania",
  city: "Tirana",
  kind: "DEVELOPER",
  size: "51-200",
  name: "Arta Leka",
  email: "arta@meridian.example",
  phone: "",
  role: "owner",
  departments: ["sales", "finance"],
  projects: 3,
  users: 25,
  start: "quarter",
  consent: true,
} as const;

describe("application schema", () => {
  it("accepts a complete application", () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it("refuses an application without consent, in the reader's words", () => {
    const result = schema.safeParse({ ...valid, consent: false });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(siteEn.apply.errors.consentRequired);
  });

  it("refuses answers the form does not offer", () => {
    expect(schema.safeParse({ ...valid, kind: "BANK" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, departments: ["payroll"] }).success).toBe(false);
    expect(schema.safeParse({ ...valid, users: 2 }).success).toBe(false);
  });

  it("asks every field in exactly one step", () => {
    const asked = Object.values(APPLICATION_STEPS).flat();
    expect(new Set(asked).size).toBe(asked.length);
    expect([...asked, "website"].sort()).toEqual(Object.keys(schema.shape).sort());
  });

  it("gives a reference an applicant can quote", () => {
    expect(applicationReference(new Date("2026-11-10T09:00:00Z"), "a1b2c3d4-0000-0000-0000-000000000000")).toBe("NST-2026-A1B2C3");
  });
});
