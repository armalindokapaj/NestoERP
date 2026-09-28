import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { ArrowRight, UsersRound } from "lucide-react";

import { ModulePage } from "@/components/modules/module-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { departmentDistribution } from "@/lib/modules/team/team.repository";
import * as team from "@/lib/modules/team/team.service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("team"))("meta.team") };
}

/**
 * Team overview (PRD #14 §8, §9, §11).
 *
 * The module's own dashboard: headcount, departments, pending invitations and
 * who no longer has access. Every counter links to the list that explains it,
 * because a number nobody can drill into is decoration (PRD #14 §12).
 */
export default async function TeamOverviewPage() {
  const context = await requireModule("team");
  const experience = resolveModuleExperience(context, "team");
  const t = await getTranslations("team");

  const canSeeInvitations = can(context, "team.invitation.view");
  const canSeeDepartments = can(context, "team.department.view");

  const [stats, distribution] = await Promise.all([
    team.getTeamOverview(context),
    canSeeDepartments ? departmentDistribution(context) : Promise.resolve([]),
  ]);

  const cards = [
    { key: "active", label: t("overview.activeMembers"), value: stats.activeMembers, href: "/team/people" },
    ...(canSeeDepartments
      ? [{ key: "departments", label: t("overview.departments"), value: stats.departments, href: "/team/departments" }]
      : []),
    ...(canSeeInvitations
      ? [
          {
            key: "invitations",
            label: t("overview.pendingInvitations"),
            value: stats.pendingInvitations,
            href: "/team/invitations",
          },
        ]
      : []),
    { key: "inactive", label: t("overview.inactive"), value: stats.inactiveMembers + stats.suspendedMembers, href: "/team/inactive" },
  ];

  return (
    <ModulePage
      experience={experience}
      activeSection="overview"
      actions={
        can(context, "team.member.invite") ? (
          <Button asChild size="sm">
            <Link href="/team/invite">{t("overview.inviteMember")}</Link>
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <Link
              key={card.key}
              href={card.href}
              className="nesto-card p-4 transition-colors hover:border-line-strong"
            >
              <p className="text-table text-fg-muted">{card.label}</p>
              <p className="mt-2 text-page font-semibold tabular-nums text-fg">{card.value}</p>
            </Link>
          ))}
        </div>

        {stats.activeMembers === 0 ? (
          <EmptyState
            icon={<UsersRound />}
            title={t("overview.emptyTitle")}
            description={t("overview.emptyDescription")}
            action={
              can(context, "team.member.invite")
                ? { label: t("overview.inviteMember"), href: "/team/invite" }
                : undefined
            }
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {canSeeDepartments ? (
              <section className="nesto-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-card font-semibold text-fg">{t("overview.byDepartment")}</h2>
                  <Link
                    href="/team/departments"
                    className="inline-flex items-center gap-1 text-table font-medium text-accent-strong"
                  >
                    {t("overview.departments")}
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Link>
                </div>
                {distribution.length === 0 ? (
                  <p className="mt-4 text-table text-fg-subtle">
                    {t("overview.noDepartmentYet")}
                  </p>
                ) : (
                  <ul className="mt-4 divide-y divide-line">
                    {distribution.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex items-center justify-between gap-3 py-2.5 first:pt-0"
                      >
                        <Link
                          href={`/team/people?departmentId=${entry.id}`}
                          className="min-w-0 truncate text-table text-fg transition-colors hover:text-accent"
                        >
                          {entry.name}
                        </Link>
                        <span className="shrink-0 text-table font-semibold tabular-nums text-fg">
                          {entry.members}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("overview.access")}</h2>
              <dl className="mt-4 divide-y divide-line">
                <Row label={t("overview.activeMembers")} value={stats.activeMembers} href="/team/people?status=ACTIVE" />
                {canSeeInvitations ? (
                  <Row
                    label={t("overview.awaiting")}
                    value={stats.pendingInvitations}
                    href="/team/invitations"
                  />
                ) : null}
                <Row
                  label={t("overview.deactivated")}
                  value={stats.inactiveMembers}
                  href="/team/inactive?status=INACTIVE"
                />
                <Row
                  label={t("overview.suspended")}
                  value={stats.suspendedMembers}
                  href="/team/inactive?status=SUSPENDED"
                  tone={stats.suspendedMembers > 0 ? "danger" : undefined}
                />
              </dl>
            </section>
          </div>
        )}
      </div>
    </ModulePage>
  );
}

function Row({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: number;
  href: string;
  tone?: "danger";
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
      <dt className="min-w-0">
        <Link href={href} className="text-table text-fg transition-colors hover:text-accent">
          {label}
        </Link>
      </dt>
      <dd className="shrink-0">
        {tone === "danger" ? (
          <Badge tone="danger">{value}</Badge>
        ) : (
          <span className="text-table font-semibold tabular-nums text-fg">{value}</span>
        )}
      </dd>
    </div>
  );
}
