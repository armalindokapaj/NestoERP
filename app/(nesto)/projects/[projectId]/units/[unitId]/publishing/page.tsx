import type { Metadata } from "next";
import { formatDateTime } from "@/lib/i18n/format";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";

import { DetailGrid } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { PublicationBadge, ReadinessPanel } from "@/components/project-structure/unit-page/publication-badge";
import { listUnitPublications } from "@/lib/modules/project-structure/unit-publishing.service";
import { loadUnitPage, UnitShell } from "../unit-page";

type Params = { params: Promise<{ projectId: string; unitId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("unitPage.publishingTitle") };
}

/**
 * Publishing: where the unit stands and every version ever published (E-05D
 * §45, §50). Each change to the unit went out as its own version the moment it
 * was saved (units publish on create, 2026-11); a version nobody's change wrote
 * — the 2026-11 backfill, a unit made in the 3D tool, a file promoted by the
 * scanner — reads "Published automatically". Archive and restore are in the
 * header, the same on every section of the unit.
 */
export default async function UnitPublishingPage({ params }: Params) {
  const locale = await getLocale();
  const { projectId, unitId } = await params;
  const page = await loadUnitPage(projectId, unitId);
  const { context, unit, publishing } = page;
  const t = await getTranslations("projects");
  const history = publishing.capabilities.canViewHistory ? await listUnitPublications(context, unit.id) : null;
  const base = `/projects/${unit.projectId}/units/${unit.id}`;
  const current = publishing.currentPublication;

  return (
    <UnitShell page={page} active="publishing">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="space-y-4">
          <section className="nesto-card p-5" aria-labelledby="publishing-state" data-testid="publishing-state">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="publishing-state" className="text-card font-semibold text-fg">
                {t("unitPage.publishing")}
              </h2>
              <PublicationBadge status={publishing.status} versionNumber={current?.versionNumber} />
            </div>
            <DetailGrid
              className="mt-4"
              items={[
                {
                  label: t("unitPage.currentVersion"),
                  value: current ? (
                    <>
                      v{current.versionNumber} · {formatDateTime(current.publishedAt, locale)}
                      {current.publishedByMemberId === null ? <> · {t("unitPage.publishedAutomatically")}</> : current.publishedBy ? <> · <PersonLink memberId={current.publishedByMemberId} name={current.publishedBy} /></> : null}
                    </>
                  ) : (
                    t("unitPage.neverPublished")
                  ),
                },
                { label: t("unitPage.statusSince"), value: publishing.statusChangedAt ? formatDateTime(publishing.statusChangedAt, locale) : "—" },
              ]}
            />
            <p className="mt-4 text-table text-fg-muted">{t("unitPage.publishesOnSave")}</p>
          </section>

          {history ? (
            <section className="nesto-card p-5" aria-labelledby="publication-history">
              <h2 id="publication-history" className="text-card font-semibold text-fg">
                {t("unitPage.history")}
              </h2>
              {history.length === 0 ? (
                <p className="mt-3 text-table text-fg-muted">{t("unitPage.noVersions")}</p>
              ) : (
                <ol className="mt-3 divide-y divide-line" data-testid="publication-history">
                  {history.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-table">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <Link href={`${base}/publishing/${row.id}`} className="font-medium text-fg hover:underline">
                          {t("unitPage.versionPublished", { version: row.versionNumber })}
                        </Link>
                        {row.isCurrent ? <span className="text-meta font-medium text-success-strong">{t("unitPage.current")}</span> : null}
                        <span className="text-fg-muted">{formatDateTime(row.publishedAt, locale)}</span>
                        {row.publishedByMemberId === null ? (
                          <span className="text-fg-muted">{t("unitPage.publishedAutomatically")}</span>
                        ) : row.publishedBy ? (
                          <span className="text-fg-muted">{t("unitPage.by")} <PersonLink memberId={row.publishedByMemberId} name={row.publishedBy} /></span>
                        ) : null}
                      </span>
                      {row.salesPlanVersionNumber ? <span className="text-meta text-fg-subtle">{t("unitPage.salesPlanVersion", { version: row.salesPlanVersionNumber })}</span> : null}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ) : null}
        </div>

        {publishing.status === "ARCHIVED" ? null : <ReadinessPanel readiness={publishing.readiness} />}
      </div>
    </UnitShell>
  );
}
