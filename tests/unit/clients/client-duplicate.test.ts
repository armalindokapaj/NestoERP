import { describe, expect, it } from "vitest";

import { normalizeName } from "@/lib/modules/clients/client.duplicate";
import {
  canTransitionClientStatus,
  canTransitionContactStatus,
  isClientArchived,
  isContactArchived,
} from "@/lib/modules/clients/client.status";
import { createClientSchema, updateClientSchema } from "@/lib/modules/clients/client.schema";

/**
 * Client normalisation, status rules and input validation (PRD #12 §47, §55,
 * §70, §152).
 */
describe("name normalisation (PRD #12 §55)", () => {
  it("folds case, punctuation and repeated spaces", () => {
    expect(normalizeName("  ACME   Developments ")).toBe("acme developments");
    expect(normalizeName("ACME Developments sh.p.k.")).toBe("acme developments sh p k");
    expect(normalizeName("Smith & Sons (Holdings)")).toBe("smith sons holdings");
  });

  /** Similar is not the same: only a person can judge these (PRD #12 §52). */
  it("does not collapse a singular into a plural", () => {
    expect(normalizeName("ACME Development")).not.toBe(normalizeName("ACME Developments"));
  });
});

describe("status transitions (PRD #12 §70)", () => {
  it("moves between active and inactive", () => {
    expect(canTransitionClientStatus("ACTIVE", "INACTIVE")).toBe(true);
    expect(canTransitionClientStatus("INACTIVE", "ACTIVE")).toBe(true);
    expect(canTransitionContactStatus("ACTIVE", "INACTIVE")).toBe(true);
  });

  /** Archiving and restoring are dedicated endpoints (PRD #12 §71, §74). */
  it("refuses to reach or leave ARCHIVED through an ordinary update", () => {
    expect(canTransitionClientStatus("ACTIVE", "ARCHIVED")).toBe(false);
    expect(canTransitionClientStatus("ARCHIVED", "ACTIVE")).toBe(false);
    expect(canTransitionContactStatus("ARCHIVED", "ACTIVE")).toBe(false);
  });

  it("detects archived from either the status or the timestamp", () => {
    expect(isClientArchived({ status: "ARCHIVED", archivedAt: null })).toBe(true);
    expect(isClientArchived({ status: "ACTIVE", archivedAt: new Date() })).toBe(true);
    expect(isClientArchived({ status: "ACTIVE", archivedAt: null })).toBe(false);
    expect(isContactArchived({ status: "ARCHIVED", archivedAt: null })).toBe(true);
  });
});

describe("input validation (PRD #12 §42–§48)", () => {
  const base = { name: "Harbor Development Group", type: "COMPANY" };

  it("accepts a minimal client", () => {
    const parsed = createClientSchema.parse(base);
    expect(parsed.name).toBe("Harbor Development Group");
    expect(parsed.status).toBe("ACTIVE");
  });

  it("requires a name of at least two characters", () => {
    expect(() => createClientSchema.parse({ ...base, name: "A" })).toThrow();
  });

  /** A link is only a link if it is http(s) (PRD #12 §47, §140). */
  it("refuses a website that is not http or https", () => {
    expect(() =>
      createClientSchema.parse({ ...base, website: "javascript:alert(1)" }),
    ).toThrow();
    expect(() => createClientSchema.parse({ ...base, website: "example.com" })).toThrow();
    expect(createClientSchema.parse({ ...base, website: "https://example.com" }).website).toBe(
      "https://example.com",
    );
  });

  it("refuses an invalid email but accepts an empty one", () => {
    expect(() => createClientSchema.parse({ ...base, email: "not-an-email" })).toThrow();
    expect(createClientSchema.parse({ ...base, email: "" }).email).toBeUndefined();
  });

  /** A half-filled contact is a mistake, not a contact. */
  it("refuses a primary contact with only one name", () => {
    expect(() =>
      createClientSchema.parse({ ...base, contactFirstName: "Mira" }),
    ).toThrow();
    expect(
      createClientSchema.parse({ ...base, contactFirstName: "Mira", contactLastName: "Kola" })
        .contactLastName,
    ).toBe("Kola");
  });

  it("never accepts server-controlled fields from the browser (PRD #12 §124)", () => {
    const parsed = updateClientSchema.parse({
      ...base,
      companyId: "company_other",
      createdBy: "someone",
      archivedAt: "2020-01-01",
      preArchiveStatus: "ACTIVE",
    }) as Record<string, unknown>;

    expect(parsed.companyId).toBeUndefined();
    expect(parsed.createdBy).toBeUndefined();
    expect(parsed.archivedAt).toBeUndefined();
    expect(parsed.preArchiveStatus).toBeUndefined();
  });
});
