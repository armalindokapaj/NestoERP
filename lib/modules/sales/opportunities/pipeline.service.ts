import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { buildOpportunityUnionWhere } from "../sales.scope";
import type { CurrencyTotal, PipelineStageBucket } from "../sales.types";
import { companyRefOf, companyRefs, groupReaders } from "../sales.workspace";
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

/**
 * The companies whose pipeline the Group workspace reads: where the reader may
 * open opportunities and the board (the API holds only the first, the page both,
 * so the board asks for both).
 */
async function pipelineReaders(session: UserContext, companyId?: string): Promise<UserContext[]> {
  return (await groupReaders(session, "sales.opportunity.view", companyId)).filter((context) =>
    can(context, "sales.pipeline.view"),
  );
}

/** Every such company, never narrowed: the options of the group's `company` filter. */
export async function pipelineCompaniesForWorkspace(session: UserContext) {
  return (await pipelineReaders(session)).map(companyRefOf).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The board for the active workspace (Workspace Context §37, §41, §72).
 *
 * A company workspace is the company board. In the Group workspace it is one
 * board over every authorised company: each stage is that stage's deals across
 * them, each card names its company, and every total is per currency — euros
 * from one company and dollars from another stay side by side, never one
 * figure. A company where the reader lacks the pipeline grant is left out.
 */
export async function getPipelineForWorkspace(session: UserContext, companyId?: string): Promise<PipelineDTO> {
  if (!inGroupWorkspace(session)) return getPipeline(session);

  const readers = await pipelineReaders(session, companyId);
  if (readers.length === 0) {
    return { stages: OPEN_STAGES.map((stage) => ({ stage, count: 0, probability: String(getDefaultStageProbability(stage)), totals: [], opportunities: [] })), totals: [] };
  }

  const [aggregateRows, stageRows] = await Promise.all([
    repository.openOpportunityAggregateRowsIn(buildOpportunityUnionWhere(readers)),
    Promise.all(OPEN_STAGES.map((stage) => repository.listStageOpportunitiesInGroup(readers, stage, CARDS_PER_STAGE))),
  ]);

  const companies = companyRefs(readers);
  const byStage = totalsByStage(aggregateRows);

  const stages: PipelineStageBucket[] = OPEN_STAGES.map((stage, index) => ({
    stage,
    count: aggregateRows.filter((row) => row.stage === stage).length,
    probability: String(getDefaultStageProbability(stage)),
    totals: byStage.get(stage) ?? [],
    opportunities: stageRows[index].map((row) => ({ ...toSummaryDTO(row), company: companies.get(row.companyId) })),
  }));

  return { stages, totals: currencyTotals(aggregateRows) };
}

export function canViewPipeline(context: UserContext): boolean {
  return can(context, "sales.pipeline.view") || can(context, "sales.opportunity.view");
}
