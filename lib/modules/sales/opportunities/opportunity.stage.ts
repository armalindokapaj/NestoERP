import { Prisma, type OpportunityStage } from "@prisma/client";

import { roundMoney, type Money } from "@/lib/modules/finance/finance.money";

/**
 * The pipeline stage model (PRD #17 §25–§29, §208).
 *
 * Stages are fixed in V0.1 and their default probabilities live in code rather
 * than in a settings table (PRD #17 §390, §392). That is a deliberate limit: a
 * forecast is only comparable across companies — and across quarters — while
 * "60% at Proposal" means the same thing everywhere.
 */

/** Render order, which is also pipeline order (PRD #17 §26). */
export const OPPORTUNITY_STAGES: OpportunityStage[] = [
  "PROSPECTING",
  "QUALIFIED",
  "DISCOVERY",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "LOST",
];

/** The stages a Kanban board shows: open work, not finished deals (PRD #17 §99). */
export const OPEN_STAGES: OpportunityStage[] = [
  "PROSPECTING",
  "QUALIFIED",
  "DISCOVERY",
  "PROPOSAL",
  "NEGOTIATION",
];

export const CLOSED_STAGES: OpportunityStage[] = ["WON", "LOST"];

/** PRD #17 §27. */
const STAGE_PROBABILITY: Record<OpportunityStage, number> = {
  PROSPECTING: 10,
  QUALIFIED: 25,
  DISCOVERY: 40,
  PROPOSAL: 60,
  NEGOTIATION: 80,
  WON: 100,
  LOST: 0,
};

export function getDefaultStageProbability(stage: OpportunityStage): number {
  return STAGE_PROBABILITY[stage];
}

export function isClosedStage(stage: OpportunityStage): boolean {
  return stage === "WON" || stage === "LOST";
}

export function isOpenStage(stage: OpportunityStage): boolean {
  return !isClosedStage(stage);
}

/**
 * Stage transitions a user may drive directly (PRD #17 §82).
 *
 * WON and LOST are absent from every row on purpose: closing a deal is its own
 * action with its own permission, its own required fields and its own
 * idempotency rule, so it can never happen as a side effect of a drag between
 * two columns (PRD #17 §82, §84, §93).
 */
const TRANSITIONS: Record<OpportunityStage, OpportunityStage[]> = {
  PROSPECTING: ["QUALIFIED"],
  QUALIFIED: ["DISCOVERY", "PROSPECTING"],
  DISCOVERY: ["PROPOSAL", "QUALIFIED"],
  PROPOSAL: ["NEGOTIATION", "DISCOVERY"],
  NEGOTIATION: ["PROPOSAL"],
  WON: [],
  LOST: [],
};

export function canTransitionOpportunityStage(
  from: OpportunityStage,
  to: OpportunityStage,
): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

/** Where a reopened LOST opportunity lands (PRD #17 §96). */
export const REOPEN_STAGE: OpportunityStage = "QUALIFIED";

/**
 * The probability that actually applies (PRD #17 §28, §67).
 *
 * The manual override wins when it is set, because the person working the deal
 * knows something the stage does not. Everything downstream — the weighted
 * pipeline, the forecast, the card in the Kanban column — reads this one
 * function, so no two screens can disagree about the same deal.
 */
export function effectiveProbability(
  stage: OpportunityStage,
  override: Prisma.Decimal | null | undefined,
): Prisma.Decimal {
  if (override !== null && override !== undefined) return new Prisma.Decimal(override);
  return new Prisma.Decimal(getDefaultStageProbability(stage));
}

/**
 * `estimatedValue × probability / 100`, in Decimal (PRD #17 §29, §207).
 *
 * Server-side and nowhere else: a weighted pipeline the browser computed is a
 * number the company cannot reconcile against its own database (PRD #17 §224).
 */
export function weightedValue(
  estimatedValue: Prisma.Decimal.Value,
  probability: Prisma.Decimal.Value,
): Money {
  return roundMoney(new Prisma.Decimal(estimatedValue).times(probability).dividedBy(100));
}

export const opportunityStageLabels: Record<OpportunityStage, string> = {
  PROSPECTING: "Prospecting",
  QUALIFIED: "Qualified",
  DISCOVERY: "Discovery",
  PROPOSAL: "Proposal",
  NEGOTIATION: "Negotiation",
  WON: "Won",
  LOST: "Lost",
};
