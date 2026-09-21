import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Target } from "lucide-react";

import { ModulePage } from "@/components/modules/module-page";
import { GroupSalesScope } from "@/components/sales/group-scope";
import { PipelineBoard } from "@/components/sales/pipeline-board";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/loading-state";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { getPipelineForWorkspace, pipelineCompaniesForWorkspace } from "@/lib/modules/sales/opportunities/pipeline.service";
import { firstValue } from "@/lib/modules/shared/list-query";
import { includedCompanies, resolveSalesExperience } from "@/lib/modules/sales/sales.workspace";
import type { UserContext } from "@/lib/context/types";
import { totalsLabel, weightedTotalsLabel } from "@/components/sales/sales-format";

export const metadata: Metadata = { title: "Pipeline" };

/**
 * The Kanban board (PRD #17 §98–§103).
 *
 * In the Group workspace it is one board over every company the reader may read
 * the pipeline in (Workspace Context §37): each stage holds that stage's deals
 * across them, each card names its company, and nothing moves — a stage change
 * is one company's write.
 */
export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("sales");
  const grouped = inGroupWorkspace(context);
  if (!grouped && !can(context, "sales.pipeline.view")) redirect("/access-denied");

  const experience = await resolveSalesExperience(context);
  const companyParam = grouped ? firstValue((await searchParams).company) : undefined;

  return (
    <ModulePage experience={experience} activeSection="pipeline">
      <Suspense fallback={<SkeletonTable rows={6} />}>
        <Pipeline context={context} companyParam={companyParam} />
      </Suspense>
    </ModulePage>
  );
}

async function Pipeline({ context, companyParam }: { context: UserContext; companyParam: string | undefined }) {
  const grouped = inGroupWorkspace(context);
  const [pipeline, companies] = await Promise.all([
    getPipelineForWorkspace(context, companyParam),
    grouped ? pipelineCompaniesForWorkspace(context) : Promise.resolve([]),
  ]);

  // A group reader who holds the pipeline in no company has nothing to read:
  // that is an empty result, not an error (Workspace Context §76).
  if (grouped && companies.length === 0) {
    return (
      <EmptyState
        icon={<Target />}
        title="No accessible data for this module."
        description="None of the companies you can open lets you read the pipeline."
      />
    );
  }

  return (
    <div className="space-y-5">
      {grouped ? <GroupSalesScope companies={companies} included={includedCompanies(companies, companyParam)} /> : null}

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">Open pipeline</h2>
        {/* Grouped by currency, never summed across them (PRD #17 §31, §103). */}
        <p className="mt-2 text-page font-semibold tabular-nums text-fg">
          {totalsLabel(pipeline.totals)}
        </p>
        <p className="mt-1 text-table text-fg-subtle">
          {weightedTotalsLabel(pipeline.totals)} weighted
        </p>
      </section>

      <PipelineBoard
        stages={pipeline.stages}
        canChangeStage={!grouped && can(context, "sales.opportunity.stage.update")}
        grouped={grouped}
      />
    </div>
  );
}
