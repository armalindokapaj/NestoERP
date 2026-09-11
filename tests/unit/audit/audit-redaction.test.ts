import { describe, expect, it } from "vitest";

import { REDACTED, applyRedaction } from "@/lib/core/audit/audit-redaction";

/**
 * Audit must not become a second copy of the database holding every sensitive
 * value (PRD #28 §37-§44, §379).
 */
describe("applyRedaction", () => {
  it("keeps only the fields a policy allows", () => {
    const result = applyRedaction(
      { status: "APPROVED", totalAmount: "100.00", internalNote: "private" },
      ["status", "totalAmount"],
    );

    expect(result).toEqual({ status: "APPROVED", totalAmount: "100.00" });
    expect(result).not.toHaveProperty("internalNote");
  });

  it("drops forbidden keys even when a policy names them", () => {
    for (const field of ["password", "passwordHash", "sessionToken", "resetToken", "apiKey", "signedUrl", "iban"]) {
      const result = applyRedaction({ [field]: "secret-value", status: "OK" }, [field, "status"]);
      expect(result, `${field} reached storage`).toEqual({ status: "OK" });
    }
  });

  it("masks sensitive fields rather than dropping the fact they changed", () => {
    const result = applyRedaction({ amount: "94000.00" }, ["amount"], ["amount"]);
    expect(result).toEqual({ amount: REDACTED });
  });

  it("normalises dates and decimals to exact strings", () => {
    const result = applyRedaction(
      { effectiveFrom: new Date("2026-09-11T00:00:00.000Z"), size: BigInt(42) },
      ["effectiveFrom", "size"],
    );
    expect(result).toEqual({ effectiveFrom: "2026-09-11T00:00:00.000Z", size: "42" });
  });

  it("returns null rather than an empty object", () => {
    expect(applyRedaction({ other: 1 }, ["status"])).toBeNull();
    expect(applyRedaction(null, ["status"])).toBeNull();
  });
});
