import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HseAttentionList, HseKpiGrid, StopWorkBanner } from "@/components/hse/hse-kpis";
import {
  HazardTable,
  IncidentTable,
  PermitTable,
} from "@/components/hse/hse-tables";
import { ModulePage } from "@/components/modules/module-page";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import * as overview from "@/lib/modules/hse/overview/overview.service";
import { HardHat } from "lucide-react";

export const metadata: Metadata = { title: "HSE" };

/**
 * The HSE overview (PRD #22 §30, §361).
 *
 * Read top to bottom in the order a safety manager reads a morning: work that
 * is stopped right now, then what needs attention, then the numbers, then the
 * lists.
 */
export default async function HsePage() {
  const context = await requireModule("hse");
  if (!can(context, "hse.dashboard.view")) redirect("/hse/hazards");

  const experience = resolveModuleExperience(context, "hse");
  const data = await overview.getHseOverview(context);

  const empty =
    data.kpis.length === 0 &&
    data.attention.length === 0 &&
    data.recentIncidents.length === 0 &&
    data.openCriticalHazards.length === 0;

  return (
    <ModulePage
      experience={experience}
      activeSection="overview"
      description="Health, safety and environment across the company."
    >
      {empty ? (
        <EmptyState
          icon={<HardHat />}
          title="Nothing to report."
          description="Hazards, incidents, inspections and permits appear here as they are raised."
          action={
            can(context, "hse.hazard.create")
              ? { label: "Report a hazard", href: "/hse/hazards/new" }
              : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {/* Work that is halted right now, above everything (PRD #22 §175). */}
          <StopWorkBanner
            records={data.activeStopWorks.map((record) => ({
              id: record.id,
              stopWorkNumber: record.stopWorkNumber,
              title: record.title,
              project: record.project,
            }))}
          />

          <HseAttentionList items={data.attention} />

          <HseKpiGrid kpis={data.kpis} />

          {data.openCriticalHazards.length > 0 ? (
            <section className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">Critical hazards</h2>
                <Link href="/hse/hazards?view=critical" className="text-meta text-accent">
                  All critical hazards
                </Link>
              </div>
              <HazardTable hazards={data.openCriticalHazards} caption="Open critical hazards" />
            </section>
          ) : null}

          {data.recentIncidents.length > 0 ? (
            <section className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">Open incidents</h2>
                <Link href="/hse/incidents?view=open" className="text-meta text-accent">
                  All incidents
                </Link>
              </div>
              <IncidentTable incidents={data.recentIncidents} caption="Open incidents" />
            </section>
          ) : null}

          {data.expiringPermits.length > 0 ? (
            <section className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">Permits running out</h2>
                <Link href="/hse/permits?view=expiring" className="text-meta text-accent">
                  All permits
                </Link>
              </div>
              <PermitTable permits={data.expiringPermits} caption="Permits expiring soon" />
            </section>
          ) : null}
        </div>
      )}
    </ModulePage>
  );
}
