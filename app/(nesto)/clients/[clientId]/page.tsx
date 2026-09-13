import type { Metadata } from "next";
import Link from "next/link";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { ClientActions } from "@/components/clients/client-actions";
import { Badge } from "@/components/ui/badge";
import { clientTypeLabels } from "@/lib/modules/clients/client.status";
import * as clients from "@/lib/modules/clients/client.service";
import { formatDateTime, orDash } from "@/lib/utils/format";
import { clientBreadcrumbs, loadClient } from "./client-context";
import { ClientTabs } from "./client-tabs";

type Params = { params: Promise<{ clientId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { clientId } = await params;
  try {
    const { client } = await loadClient(clientId);
    return { title: client.name };
  } catch {
    return { title: "Client" };
  }
}

/**
 * Client overview (PRD #12 §56, §59, §60).
 *
 * Each section checks the permission behind it, so a role without contact
 * access sees no contact summary rather than an empty locked card
 * (PRD #12 §61).
 */
export default async function ClientOverviewPage({ params }: Params) {
  const { clientId } = await params;
  const { context, client } = await loadClient(clientId);

  const archived = client.archivedAt !== null || client.status === "ARCHIVED";
  const may = client.capabilities;

  const activity = may.canViewActivity
    ? await clients.listActivity(context, clientId, { page: 1, limit: 5 })
    : null;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={clientBreadcrumbs(client)}
        title={client.name}
        subtitle={client.code ?? client.legalName ?? undefined}
        status={client.status}
        badges={<Badge tone="neutral">{clientTypeLabels[client.type]}</Badge>}
        meta={[
          {
            label: "Primary contact",
            value: client.primaryContact ? (
              <span className="flex items-center gap-2">
                {client.primaryContact.fullName}
                {client.primaryContact.status === "INACTIVE" ? (
                  <Badge tone="neutral">Inactive</Badge>
                ) : null}
              </span>
            ) : (
              "None"
            ),
          },
          {
            label: "Active projects",
            value: may.canViewProjects ? (
              <Link
                href={`/clients/${client.id}/projects`}
                className="text-fg transition-colors hover:text-accent"
              >
                {client.counts.visibleProjects}
              </Link>
            ) : (
              "—"
            ),
          },
          { label: "Contacts", value: may.canViewContacts ? client.counts.activeContacts : "—" },
        ]}
        actions={
          <ClientActions
            clientId={client.id}
            clientName={client.name}
            archived={archived}
            activeProjects={client.counts.visibleProjects}
            canUpdate={may.canEdit}
            canArchive={may.canArchive}
            canRestore={may.canRestore}
          />
        }
      />

      <ClientTabs
        clientId={client.id}
        active="overview"
        capabilities={client.capabilities}
      />

      {archived ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          This client is archived and read-only. Restore it to make changes.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5 lg:col-span-2">
          <h2 className="text-card font-semibold text-fg">Client details</h2>
          <DetailGrid
            className="mt-4"
            items={[
              { label: "Legal name", value: orDash(client.legalName) },
              { label: "Type", value: clientTypeLabels[client.type] },
              { label: "Client code", value: orDash(client.code) },
              {
                label: "Email",
                value: client.contact.email ? (
                  <a href={`mailto:${client.contact.email}`} className="hover:text-accent">
                    {client.contact.email}
                  </a>
                ) : (
                  "—"
                ),
              },
              {
                label: "Phone",
                value: client.contact.phone ? (
                  <a href={`tel:${client.contact.phone}`} className="hover:text-accent">
                    {client.contact.phone}
                  </a>
                ) : (
                  "—"
                ),
              },
              {
                label: "Website",
                value: client.contact.website ? (
                  // Only http(s) reaches this point; the schema refuses
                  // anything else (PRD #12 §47, §140).
                  <a
                    href={client.contact.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-accent"
                  >
                    {client.contact.website}
                  </a>
                ) : (
                  "—"
                ),
              },
            ]}
          />

          <div className="mt-6 border-t border-line pt-5">
            <h3 className="text-table font-semibold text-fg">Address</h3>
            <DetailGrid
              className="mt-3"
              items={[
                { label: "Address", value: orDash(client.address.address) },
                { label: "City", value: orDash(client.address.city) },
                { label: "Country", value: orDash(client.address.country) },
              ]}
            />
          </div>
        </section>

        <div className="space-y-4">
          {may.canViewContacts ? (
            <section className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">Primary contact</h2>
                <Link
                  href={`/clients/${client.id}/contacts`}
                  className="text-table font-medium text-accent-strong"
                >
                  All contacts
                </Link>
              </div>
              {client.primaryContact ? (
                <div className="mt-3 space-y-1">
                  <p className="text-table font-medium text-fg">
                    {client.primaryContact.fullName}
                  </p>
                  {client.primaryContact.jobTitle ? (
                    <p className="text-meta text-fg-subtle">{client.primaryContact.jobTitle}</p>
                  ) : null}
                  {client.primaryContact.email ? (
                    <a
                      href={`mailto:${client.primaryContact.email}`}
                      className="block text-meta text-fg-muted hover:text-accent"
                    >
                      {client.primaryContact.email}
                    </a>
                  ) : null}
                  {client.primaryContact.phone ? (
                    <a
                      href={`tel:${client.primaryContact.phone}`}
                      className="block text-meta text-fg-muted hover:text-accent"
                    >
                      {client.primaryContact.phone}
                    </a>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-table text-fg-subtle">No primary contact.</p>
              )}
            </section>
          ) : null}

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Record</h2>
            <dl className="mt-4 space-y-3">
              <Meta label="Created" value={formatDateTime(client.createdAt)} />
              <Meta label="Updated" value={formatDateTime(client.updatedAt)} />
              {client.archivedAt ? (
                <Meta label="Archived" value={formatDateTime(client.archivedAt)} />
              ) : null}
            </dl>
          </section>

          {activity ? (
            <section className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">Activity</h2>
                <Link
                  href={`/clients/${client.id}/activity`}
                  className="text-table font-medium text-accent-strong"
                >
                  View all
                </Link>
              </div>
              {activity.data.length === 0 ? (
                <p className="mt-4 text-table text-fg-subtle">No activity recorded yet.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {activity.data.map((entry) => (
                    <li key={entry.id} className="text-table">
                      <p className="text-fg">
                        <span className="font-medium">{entry.actor ?? "Someone"}</span>{" "}
                        {entry.message ?? entry.action}
                      </p>
                      <p className="text-meta text-fg-subtle">{formatDateTime(entry.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </div>
      </div>
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="client" parentId={clientId} />
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="nesto-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 text-table text-fg">{value}</dd>
    </div>
  );
}
