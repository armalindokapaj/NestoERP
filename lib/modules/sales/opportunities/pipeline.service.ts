import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import type { CurrencyTotal, PipelineStageBucket } from "../sales.types";
import { currencyTotals, totalsByStage } from "./opportunity.forecast";
import * as repository from "./opportunity.repository";
import { toSummaryDTO } from "./opportunity.service";
import { OPEN_STAGES, getDefaultStageProbability } from "./opportunity.stage";

/**
 * The pipeline board (PRD #17 §98–§103, §240, §247).
 *
 * Two queries for the whole board rather than one per column: the aggregate
 * rows that produce every stage header, and one paged read per stage for the
 * cards. Nothing is counted per card (PRD #17 §247).
 *
 * Every total is grouped by currency, because a board that adds euros to
 * dollars is showing a number the company cannot act on (PRD #17 §103, §172).
 */

/** Cards per column. A board is a working view, not an export (PRD #17 §247). */
const CARDS_PER_STAGE = 20;

export type PipelineDTO = {
  stages: PipelineStageBucket[];
  totals: CurrencyTotal[];
};

export async function getPipeline(context: UserContext): Promise<PipelineDTO> {
  assertModule(context, "sales");
  assertPermission(context, "sales.opportunity.view");

  const [aggregateRows, stageRows] = await Promise.all([
    repository.openOpportunityAggregateRows(context),
    Promise.all(OPEN_STAGES.map((stage) => repository.listStageOpportunities(context, stage, CARDS_PER_STAGE))),
  ]);

  const byStage = totalsByStage(aggregateRows);

  const stages: PipelineStageBucket[] = OPEN_STAGES.map((stage, index) => ({
    stage,
    count: aggregateRows.filter((row) => row.stage === stage).length,
    probability: String(getDefaultStageProbability(stage)),
    totals: byStage.get(stage) ?? [],
    opportunities: stageRows[index].map(toSummaryDTO),
  }));

  return { stages, totals: currencyTotals(aggregateRows) };
}

export function canViewPipeline(context: UserContext): boolean {
  return can(context, "sales.pipeline.view") || can(context, "sales.opportunity.view");
}
