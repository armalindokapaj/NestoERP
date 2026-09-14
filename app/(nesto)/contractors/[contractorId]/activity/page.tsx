import type { Metadata } from "next";

import { EmptyNote, formatDateTime } from "@/components/engineering/engineering-ui";
import { orNotFound } from "@/components/engineering/page-helpers";
import { requireModule } from "@/lib/context/current-user";
import { prisma } from "@/lib/database/prisma";
import { ACTIVITY_ENTITY } from "@/lib/modules/contractors/contractor.permissions";
import { findReadableContractor } from "@/lib/modules/contractors/contractor.service";
import { resolveEngineeringSettings } from "@/lib/modules/engineering/engineering.settings";

type Params = { params: Promise<{ contractorId: string }> };

export const metadata: Metadata = { title: "Contractor activity" };

/** What happened to this contractor, in the words people read — low-noise, not the audit trail (PRD #46 §231). */
export default async function ContractorActivityPage({ params }: Params) {
  const { contractorId } = await params;
  const context = await requireModule("contractors");
  const contractor = await orNotFound(findReadableContractor(context, contractorId));
  const [rows, settings] = await Promise.all([
    prisma.activity.findMany({ where: { companyId: context.companyId, entityType: ACTIVITY_ENTITY, entityId: contractor.id }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, message: true, createdAt: true, actorMember: { select: { user: { select: { firstName: true, lastName: true } } } } } }),
    resolveEngineeringSettings(context.companyId),
  ]);
  return (
    <section className="space-y-3">
      <h2 className="text-section font-semibold text-fg">Activity</h2>
      {rows.length === 0 ? (
        <EmptyNote>Nothing has happened here yet.</EmptyNote>
      ) : (
        <ol className="divide-y divide-line rounded-lg border border-line bg-surface">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3" data-testid="contractor-activity">
              <p className="text-table text-fg">
                <span className="font-medium">{row.actorMember ? `${row.actorMember.user.firstName} ${row.actorMember.user.lastName}` : "NESTO"}</span> {row.message}
              </p>
              <span className="text-meta tabular-nums text-fg-subtle">{formatDateTime(row.createdAt.toISOString(), settings.timezone)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
