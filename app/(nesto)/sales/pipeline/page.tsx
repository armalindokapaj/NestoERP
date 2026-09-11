import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { PipelineBoard } from "@/components/sales/pipeline-board";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getPipeline } from "@/lib/modules/sales/opportunities/pipeline.service";
import type { UserContext } from "@/lib/context/types";
import { totalsLabel, weightedTotalsLabel } from "@/components/sales/sales-format";

export const metadata: Metadata = { title: "Pipeline" };

/** The Kanban board (PRD #17 §98–§103). */
export default async function PipelinePage() {
  const context = await requireModule("sales");
  if (!can(context, "sales.pipeline.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "sales");

  return (
    <ModulePage experience={experience} activeSection="pipeline">
      <Suspense fallback={<SkeletonTable rows={6} />}>
        <Pipeline context={context} />
      </Suspense>
    </ModulePage>
  );
}

async function Pipeline({ context }: { context: UserContext }) {
  const pipeline = await getPipeline(context);

  return (
    <div className="space-y-5">
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
        canChangeStage={can(context, "sales.opportunity.stage.update")}
      />
    </div>
  );
}
