"use client";

import * as React from "react";
import type { OpportunityStage } from "@prisma/client";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";

import { selectClass } from "@/components/forms/record-form";
import { PersonLink } from "@/components/people/person-link";
import { useToast } from "@/components/ui/toast";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import { CompanyTag } from "@/components/workspace/company-tag";
import { changeStageAction } from "@/lib/actions/sales";
import {
  canTransitionOpportunityStage,
  opportunityStageLabels,
} from "@/lib/modules/sales/opportunities/opportunity.stage";
import type { PipelineStageBucket } from "@/lib/modules/sales/sales.types";
import { cn } from "@/lib/utils/cn";
import { salesLabel } from "@/lib/i18n/modules/sales/labels";
import { useSalesServerText, useSalesTranslations } from "@/components/sales/sales-text";
import { formatDate } from "@/lib/utils/format";
import { formatAmount, totalsLabel, weightedTotalsLabel } from "./sales-format";
import { FormSelect } from "@/components/ui/form-select";

/**
 * The pipeline board (PRD #17 §98–§103, §284, §297).
 *
 * There is no drag and drop, and that is the design rather than a shortcut.
 * PRD §297 requires a non-drag alternative that keyboard users can reach, and
 * once the select exists it is the better control on every device: it is
 * explicit, it announces itself, and it cannot half-happen on a touch screen.
 * Each change waits for the server before the board moves, so a refused
 * transition never leaves a card in a column it is not in (PRD #17 §254).
 *
 * On a narrow screen the columns become a stage selector with the cards stacked
 * beneath it, rather than a wide board squeezed sideways (PRD #17 §102, §284).
 *
 * The Group workspace (`grouped`) reads: one column per stage across every
 * company, each card naming its company and opening through the company hop.
 * Nothing moves there — a stage change is one company's write, so the control
 * is not offered (Workspace Context §59).
 */
export function PipelineBoard({
  stages,
  canChangeStage,
  grouped = false,
}: {
  stages: PipelineStageBucket[];
  canChangeStage: boolean;
  grouped?: boolean;
}) {
  const t = useSalesTranslations();
  const [selected, setSelected] = React.useState<OpportunityStage>(
    stages[0]?.stage ?? "PROSPECTING",
  );
  const active = stages.find((stage) => stage.stage === selected) ?? stages[0];

  return (
    <div className="space-y-4">
      {/* Mobile: one stage at a time (PRD #17 §284). */}
      <div className="lg:hidden">
        <label htmlFor="pipeline-stage" className="nesto-eyebrow text-fg-subtle">
          {t("pipeline.stage")}
        </label>
        <FormSelect
          id="pipeline-stage"
          className={cn(selectClass, "mt-1.5")}
          value={selected}
          onChange={(event) => setSelected(event.target.value as OpportunityStage)}
        >
          {stages.map((stage) => (
            <option key={stage.stage} value={stage.stage}>
              {salesLabel(t, "stage", stage.stage, opportunityStageLabels[stage.stage])} ({stage.count})
            </option>
          ))}
        </FormSelect>

        {active ? (
          <div className="mt-4 space-y-3">
            <StageSummary bucket={active} />
            {/* An empty stage says so on a phone too, as its desktop column does (AUD-04 §5, MW-05). */}
            {active.opportunities.length === 0 ? (
              <p className="nesto-card p-4 text-meta text-fg-subtle">{t("pipeline.noOpen")}</p>
            ) : null}
            {active.opportunities.map((opportunity) => (
              <PipelineCard
                key={opportunity.id}
                opportunity={opportunity}
                stages={stages}
                canChangeStage={canChangeStage && !grouped}
                grouped={grouped}
              />
            ))}
          </div>
        ) : null}
      </div>

      {/* Desktop: the columns, scrolling horizontally rather than shrinking. */}
      <ScrollRegion label={t("pipeline.stagesRegion")} className="hidden gap-4 pb-2 lg:flex">
        {stages.map((stage) => (
          <section
            key={stage.stage}
            aria-label={t("pipeline.columnLabel", { stage: salesLabel(t, "stage", stage.stage, opportunityStageLabels[stage.stage]), count: stage.count })}
            className="w-72 shrink-0 space-y-3"
          >
            <StageSummary bucket={stage} />
            {stage.opportunities.length === 0 ? (
              <p className="nesto-card p-4 text-meta text-fg-subtle">
                {t("pipeline.noOpen")}
              </p>
            ) : (
              stage.opportunities.map((opportunity) => (
                <PipelineCard
                  key={opportunity.id}
                  opportunity={opportunity}
                  stages={stages}
                  canChangeStage={canChangeStage && !grouped}
                  grouped={grouped}
                />
              ))
            )}
          </section>
        ))}
      </ScrollRegion>
    </div>
  );
}

function StageSummary({ bucket }: { bucket: PipelineStageBucket }) {
  const t = useSalesTranslations();
  return (
    <header className="nesto-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-table font-semibold text-fg">
          {salesLabel(t, "stage", bucket.stage, opportunityStageLabels[bucket.stage])}
        </h2>
        <span className="text-meta tabular-nums text-fg-subtle">
          {bucket.count} · {bucket.probability}%
        </span>
      </div>
      <p className="mt-2 text-table tabular-nums text-fg">{totalsLabel(bucket.totals)}</p>
      <p className="text-meta tabular-nums text-fg-subtle">
        {t("pipeline.weighted", { amount: weightedTotalsLabel(bucket.totals) })}
      </p>
    </header>
  );
}

function PipelineCard({
  opportunity,
  stages,
  canChangeStage,
  grouped,
}: {
  opportunity: PipelineStageBucket["opportunities"][number];
  stages: PipelineStageBucket[];
  canChangeStage: boolean;
  grouped: boolean;
}) {
  const t = useSalesTranslations();
  const serverText = useSalesServerText();
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();

  // Only transitions the server would actually allow are offered, so the
  // control never advertises a move that will be refused (PRD #17 §101).
  const destinations = stages
    .map((stage) => stage.stage)
    .filter(
      (stage) =>
        stage !== opportunity.stage && canTransitionOpportunityStage(opportunity.stage, stage),
    );

  function move(stage: string) {
    startTransition(async () => {
      const result = await changeStageAction(opportunity.id, stage);
      if (result.ok) {
        toast({ title: t("pipeline.stageUpdated"), tone: "success" });
        router.refresh();
      } else {
        toast({ title: serverText(result.error) ?? result.error, tone: "danger" });
      }
    });
  }

  return (
    <article className="nesto-card p-4">
      {grouped && opportunity.company ? (
        <>
          <div className="mb-1.5">
            <CompanyTag name={opportunity.company.name} />
          </div>
          <CompanyRecordLink
            companyId={opportunity.company.id}
            companyName={opportunity.company.name}
            href={`/sales/opportunities/${opportunity.id}`}
            className="text-table font-medium text-fg transition-colors hover:text-accent"
          >
            {opportunity.name}
          </CompanyRecordLink>
        </>
      ) : (
        <Link
          href={`/sales/opportunities/${opportunity.id}`}
          className="text-table font-medium text-fg transition-colors hover:text-accent"
        >
          {opportunity.name}
        </Link>
      )}
      {/* Everything the colour of a column would otherwise imply, in words
          (PRD #17 §406). */}
      <span className="sr-only">
        {t("pipeline.cardDescription", {
          name: opportunity.name,
          stage: salesLabel(t, "stage", opportunity.stage, opportunityStageLabels[opportunity.stage]),
          probability: opportunity.probability,
          value: formatAmount(opportunity.estimatedValue, opportunity.currency),
        })}
      </span>

      <p className="mt-1 truncate text-meta text-fg-subtle">
        {opportunity.client?.name ?? t("pipeline.noClientYet")}
      </p>

      <p className="mt-2 text-table tabular-nums text-fg">
        {formatAmount(opportunity.estimatedValue, opportunity.currency)}
        <span className="ml-2 text-meta text-fg-subtle">{opportunity.probability}%</span>
      </p>

      <dl className="mt-2 space-y-0.5 text-meta text-fg-subtle">
        <div className="flex justify-between gap-2">
          <dt>{t("pipeline.owner")}</dt>
          <dd className="truncate">
            <PersonLink memberId={opportunity.owner.memberId} name={opportunity.owner.fullName} />
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{t("pipeline.expected")}</dt>
          <dd className={opportunity.expectedCloseOverdue ? "text-warning-strong" : undefined}>
            {opportunity.expectedCloseDate ? formatDate(opportunity.expectedCloseDate) : "—"}
          </dd>
        </div>
      </dl>

      {opportunity.nextStep ? (
        <p className="mt-2 line-clamp-2 text-meta text-fg-muted">{opportunity.nextStep}</p>
      ) : null}

      {canChangeStage && destinations.length > 0 ? (
        <div className="mt-3 flex items-center gap-2">
          <label htmlFor={`move-${opportunity.id}`} className="sr-only">
            {t("pipeline.moveLabel", { name: opportunity.name })}
          </label>
          <FormSelect
            id={`move-${opportunity.id}`}
            className={cn(selectClass, "h-8 text-table")}
            value=""
            disabled={pending}
            onChange={(event) => {
              if (event.target.value) move(event.target.value);
            }}
          >
            <option value="">{t("pipeline.changeStage")}</option>
            {destinations.map((stage) => (
              <option key={stage} value={stage}>
                {salesLabel(t, "stage", stage, opportunityStageLabels[stage])}
              </option>
            ))}
          </FormSelect>
        </div>
      ) : null}
    </article>
  );
}

