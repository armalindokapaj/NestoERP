import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";

import { ModulePage } from "@/components/modules/module-page";
import { StatusBadge } from "@/components/modules/status-badge";
import { Button } from "@/components/ui/button";
import { ListSectionSkeleton, StatCardsSkeleton } from "@/components/modules/section-skeletons";
import { SectionBoundary } from "@/components/modules/page-section";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import {
  clientOverviewStats,
  recentClients,
  recentlyUpdatedClients,
} from "@/lib/modules/clients/client.repository";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Clients" };

/**
 * Clients module overview (PRD #12 §7, §8; NAV-03 STREAM-02, STREAM-04).
 *
 * A relationship summary, not a sales pipeline — the pipeline belongs to Sales
 * (PRD #12 §8). Every counter is scoped to what this reader may see.
 *
 * The module guard, the tabs and New client render first; the counters and
 * the two lists each arrive in their own section, so a slow one holds back
 * nothing else. Each list answers for itself: an empty list says so in its
 * own words and never stands for the whole module. The primary section is
 * Recently added.
 */
export default async function ClientsOverviewPage() {
  const context = await requireModule("clients");
  const experience = resolveModuleExperience(context, "clients");

  // Started together, awaited apart.
  const stats = clientOverviewStats(context);
  const recent = recentClients(context, 5);
  const updated = recentlyUpdatedClients(context, 5);
  // Awaited only inside their sections; a rejection is that section's to show.
  for (const promise of [stats, recent, updated]) promise.catch(() => undefined);

  return (
    <ModulePage
      experience={experience}
      activeSection="overview"
      actions={
        can(context, "client.create") ? (
          <Button asChild size="sm">
            <Link href="/clients/new">New client</Link>
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        <SectionBoundary className="nesto-card">
          <Suspense fallback={<StatCardsSkeleton count={4} />}>
            <ClientStats stats={stats} />
          </Suspense>
        </SectionBoundary>

        <div className="grid gap-4 lg:grid-cols-2">
          <SectionBoundary className="nesto-card">
            <Suspense fallback={<ListSectionSkeleton title="Recently added" />}>
              <ClientPanel title="Recently added" empty="No recently added clients." href="/clients/all?sort=created-desc" clients={recent} primary />
            </Suspense>
          </SectionBoundary>
          <SectionBoundary className="nesto-card">
            <Suspense fallback={<ListSectionSkeleton title="Recently updated" />}>
              <ClientPanel title="Recently updated" empty="No recently updated clients." href="/clients/all" clients={updated} />
            </Suspense>
          </SectionBoundary>
        </div>
      </div>
    </ModulePage>
  );
}

async function ClientStats({ stats }: { stats: ReturnType<typeof clientOverviewStats> }) {
  const value = await stats;
  const cards = [
    { label: "Active clients", value: value.active, href: "/clients/active" },
    { label: "With active projects", value: value.withActiveProjects, href: "/clients/all?hasActiveProject=yes" },
    { label: "Added this month", value: value.addedThisMonth, href: "/clients/all?sort=created-desc" },
    { label: "Archived", value: value.archived, href: "/clients/archived" },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-section="stats">
      {cards.map((card) => (
        <Link key={card.label} href={card.href} className="nesto-card p-4 transition-colors hover:border-line-strong">
          <p className="text-table text-fg-muted">{card.label}</p>
          <p className="mt-2 text-page font-semibold tabular-nums text-fg">{card.value}</p>
        </Link>
      ))}
    </div>
  );
}

async function ClientPanel({
  title,
  empty,
  href,
  clients: pending,
  primary = false,
}: {
  title: string;
  empty: string;
  href: string;
  clients: Promise<
    {
      id: string;
      name: string;
      code: string | null;
      status: string;
      updatedAt: Date;
    }[]
  >;
  primary?: boolean;
}) {
  const clients = await pending;
  return (
    <section className="nesto-card p-5" data-section={primary ? "primary" : undefined}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-card font-semibold text-fg">{title}</h2>
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-table font-medium text-accent-strong"
        >
          All clients
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
      {clients.length === 0 ? (
        <p className="mt-4 text-table text-fg-subtle">{empty}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {clients.map((client) => (
            <li key={client.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
              <div className="min-w-0">
                <Link
                  href={`/clients/${client.id}`}
                  className="block truncate text-table font-medium text-fg transition-colors hover:text-accent"
                >
                  {client.name}
                </Link>
                <p className="truncate text-meta text-fg-subtle">
                  {client.code ?? formatDate(client.updatedAt)}
                </p>
              </div>
              <StatusBadge status={client.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
