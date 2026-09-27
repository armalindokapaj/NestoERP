import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { DetailGrid } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { AREA_FIELDS, UNIT_ATTRIBUTES, type UnitAttributeKey } from "@/lib/modules/project-structure/structure.types";
import { getUnitPublication } from "@/lib/modules/project-structure/unit-publishing.service";
import { UNIT_MEDIA_CATEGORY_LABELS } from "@/lib/modules/project-structure/unit-publishing.types";
import { formatDateTime } from "@/lib/utils/format";
import { loadUnitPage, UnitShell } from "../../unit-page";

type Params = { params: Promise<{ projectId: string; unitId: string; publicationId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("unitPage.publishedVersion") };
}

const dash = (value: string | number | null | undefined) => (value === null || value === undefined || value === "" ? "—" : value);

/**
 * One published version, exactly as it was approved (E-05D §24, §51, §74): the
 * snapshot, the Sales Plan version and the primary image it went out with. It
 * never changes when the unit does — that is what it is for.
 */
export default async function PublicationDetailPage({ params }: Params) {
  const { projectId, unitId, publicationId } = await params;
  const page = await loadUnitPage(projectId, unitId);
  const t = await getTranslations("projects");
  if (!page.publishing.capabilities.canViewHistory) notFound();
  const publication = await getUnitPublication(page.context, page.unit.id, publicationId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const snapshot = publication.snapshot;
  const base = `/projects/${page.unit.projectId}/units/${page.unit.id}`;

  return (
    <UnitShell page={page} active="publishing">
      <section className="nesto-card p-5" aria-labelledby="publication-detail" data-testid="publication-detail">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="publication-detail" className="text-card font-semibold text-fg">
            {t("unitPage.version", { version: publication.versionNumber })}
            {publication.isCurrent ? <span className="ml-2 text-meta font-medium text-success-strong">{t("unitPage.current")}</span> : null}
          </h2>
          <Link href={`${base}/publishing`} className="text-meta font-medium text-accent-strong hover:underline">
            {t("unitPage.allVersions")}
          </Link>
        </div>
        <p className="mt-1 text-table text-fg-muted">
          {t("unitPage.published", { date: formatDateTime(publication.publishedAt) })}
          {publication.publishedBy ? <> {t("unitPage.by")} <PersonLink memberId={publication.publishedByMemberId} name={publication.publishedBy} /></> : null}
        </p>
        <DetailGrid
          className="mt-5"
          columns={3}
          items={[
            { label: t("unitPage.unitCode"), value: snapshot.unitCode },
            { label: t("unitPage.name"), value: dash(snapshot.name) },
            { label: t("unitPage.type"), value: `${snapshot.unitType.name} · ${t(`unitCategory.${snapshot.unitType.category}`)}` },
            { label: t("unitPage.building"), value: snapshot.building.name },
            { label: t("unitPage.floor"), value: `${snapshot.floor.name} · ${t(`floorLevel.${snapshot.floor.levelType}`)}` },
            { label: t("unitPage.position"), value: snapshot.position ? t(`position.${snapshot.position}`) : "—" },
            { label: t("unitPage.orientation"), value: snapshot.orientation ? t(`orientation.${snapshot.orientation}`) : "—" },
            { label: t("count.rooms"), value: dash(snapshot.rooms) },
            { label: t("count.bedrooms"), value: dash(snapshot.bedrooms) },
            { label: t("count.bathrooms"), value: dash(snapshot.bathrooms) },
            ...AREA_FIELDS.filter((field) => snapshot.areas[field] !== null).map((field) => ({ label: t(`area.${field}`), value: <span className="tabular-nums">{Number(snapshot.areas[field]).toFixed(2)} m²</span> })),
            ...(Object.keys(snapshot.attributes) as UnitAttributeKey[]).map((key) => {
              const value = snapshot.attributes[key];
              return { label: key in UNIT_ATTRIBUTES ? t(`attribute.${key}`) : key, value: typeof value === "boolean" ? (value ? t("unitPage.yes") : t("unitPage.no")) : dash(value) };
            }),
            {
              label: t("unitPage.salesPlan"),
              value: snapshot.salesPlan ? (
                <Link href={`/documents/${snapshot.salesPlan.documentId}`} className="text-accent-strong hover:underline">
                  {snapshot.salesPlan.fileName ?? t("unitPage.salesPlan")}
                  {snapshot.salesPlan.versionNumber ? ` · v${snapshot.salesPlan.versionNumber}` : ""}
                </Link>
              ) : (
                "—"
              ),
            },
            {
              label: t("unitPage.primaryImage"),
              value: snapshot.primaryImage ? (
                <Link href={`/documents/${snapshot.primaryImage.documentId}`} className="text-accent-strong hover:underline">
                  {snapshot.primaryImage.caption ?? UNIT_MEDIA_CATEGORY_LABELS[snapshot.primaryImage.category]}
                </Link>
              ) : (
                "—"
              ),
            },
          ]}
        />
        {snapshot.description ? (
          <div className="mt-5">
            <p className="nesto-eyebrow text-fg-subtle">{t("unitPage.technicalNotes")}</p>
            <p className="mt-1 whitespace-pre-line text-body text-fg">{snapshot.description}</p>
          </div>
        ) : null}
      </section>
    </UnitShell>
  );
}
