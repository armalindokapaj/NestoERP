import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { DetailGrid } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { clientTypeLabels } from "@/lib/modules/clients/client.status";
import * as clients from "@/lib/modules/clients/client.service";
import { formatDateTime, orDash } from "@/lib/utils/format";
import { clientsLabel } from "@/lib/i18n/modules/clients/labels";
import { getTranslations } from "@/lib/i18n/server";
import { loadClient } from "../client-context";

type Params = { params: Promise<{ clientId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { clientId } = await params;
  try {
    const { client } = await loadClient(clientId);
    return { title: client.name };
  } catch {
    return { title: (await getTranslations("clients"))("meta.client") };
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
  const t = await getTranslations("clients");
  const typeLabel = clientsLabel(t, "clientType", client.type, clientTypeLabels[client.type]);
  const activity = may.canViewActivity
    ? await clients.listActivity(context, clientId, { page: 1, limit: 5 })
    : null;

  return (
    <div className="space-y-5">
      {archived ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          {t("detail.archivedNotice")}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5 lg:col-span-2">
          <h2 className="text-card font-semibold text-fg">{t("detail.clientDetails")}</h2>
          <DetailGrid
            className="mt-4"
            items={[
              { label: t("detail.legalName"), value: orDash(client.legalName) },
              { label: t("detail.type"), value: typeLabel },
              { label: t("detail.clientCode"), value: orDash(client.code) },
              {
                label: t("detail.email"),
                value: client.contact.email ? (
                  <a href={`mailto:${client.contact.email}`} className="hover:text-accent">
                    {client.contact.email}
                  </a>
                ) : (
                  "—"
                ),
              },
              {
                label: t("detail.phone"),
                value: client.contact.phone ? (
                  <a href={`tel:${client.contact.phone}`} className="hover:text-accent">
                    {client.contact.phone}
                  </a>
                ) : (
                  "—"
                ),
              },
              {
                label: t("detail.website"),
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
            <h3 className="text-table font-semibold text-fg">{t("detail.address")}</h3>
            <DetailGrid
              className="mt-3"
              items={[
                { label: t("detail.address"), value: orDash(client.address.address) },
                { label: t("detail.city"), value: orDash(client.address.city) },
                { label: t("detail.country"), value: orDash(client.address.country) },
              ]}
            />
          </div>
        </section>

        <div className="space-y-4">
          {may.canViewContacts ? (
            <section className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">{t("detail.primaryContact")}</h2>
                <Link
                  href={`/clients/${client.id}/contacts`}
                  className="text-table font-medium text-accent-strong"
                >
                  {t("detail.allContacts")}
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
                      className="block text-meta text-fg-muted hover:text-accent [overflow-wrap:anywhere]"
                    >
                      {client.primaryContact.email}
                    </a>
                  ) : null}
                  {client.primaryContact.phone ? (
                    <a
                      href={`tel:${client.primaryContact.phone}`}
                      className="block text-meta text-fg-muted hover:text-accent [overflow-wrap:anywhere]"
                    >
                      {client.primaryContact.phone}
                    </a>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-table text-fg-subtle">{t("detail.noPrimaryContact")}</p>
              )}
            </section>
          ) : null}

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.record")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta label={t("detail.created")} value={formatDateTime(client.createdAt)} />
              <Meta label={t("detail.updated")} value={formatDateTime(client.updatedAt)} />
              {client.archivedAt ? (
                <Meta label={t("detail.archived")} value={formatDateTime(client.archivedAt)} />
              ) : null}
            </dl>
          </section>

          {activity ? (
            <section className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">{t("detail.activity")}</h2>
                <Link
                  href={`/clients/${client.id}/activity`}
                  className="text-table font-medium text-accent-strong"
                >
                  {t("detail.viewAll")}
                </Link>
              </div>
              {activity.data.length === 0 ? (
                <p className="mt-4 text-table text-fg-subtle">{t("detail.noActivity")}</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {activity.data.map((entry) => (
                    <li key={entry.id} className="text-table">
                      <p className="text-fg">
                        {entry.actor ? <PersonLink memberId={entry.actorMemberId} name={entry.actor} /> : <span className="font-medium">{t("common.someone")}</span>}{" "}
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
