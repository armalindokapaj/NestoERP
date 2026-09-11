import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, UserRoundCog } from "lucide-react";

import { LeaveBalanceCard } from "@/components/hr/leave-balance-card";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { leaveYearOf, today } from "@/lib/modules/hr/hr.calendar";
import { leaveListQuerySchema } from "@/lib/modules/hr/hr.schema";
import { employmentTypeLabels } from "@/lib/modules/hr/hr.status";
import { attentionList, getHrOverview } from "@/lib/modules/hr/overview/overview.service";
import * as leave from "@/lib/modules/hr/leave/leave.service";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "HR" };

/**
 * The HR overview (PRD #16 §21–§24).
 *
 * The module's own dashboard, not the personal one at /dashboard. Every panel
 * is gated by its own permission, so somebody with self-service alone sees
 * their leave balance and their own days rather than a company dashboard with
 * holes in it (PRD #16 §22, §23). Pay is never here: the overview has no
 * compensation figures at all (PRD #16 §22).
 */
export default async function HrOverviewPage() {
  const context = await requireModule("hr");
  const experience = resolveModuleExperience(context, "hr");

  const overview = await getHrOverview(context);

  const [attention, myBalances, myLeave] = await Promise.all([
    overview.visible.employees ? attentionList(context) : null,
    // A reader with no employment record of their own simply has no balance to
    // show — not a reason to fail the whole overview.
    can(context, "hr.self.leave") || can(context, "hr.leave.balance.view")
      ? leave.getBalances(context, context.membershipId, leaveYearOf(today())).catch(() => [])
      : Promise.resolve([]),
    overview.visible.leave
      ? leave.listLeave(
          context,
          leaveListQuerySchema.parse({
            mine: true,
            status: ["DRAFT", "PENDING", "APPROVED"],
            limit: 5,
          }),
        )
      : null,
  ]);

  const cards = [
    ...(overview.visible.employees
      ? [
          { label: "Active employees", value: overview.headcount, href: "/hr/employees?status=ACTIVE,ON_LEAVE" },
          { label: "Starting soon", value: overview.startingSoon, href: "/hr/employees?status=PLANNED" },
          { label: "Ending soon", value: overview.endingSoon, href: "/hr/reports?report=ending-soon" },
        ]
      : []),
    ...(overview.visible.leave
      ? [
          { label: "On leave today", value: overview.onLeaveToday, href: "/hr/leave?status=APPROVED" },
          { label: "Pending leave", value: overview.pendingLeave, href: "/hr/leave?status=PENDING" },
        ]
      : []),
    ...(overview.visible.onboarding
      ? [
          { label: "In onboarding", value: overview.onboardingInProgress, href: "/hr/onboarding" },
          { label: "In offboarding", value: overview.offboardingInProgress, href: "/hr/offboarding" },
        ]
      : []),
    ...(overview.visible.attendance
      ? [
          {
            label: "Attendance exceptions",
            value: overview.attendanceExceptions,
            href: "/hr/attendance?exceptions=1",
          },
        ]
      : []),
  ];

  const nothingVisible = cards.length === 0 && myBalances.length === 0;

  return (
    <ModulePage
      experience={experience}
      activeSection="overview"
      actions={
        can(context, "hr.leave.create") || can(context, "hr.self.leave") ? (
          <Button asChild size="sm">
            <Link href="/hr/leave/new">Request leave</Link>
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        {cards.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => (
              <Link
                key={card.label}
                href={card.href}
                className="nesto-card p-4 transition-colors hover:border-line-strong"
              >
                <p className="text-table text-fg-muted">{card.label}</p>
                <p className="mt-2 text-page font-semibold tabular-nums text-fg">{card.value}</p>
              </Link>
            ))}
          </div>
        ) : null}

        {nothingVisible ? (
          <EmptyState
            icon={<UserRoundCog />}
            title="Nothing in your HR view."
            description="Your access covers your own records rather than company people data."
          />
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          {myBalances.length > 0 ? (
            <LeaveBalanceCard
              balances={myBalances}
              year={leaveYearOf(today())}
              title="My leave balance"
            />
          ) : null}

          {myLeave && myLeave.data.length > 0 ? (
            <section className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">My leave</h2>
                <Link
                  href="/hr/leave?mine=1"
                  className="inline-flex items-center gap-1 text-table font-medium text-accent-strong"
                >
                  All mine
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                </Link>
              </div>
              <ul className="mt-4 divide-y divide-line">
                {myLeave.data.map((request) => (
                  <li key={request.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                    <Link
                      href={`/hr/leave/${request.id}`}
                      className="min-w-0 truncate text-table text-fg transition-colors hover:text-accent"
                    >
                      {formatDate(request.startDate)} — {formatDate(request.endDate)}
                    </Link>
                    <span className="shrink-0 text-meta text-fg-subtle">{request.status}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {overview.visible.employees && overview.byEmploymentType.length > 0 ? (
            <section className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">Headcount by type</h2>
                <Link
                  href="/hr/reports?report=headcount"
                  className="inline-flex items-center gap-1 text-table font-medium text-accent-strong"
                >
                  Headcount
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                </Link>
              </div>
              <dl className="mt-4 divide-y divide-line">
                {overview.byEmploymentType.map((row) => (
                  <div key={row.type} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                    <dt className="text-table text-fg-muted">{employmentTypeLabels[row.type]}</dt>
                    <dd className="text-table font-semibold tabular-nums text-fg">{row.count}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
        </div>

        {attention ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <AttentionPanel
              title="Starting soon"
              emptyLabel="Nobody joining in the next 30 days."
              rows={attention.starting}
            />
            <AttentionPanel
              title="Employment ending"
              emptyLabel="No end dates in the next 30 days."
              rows={attention.ending}
            />
            <AttentionPanel
              title="Probation ending"
              emptyLabel="No probation periods ending soon."
              rows={attention.probation}
            />
          </div>
        ) : null}
      </div>
    </ModulePage>
  );
}

function AttentionPanel({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: { memberId: string; fullName: string; date: string | null }[];
  emptyLabel: string;
}) {
  return (
    <section className="nesto-card p-5">
      <h2 className="text-card font-semibold text-fg">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-table text-fg-subtle">{emptyLabel}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {rows.map((row) => (
            <li key={row.memberId} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
              <Link
                href={`/hr/employees/${row.memberId}`}
                className="min-w-0 truncate text-table text-fg transition-colors hover:text-accent"
              >
                {row.fullName}
              </Link>
              <span className="shrink-0 text-meta tabular-nums text-fg-subtle">
                {row.date ? formatDate(row.date) : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
