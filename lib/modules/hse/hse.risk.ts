import type { HseRiskLevel } from "@prisma/client";

/**
 * The 5×5 risk matrix (PRD #22 §62–§65, §242, §243).
 *
 * Two integers go in — how likely it is, and how bad it would be — and the
 * score and the level come out. Both are derived here and nowhere else.
 *
 * This is the one calculation in the module that must never accept a client's
 * answer (PRD #22 §243). A browser that could post its own `riskLevel` could
 * file a critical hazard as LOW, and the register that decides which hazards get
 * looked at first would quietly stop being true. The services take likelihood
 * and severity from the request and compute the rest.
 */

export const RISK_MIN = 1;
export const RISK_MAX = 5;

/** The axis values, low to high, for pickers and for the matrix report. */
export const RISK_AXIS = [1, 2, 3, 4, 5] as const;

export const likelihoodLabels: Record<number, string> = {
  1: "Rare",
  2: "Unlikely",
  3: "Possible",
  4: "Likely",
  5: "Almost certain",
};

export const severityLabels: Record<number, string> = {
  1: "Negligible",
  2: "Minor",
  3: "Moderate",
  4: "Major",
  5: "Catastrophic",
};

export const riskLevelLabels: Record<HseRiskLevel, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/** Whether a number is a usable matrix axis value (PRD #22 §62). */
export function isRiskAxisValue(value: number): boolean {
  return Number.isInteger(value) && value >= RISK_MIN && value <= RISK_MAX;
}

/** `likelihood × severity`, 1–25 (PRD #22 §63). */
export function calculateRiskScore(likelihood: number, severity: number): number {
  if (!isRiskAxisValue(likelihood) || !isRiskAxisValue(severity)) {
    throw new RangeError("Likelihood and severity are each a whole number from 1 to 5.");
  }
  return likelihood * severity;
}

/**
 * Where a score sits on the register (PRD #22 §64).
 *
 *   1–4    LOW
 *   5–9    MEDIUM
 *   10–16  HIGH
 *   17–25  CRITICAL
 */
export function calculateRiskLevel(score: number): HseRiskLevel {
  if (score <= 4) return "LOW";
  if (score <= 9) return "MEDIUM";
  if (score <= 16) return "HIGH";
  return "CRITICAL";
}

export type RiskResult = { riskScore: number; riskLevel: HseRiskLevel };

/** Score and level together, which is how every caller wants them. */
export function assessRisk(likelihood: number, severity: number): RiskResult {
  const riskScore = calculateRiskScore(likelihood, severity);
  return { riskScore, riskLevel: calculateRiskLevel(riskScore) };
}

export type ResidualRiskResult = {
  residualLikelihood: number | null;
  residualSeverity: number | null;
  residualRiskScore: number | null;
  residualRiskLevel: HseRiskLevel | null;
};

/**
 * The risk that is left once the controls are in (PRD #22 §71, §72).
 *
 * Residual risk is all-or-nothing: either both axes are given and the pair is
 * scored, or the record simply has not been re-assessed yet. Half a residual
 * assessment — a likelihood with no severity — would render as a number on the
 * hazard page that means nothing.
 */
export function assessResidualRisk(
  likelihood: number | null | undefined,
  severity: number | null | undefined,
): ResidualRiskResult {
  if (likelihood == null || severity == null) {
    return {
      residualLikelihood: null,
      residualSeverity: null,
      residualRiskScore: null,
      residualRiskLevel: null,
    };
  }

  const { riskScore, riskLevel } = assessRisk(likelihood, severity);
  return {
    residualLikelihood: likelihood,
    residualSeverity: severity,
    residualRiskScore: riskScore,
    residualRiskLevel: riskLevel,
  };
}

/**
 * Whether a residual assessment is coherent (PRD #22 §72).
 *
 * Controls reduce risk; they do not increase it. A residual score above the
 * initial one means either the control made things worse — which is a new
 * hazard, not a residual figure — or somebody entered the two the wrong way
 * round. Either way the number should not be saved silently.
 */
export function residualRiskExceedsInitial(
  initialScore: number,
  residualScore: number | null,
): boolean {
  return residualScore != null && residualScore > initialScore;
}

/** Whether a hazard at this level must carry an immediate control (PRD #22 §68). */
export function requiresImmediateControl(riskLevel: HseRiskLevel): boolean {
  return riskLevel === "CRITICAL";
}

/** Whether closing at this level needs the residual risk assessed (PRD #22 §73). */
export function requiresResidualAssessment(riskLevel: HseRiskLevel): boolean {
  return riskLevel === "HIGH" || riskLevel === "CRITICAL";
}
