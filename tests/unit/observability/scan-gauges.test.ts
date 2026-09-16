import { describe, expect, it } from "vitest";

import { SCAN_LEASE_SECONDS } from "@/lib/core/observability/operational-gauges";
import { SCAN_LEASE_MS } from "@/lib/modules/documents/storage/scan.service";

describe("scan gauges", () => {
  it("count a claim as abandoned exactly when the sweep would take it back", () => {
    expect(SCAN_LEASE_SECONDS * 1000).toBe(SCAN_LEASE_MS);
  });
});
