import { describe, expect, it } from "vitest";

import {
  assertSingleCurrency,
  groupByCurrency,
  groupByUnit,
} from "@/lib/core/reporting/report-currency.service";
import { findMetric, metricDefinitions } from "@/lib/core/reporting/metric.registry";

/**
 * The rule this guards: NESTO has no FX engine, so a total across currencies
 * would be a fabricated number presented authoritatively (PRD #27 §99, §418).
 */
describe("groupByCurrency", () => {
  it("keeps currencies apart and warns when there is more than one", () => {
    const { groups, warnings } = groupByCurrency([
      { currency: "EUR", amount: "100.00" },
      { currency: "USD", amount: "50.00" },
      { currency: "EUR", amount: "25.50" },
    ]);

    expect(groups).toEqual([
      { currency: "EUR", total: "125.50" },
      { currency: "USD", total: "50.00" },
    ]);
    expect(warnings[0]?.code).toBe("MULTIPLE_CURRENCIES");
  });

  it("does not warn for a single currency", () => {
    const { groups, warnings } = groupByCurrency([{ currency: "EUR", amount: "10.00" }]);
    expect(groups).toEqual([{ currency: "EUR", total: "10.00" }]);
    expect(warnings).toEqual([]);
  });
});

describe("groupByUnit", () => {
  it("never adds incompatible units together", () => {
    const { groups, warnings } = groupByUnit([
      { unit: "kg", quantity: 10 },
      { unit: "pcs", quantity: 4 },
      { unit: "kg", quantity: 2 },
    ]);

    expect(groups).toEqual([
      { unit: "kg", total: "12" },
      { unit: "pcs", total: "4" },
    ]);
    expect(warnings[0]?.code).toBe("MIXED_UNITS");
  });
});

describe("assertSingleCurrency", () => {
  it("refuses a mixed-currency total outright", () => {
    expect(() => assertSingleCurrency([{ currency: "EUR" }, { currency: "USD" }])).toThrow(
      "MULTIPLE_CURRENCIES_UNSUPPORTED",
    );
  });
});

describe("metric registry", () => {
  it("registers each metric key once", () => {
    const keys = metricDefinitions().map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("groups every money metric by currency", () => {
    for (const metric of metricDefinitions().filter((m) => m.valueType === "CURRENCY")) {
      expect(metric.currencyBehavior, metric.key).toBe("GROUPED");
    }
  });

  it("says which date field drives every flow metric", () => {
    for (const metric of metricDefinitions().filter((m) => m.kind === "FLOW")) {
      expect(metric.dateField, metric.key).toBeTruthy();
    }
  });

  it("gives every metric a permission to check", () => {
    for (const metric of metricDefinitions()) {
      expect(metric.requiredPermission, metric.key).toBeTruthy();
    }
    expect(findMetric("finance.invoice.outstanding")).toBeDefined();
  });
});
