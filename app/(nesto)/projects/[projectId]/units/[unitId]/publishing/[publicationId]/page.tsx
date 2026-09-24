import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { DetailGrid } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { UNIT_TYPE_CATEGORY_LABELS } from "@/config/unit-types";
import { AccessError } from "@/lib/access/guards";
import { AREA_FIELDS, AREA_LABELS, FLOOR_LEVEL_LABELS, ORIENTATION_LABELS, POSITION_LABELS, UNIT_ATTRIBUTES, type UnitAttributeKey } from "@/lib/modules/project-structure/structure.types";
import { getUnitPublication } from "@/lib/modules/project-structure/unit-publishing.service";
import { UNIT_MEDIA_CATEGORY_LABELS } from "@/lib/modules/project-structure/unit-publishing.types";
import { formatDateTime } from "@/lib/utils/format";
import { loadUnitPage, UnitShell } from "../../unit-page";

type Params = { params: Promise<{ projectId: string; unitId: string; publicationId: string }> };

export const metadata: Metadata = { title: "Published version" };

const dash = (value: string | number | null | undefined) => (value === null || value === undefined || value === "" ? "—" : value);

/**
 * One published version, exactly as it was approved (E-05D §24, §51, §74): the
 * snapshot, the Sales Plan version and the primary image it went out with. It
 * never changes when the unit does — that is what it is for.
 */
export default async function PublicationDetailPage({ params }: Params) {
  const { projectId, unitId, publicationId } = await params;
  const page = await loadUnitPage(projectId, unitId);
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
            Version {publication.versionNumber}
            {publication.isCurrent ? <span className="ml-2 text-meta font-medium text-success-strong">Current</span> : null}
          </h2>
          <Link href={`${base}/publishing`} className="text-meta font-medium text-accent-strong hover:underline">
            All versions
          </Link>
        </div>
        <p className="mt-1 text-table text-fg-muted">
          Published {formatDateTime(publication.publishedAt)}
          {publication.publishedBy ? <> by <PersonLink memberId={publication.publishedByMemberId} name={publication.publishedBy} /></> : null}
        </p>
        <DetailGrid
          className="mt-5"
          columns={3}
          items={[
            { label: "Unit code", value: snapshot.unitCode },
            { label: "Name", value: dash(snapshot.name) },
            { label: "Type", value: `${snapshot.unitType.name} · ${UNIT_TYPE_CATEGORY_LABELS[snapshot.unitType.category]}` },
            { label: "Building", value: snapshot.building.name },
            { label: "Floor", value: `${snapshot.floor.name} · ${FLOOR_LEVEL_LABELS[snapshot.floor.levelType]}` },
            { label: "Position", value: snapshot.position ? POSITION_LABELS[snapshot.position] : "—" },
            { label: "Orientation", value: snapshot.orientation ? ORIENTATION_LABELS[snapshot.orientation] : "—" },
            { label: "Rooms", value: dash(snapshot.rooms) },
            { label: "Bedrooms", value: dash(snapshot.bedrooms) },
            { label: "Bathrooms", value: dash(snapshot.bathrooms) },
            ...AREA_FIELDS.filter((field) => snapshot.areas[field] !== null).map((field) => ({ label: AREA_LABELS[field], value: <span className="tabular-nums">{Number(snapshot.areas[field]).toFixed(2)} m²</span> })),
            ...(Object.keys(snapshot.attributes) as UnitAttributeKey[]).map((key) => {
              const value = snapshot.attributes[key];
              return { label: UNIT_ATTRIBUTES[key]?.label ?? key, value: typeof value === "boolean" ? (value ? "Yes" : "No") : dash(value) };
            }),
            {
              label: "Sales Plan",
              value: snapshot.salesPlan ? (
                <Link href={`/documents/${snapshot.salesPlan.documentId}`} className="text-accent-strong hover:underline">
                  {snapshot.salesPlan.fileName ?? "Sales Plan"}
                  {snapshot.salesPlan.versionNumber ? ` · v${snapshot.salesPlan.versionNumber}` : ""}
                </Link>
              ) : (
                "—"
              ),
            },
            {
              label: "Primary image",
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
            <p className="nesto-eyebrow text-fg-subtle">Technical notes</p>
            <p className="mt-1 whitespace-pre-line text-body text-fg">{snapshot.description}</p>
          </div>
        ) : null}
      </section>
    </UnitShell>
  );
}
