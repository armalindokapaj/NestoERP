import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { toAmountString } from "@/lib/modules/finance/finance.money";
import {
  acceptanceRate,
  currencyTotals,
  forecastBucketFor,
  forecastBuckets,
  winRate,
  type ForecastRow,
} from "@/lib/modules/sales/opportunities/opportunity.forecast";
import {
  OPEN_STAGES,
  canTransitionOpportunityStage,
  effectiveProbability,
  getDefaultStageProbability,
  isClosedStage,
  weightedValue,
} from "@/lib/modules/sales/opportunities/opportunity.stage";
import { calculateProposal } from "@/lib/modules/sales/proposals/proposal.calculation";
import { proposalExpiry } from "@/lib/modules/sales/proposals/proposal.status";

/**
 * The calculation-critical sales logic (PRD #17 §359).
 *
 * Weighted pipeline, proposal totals, tax, win rate and acceptance rate are
 * release blockers, so they are tested as pure functions — no database, no
 * fixtures, just the arithmetic.
 */

function row(
  currency: string,
  value: string,
  stage: ForecastRow["stage"] = "PROPOSAL",
  override: string | null = null,
): ForecastRow {
  return {
    stage,
    currency,
    estimatedValue: new Prisma.Decimal(value),
    probabilityOverride: override === null ? null : new Prisma.Decimal(override),
  };
}

describe("stage probability (PRD #17 §27, §28, §67)", () => {
  it("uses the PRD's default per stage", () => {
    expect(getDefaultStageProbability("PROSPECTING")).toBe(10);
    expect(getDefaultStageProbability("QUALIFIED")).toBe(25);
    expect(getDefaultStageProbability("DISCOVERY")).toBe(40);
    expect(getDefaultStageProbability("PROPOSAL")).toBe(60);
    expect(getDefaultStageProbability("NEGOTIATION")).toBe(80);
    expect(getDefaultStageProbability("WON")).toBe(100);
    expect(getDefaultStageProbability("LOST")).toBe(0);
  });

  it("prefers a manual override over the stage default", () => {
    expect(effectiveProbability("PROPOSAL", null).toString()).toBe("60");
    expect(effectiveProbability("PROPOSAL", new Prisma.Decimal("55")).toString()).toBe("55");
  });

  it("treats a zero override as a real figure, not as absent", () => {
    // `?? ` rather than `||` is the difference between "the owner says this is
    // dead" and "fall back to 60%".
    expect(effectiveProbability("PROPOSAL", new Prisma.Decimal("0")).toString()).toBe("0");
  });
});

describe("weighted value (PRD #17 §29, §207)", () => {
  it("is value × probability ÷ 100, at currency precision", () => {
    expect(toAmountString(weightedValue("100000", 60))).toBe("60000.00");
    expect(toAmountString(weightedValue("420000", 80))).toBe("336000.00");
  });

  it("rounds half up rather than truncating", () => {
    expect(toAmountString(weightedValue("333.33", 33))).toBe("110.00");
    expect(toAmountString(weightedValue("1", 25))).toBe("0.25");
  });
});

describe("currency grouping (PRD #17 §31, §172)", () => {
  it("never sums two currencies into one figure", () => {
    const totals = currencyTotals([row("EUR", "100000"), row("USD", "50000")]);

    expect(totals).toHaveLength(2);
    expect(totals.map((total) => total.currency).sort()).toEqual(["EUR", "USD"]);
  });

  it("adds within a currency and weights each row before adding", () => {
    // 100,000 at 60% + 100,000 at 25% = 60,000 + 25,000. Summing first and
    // weighting once would give 200,000 × 42.5% = 85,000 — the same here by
    // coincidence, so the second row uses an override to break the tie.
    const totals = currencyTotals([
      row("EUR", "100000", "PROPOSAL"),
      row("EUR", "100000", "QUALIFIED", "10"),
    ]);

    expect(totals).toHaveLength(1);
    expect(totals[0].value).toBe("200000.00");
    expect(totals[0].weightedValue).toBe("70000.00");
    expect(totals[0].count).toBe(2);
  });

  it("orders the largest currency first", () => {
    const totals = currencyTotals([row("EUR", "10"), row("USD", "900000")]);
    expect(totals[0].currency).toBe("USD");
  });
});

describe("forecast buckets (PRD #17 §167, §241)", () => {
  const now = new Date(Date.UTC(2026, 5, 15));

  it("places a date in the right bucket", () => {
    expect(forecastBucketFor(new Date(Date.UTC(2026, 4, 30)), now)).toBe("OVERDUE");
    expect(forecastBucketFor(new Date(Date.UTC(2026, 5, 28)), now)).toBe("THIS_MONTH");
    expect(forecastBucketFor(new Date(Date.UTC(2026, 6, 3)), now)).toBe("NEXT_MONTH");
    expect(forecastBucketFor(new Date(Date.UTC(2026, 9, 1)), now)).toBe("LATER");
    expect(forecastBucketFor(null, now)).toBe("NO_DATE");
  });

  it("keeps the buckets in reading order and drops the empty ones", () => {
    const buckets = forecastBuckets(
      [
        { ...row("EUR", "1000"), expectedCloseDate: new Date(Date.UTC(2026, 9, 1)) },
        { ...row("EUR", "2000"), expectedCloseDate: new Date(Date.UTC(2026, 4, 1)) },
      ],
      now,
    );

    expect(buckets.map((bucket) => bucket.key)).toEqual(["OVERDUE", "LATER"]);
  });
});

describe("win rate (PRD #17 §164, §242)", () => {
  it("is won ÷ (won + lost)", () => {
    expect(winRate(3, 1)).toBe("75.0");
    expect(winRate(1, 2)).toBe("33.3");
  });

  it("answers null when nothing has been decided, rather than 0%", () => {
    // "0% of nothing" is not a fact about the sales team.
    expect(winRate(0, 0)).toBeNull();
  });

  it("excludes open deals by construction — only decided ones are passed in", () => {
    expect(winRate(2, 0)).toBe("100.0");
  });
});

describe("proposal acceptance rate (PRD #17 §244)", () => {
  it("is accepted ÷ (accepted + declined)", () => {
    expect(acceptanceRate(4, 1)).toBe("80.0");
    expect(acceptanceRate(0, 0)).toBeNull();
  });
});

describe("proposal totals (PRD #17 §111, §328)", () => {
  it("computes subtotal, tax and total from quantity, price and rate", () => {
    const result = calculateProposal([
      { description: "Substructure", quantity: "1", unitPrice: "620000", taxRate: "20" },
      { description: "Preliminaries", quantity: "12", unitPrice: "18500", taxRate: "20" },
    ]);

    expect(toAmountString(result.subtotal)).toBe("842000.00");
    expect(toAmountString(result.taxAmount)).toBe("168400.00");
    expect(toAmountString(result.totalAmount)).toBe("1010400.00");
  });

  it("handles zero tax", () => {
    const result = calculateProposal([
      { description: "Fixed fee", quantity: "1", unitPrice: "38000", taxRate: "0" },
    ]);

    expect(toAmountString(result.taxAmount)).toBe("0.00");
    expect(toAmountString(result.totalAmount)).toBe("38000.00");
  });

  it("handles a fractional quantity", () => {
    const result = calculateProposal([
      { description: "Senior architect", quantity: "112.5", unitPrice: "145", taxRate: "20" },
    ]);

    expect(toAmountString(result.subtotal)).toBe("16312.50");
    expect(toAmountString(result.taxAmount)).toBe("3262.50");
    expect(toAmountString(result.totalAmount)).toBe("19575.00");
  });

  it("sums already-rounded lines, so the lines always add up to the total", () => {
    const result = calculateProposal([
      { description: "A", quantity: "3", unitPrice: "0.335", taxRate: "0" },
      { description: "B", quantity: "3", unitPrice: "0.335", taxRate: "0" },
    ]);

    // Each line rounds to 1.01; 1.01 + 1.01 = 2.02. Summing unrounded and
    // rounding once would give 2.01, and a client notices a proposal whose
    // lines do not add up to its total.
    expect(toAmountString(result.lines[0].subtotal)).toBe("1.01");
    expect(toAmountString(result.totalAmount)).toBe("2.02");
  });
});

describe("stage transitions (PRD #17 §82, §322)", () => {
  it("allows the forward and backward moves the PRD lists", () => {
    expect(canTransitionOpportunityStage("PROSPECTING", "QUALIFIED")).toBe(true);
    expect(canTransitionOpportunityStage("QUALIFIED", "DISCOVERY")).toBe(true);
    expect(canTransitionOpportunityStage("DISCOVERY", "PROPOSAL")).toBe(true);
    expect(canTransitionOpportunityStage("PROPOSAL", "NEGOTIATION")).toBe(true);
    expect(canTransitionOpportunityStage("NEGOTIATION", "PROPOSAL")).toBe(true);
    expect(canTransitionOpportunityStage("DISCOVERY", "QUALIFIED")).toBe(true);
  });

  it("refuses a jump across stages", () => {
    expect(canTransitionOpportunityStage("PROSPECTING", "NEGOTIATION")).toBe(false);
    expect(canTransitionOpportunityStage("QUALIFIED", "PROPOSAL")).toBe(false);
  });

  it("never lets a stage change close a deal", () => {
    // Winning and losing are their own actions, with their own permissions and
    // their own required fields (PRD #17 §82, §84, §93).
    for (const stage of OPEN_STAGES) {
      expect(canTransitionOpportunityStage(stage, "WON")).toBe(false);
      expect(canTransitionOpportunityStage(stage, "LOST")).toBe(false);
    }
  });

  it("treats a closed deal as closed", () => {
    expect(isClosedStage("WON")).toBe(true);
    expect(isClosedStage("LOST")).toBe(true);
    expect(canTransitionOpportunityStage("WON", "NEGOTIATION")).toBe(false);
    expect(canTransitionOpportunityStage("LOST", "QUALIFIED")).toBe(false);
  });
});

describe("proposal expiry (PRD #17 §402)", () => {
  const now = new Date(Date.UTC(2026, 5, 15));

  it("warns only about a sent proposal inside the window", () => {
    expect(
      proposalExpiry({ status: "SENT", validUntil: new Date(Date.UTC(2026, 5, 19)), now }),
    ).toBe("EXPIRING_SOON");
    expect(
      proposalExpiry({ status: "SENT", validUntil: new Date(Date.UTC(2026, 6, 30)), now }),
    ).toBe("NONE");
    expect(
      proposalExpiry({ status: "SENT", validUntil: new Date(Date.UTC(2026, 5, 1)), now }),
    ).toBe("EXPIRED");
  });

  it("says nothing about a draft, however old its date", () => {
    expect(
      proposalExpiry({ status: "DRAFT", validUntil: new Date(Date.UTC(2020, 0, 1)), now }),
    ).toBe("NONE");
  });
});
