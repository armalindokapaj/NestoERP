import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { ArrowRight, Users } from "lucide-react";

import { ModulePage } from "@/components/modules/module-page";
import { StatusBadge } from "@/components/modules/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
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
 * Clients module overview (PRD #12 §7, §8).
 *
 * A relationship summary, not a sales pipeline — the pipeline belongs to Sales
 * (PRD #12 §8). Every counter is scoped to what this reader may see.
 */
export default async function ClientsOverviewPage() {
  const context = await requireModule("clients");
  const experience = resolveModuleExperience(context, "clients");

  const [stats, recent, updated] = await Promise.all([
    clientOverviewStats(context),
    recentClients(context, 5),
    recentlyUpdatedClients(context, 5),
  ]);

  const cards = [
    { label: "Active clients", value: stats.active, href: "/clients/active" },
    {
      label: "With active projects",
      value: stats.withActiveProjects,
      href: "/clients/all?hasActiveProject=yes",
    },
    { label: "Added this month", value: stats.addedThisMonth, href: "/clients/all?sort=created-desc" },
    { label: "Archived", value: stats.archived, href: "/clients/archived" },
  ];

  const hasAnything = recent.length > 0 || updated.length > 0;

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

        {!hasAnything ? (
          <EmptyState
            icon={<Users />}
            title="No clients yet."
            description="Clients added to your company will appear here."
            action={
              can(context, "client.create")
                ? { label: "New client", href: "/clients/new" }
                : undefined
            }
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <ClientPanel title="Recently added" href="/clients/all?sort=created-desc" clients={recent} />
            <ClientPanel title="Recently updated" href="/clients/all" clients={updated} />
          </div>
        )}
      </div>
    </ModulePage>
  );
}

function ClientPanel({
  title,
  href,
  clients,
}: {
  title: string;
  href: string;
  clients: {
    id: string;
    name: string;
    code: string | null;
    status: string;
    updatedAt: Date;
  }[];
}) {
  return (
    <section className="nesto-card p-5">
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
        <p className="mt-4 text-table text-fg-subtle">Nothing to show yet.</p>
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
