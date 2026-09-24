import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { FileText, ImageIcon } from "lucide-react";

import { DetailGrid } from "@/components/modules/record-header";
import { ReadinessPanel } from "@/components/project-structure/unit-page/publication-badge";
import { UnitImage } from "@/components/project-structure/unit-page/unit-image";
import { UNIT_TYPE_CATEGORY_LABELS } from "@/config/unit-types";
import { can, canAccessModule } from "@/lib/access/can";
import { attributesFor } from "@/lib/modules/project-structure/structure.rules";
import { AREA_FIELDS, AREA_LABELS, COUNT_FIELDS, COUNT_LABELS, FLOOR_LEVEL_LABELS, ORIENTATION_LABELS, POSITION_LABELS, UNIT_ATTRIBUTES } from "@/lib/modules/project-structure/structure.types";
import { listUnitFiles } from "@/lib/modules/project-structure/unit-files.service";
import { unitDisplay } from "@/lib/modules/project-structure/unit-publishing.rules";
import { loadUnitPage, UnitShell } from "./unit-page";

type Params = { params: Promise<{ projectId: string; unitId: string }> };

export const metadata: Metadata = { title: "Unit" };

const dash = (value: string | number | null | undefined) => (value === null || value === undefined || value === "" ? "—" : value);
const area = (value: string | null) => (value === null ? "—" : `${Number(value).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`);

/**
 * The unit's overview (E-05D §10, §11, §45, §90, §91): its technical data as the
 * kind of unit it is, its primary image, its Sales Plan and whether it is ready
 * to publish. A field a kind of unit does not have is left out — unless it holds
 * a value, because hiding what somebody entered is worse than an unusual row.
 */
export default async function UnitOverviewPage({ params }: Params) {
  const { projectId, unitId } = await params;
  const page = await loadUnitPage(projectId, unitId);
  const { context, unit, publishing } = page;
  const display = unitDisplay(unit.unitType.category);
  const filesOpen = canAccessModule(context, "documents") && can(context, "document.view");
  const files = filesOpen ? await listUnitFiles(context, unit.id) : null;
  const primary = files?.media.find((item) => item.isPrimary) ?? null;
  const base = `/projects/${unit.projectId}/units/${unit.id}`;

  const attributes = attributesFor(unit.unitType.category).filter((key) => unit.attributes[key] !== undefined);
  const counts = COUNT_FIELDS.filter((field) => display.counts.includes(field) || unit[field] !== null);
  const areas = AREA_FIELDS.filter((field) => display.areas.includes(field) || unit.areas[field] !== null);

  return (
    <UnitShell page={page} active="overview">
      {/* The primary image leads on a phone (§91) and sits beside the data on a wide screen (§90). */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        {files ? (
          <section className="nesto-card overflow-hidden lg:col-start-2 lg:row-start-1 lg:self-start" aria-labelledby="unit-primary-image">
            <h2 id="unit-primary-image" className="sr-only">
              Primary image
            </h2>
            {primary?.thumbnailHref ? (
              <div className="aspect-[4/3] w-full bg-surface-muted" data-testid="unit-primary-image">
                <UnitImage documentId={primary.document.documentId} thumbnailHref={primary.thumbnailHref} alt={primary.caption ?? primary.document.name} fit="contain" lazy={false} />
              </div>
            ) : (
              <Link href={`${base}/media`} className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 bg-surface-muted text-meta text-fg-muted hover:text-fg">
                <ImageIcon className="size-6" aria-hidden="true" />
                No primary image yet
              </Link>
            )}
          </section>
        ) : null}

        <div className="space-y-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <section className="nesto-card p-5" aria-labelledby="unit-technical">
            <h2 id="unit-technical" className="text-card font-semibold text-fg">
              Technical data
            </h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: "Type", value: `${unit.unitType.name} · ${UNIT_TYPE_CATEGORY_LABELS[unit.unitType.category]}` },
                { label: "Building", value: unit.building.code ? `${unit.building.name} (${unit.building.code})` : unit.building.name },
                { label: "Floor", value: `${unit.floor.name} · ${FLOOR_LEVEL_LABELS[unit.floor.levelType]}` },
                ...(display.position || unit.position ? [{ label: "Position", value: unit.position ? POSITION_LABELS[unit.position] : "—" }] : []),
                ...(display.orientation || unit.orientation ? [{ label: "Orientation", value: unit.orientation ? ORIENTATION_LABELS[unit.orientation] : "—" }] : []),
                ...counts.map((field) => ({ label: COUNT_LABELS[field], value: dash(unit[field]) })),
                ...attributes.map((key) => {
                  const value = unit.attributes[key];
                  return { label: UNIT_ATTRIBUTES[key].label, value: typeof value === "boolean" ? (value ? "Yes" : "No") : dash(value) };
                }),
              ]}
            />
            {unit.description ? (
              <div className="mt-4">
                <p className="nesto-eyebrow text-fg-subtle">Technical notes</p>
                <p className="mt-1 whitespace-pre-line text-body text-fg">{unit.description}</p>
              </div>
            ) : null}
          </section>

          <section className="nesto-card p-5" aria-labelledby="unit-areas">
            <h2 id="unit-areas" className="text-card font-semibold text-fg">
              Areas
            </h2>
            <DetailGrid className="mt-4" columns={3} items={areas.map((field) => ({ label: AREA_LABELS[field], value: <span className="tabular-nums">{area(unit.areas[field])}</span> }))} />
          </section>
        </div>

        <div className="space-y-4 lg:col-start-2 lg:self-start">
          {files ? (
            <section className="nesto-card p-5" aria-labelledby="unit-sales-plan">
              <h2 id="unit-sales-plan" className="text-card font-semibold text-fg">
                Sales Plan
              </h2>
              {files.salesPlan ? (
                <Link href={files.salesPlan.href} className="mt-3 flex items-center gap-2 text-table font-medium text-fg hover:underline">
                  <FileText className="size-4 text-fg-subtle" aria-hidden="true" />
                  <span className="truncate">{files.salesPlan.name}</span>
                  {files.salesPlan.versionNumber ? <span className="text-meta text-fg-muted">v{files.salesPlan.versionNumber}</span> : null}
                </Link>
              ) : (
                <p className="mt-3 text-table text-fg-muted">
                  Sales Plan missing. Required before publishing.{" "}
                  {files.capabilities.canManageDocuments ? (
                    <Link href={`${base}/documents`} className="font-medium text-accent-strong hover:underline">
                      Upload it
                    </Link>
                  ) : null}
                </p>
              )}
            </section>
          ) : null}

          {publishing.status === "ARCHIVED" ? null : <ReadinessPanel readiness={publishing.readiness} />}
        </div>
      </div>
    </UnitShell>
  );
}
