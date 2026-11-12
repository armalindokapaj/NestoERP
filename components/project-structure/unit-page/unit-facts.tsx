import type { Locale } from "@/lib/i18n/config";
import { numberText } from "@/lib/i18n/format";
import { floorName, unitTypeName } from "@/lib/i18n/stock-names";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { FileText, ImageIcon } from "@/components/icons";

import { DetailGrid } from "@/components/modules/record-header";
import { UnitImage } from "@/components/project-structure/unit-page/unit-image";
import { attributesFor } from "@/lib/modules/project-structure/structure.rules";
import { AREA_FIELDS, COUNT_FIELDS, type UnitDetailDTO } from "@/lib/modules/project-structure/structure.types";
import type { UnitFilesDTO } from "@/lib/modules/project-structure/unit-publishing.types";
import { unitDisplay } from "@/lib/modules/project-structure/unit-publishing.rules";

const dash = (value: string | number | null | undefined) => (value === null || value === undefined || value === "" ? "—" : value);
const area = (value: string | null, locale: Locale) => (value === null ? "—" : `${numberText(Number(value), { minimumFractionDigits: 2, maximumFractionDigits: 2 }, locale, "en")} m²`);

/**
 * What the architect made of a unit (E-05D §10, §11, §45, §90, §91): its
 * technical data as the kind of unit it is, its areas, its primary image and
 * its Sales Plan. A field a kind of unit does not have is left out — unless it
 * holds a value, because hiding what somebody entered is worse than an unusual
 * row. Read the same on the unit's work page in its project and on its sales
 * page (/sales/units); `links` say where the media and documents are on each,
 * and `aside` adds what only one of them shows (the project's readiness).
 */
export async function UnitFacts({
  unit,
  files,
  locale,
  links,
  aside,
}: {
  unit: UnitDetailDTO;
  files: UnitFilesDTO | null;
  locale: Locale;
  links: { media: string; documents: string };
  aside?: React.ReactNode;
}) {
  const t = await getTranslations("projects");
  const display = unitDisplay(unit.unitType.category);
  const primary = files?.media.find((item) => item.isPrimary) ?? null;
  const attributes = attributesFor(unit.unitType.category).filter((key) => unit.attributes[key] !== undefined);
  const counts = COUNT_FIELDS.filter((field) => display.counts.includes(field) || unit[field] !== null);
  const areas = AREA_FIELDS.filter((field) => display.areas.includes(field) || unit.areas[field] !== null);

  // The primary image leads on a phone (§91) and sits beside the data on a wide screen (§90).
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      {files ? (
        <section className="nesto-card overflow-hidden lg:col-start-2 lg:row-start-1 lg:self-start" aria-labelledby="unit-primary-image">
          <h2 id="unit-primary-image" className="sr-only">
            {t("unitPage.primaryImage")}
          </h2>
          {primary?.thumbnailHref ? (
            <div className="aspect-[4/3] w-full bg-surface-muted" data-testid="unit-primary-image">
              <UnitImage documentId={primary.document.documentId} thumbnailHref={primary.thumbnailHref} alt={primary.caption ?? primary.document.name} fit="contain" lazy={false} />
            </div>
          ) : (
            <Link href={links.media} className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 bg-surface-muted text-meta text-fg-muted hover:text-fg">
              <ImageIcon className="size-6" aria-hidden="true" />
              {t("unitPage.noPrimaryImage")}
            </Link>
          )}
        </section>
      ) : null}

      <div className="space-y-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
        <section className="nesto-card p-5" aria-labelledby="unit-technical">
          <h2 id="unit-technical" className="text-card font-semibold text-fg">
            {t("unitPage.technicalData")}
          </h2>
          <DetailGrid
            className="mt-4"
            items={[
              { label: t("unitPage.type"), value: `${unitTypeName(unit.unitType.name, locale)} · ${t(`unitCategory.${unit.unitType.category}`)}` },
              { label: t("unitPage.building"), value: unit.building.code ? `${unit.building.name} (${unit.building.code})` : unit.building.name },
              { label: t("unitPage.floor"), value: `${floorName(unit.floor.name, locale)} · ${t(`floorLevel.${unit.floor.levelType}`)}` },
              ...(display.orientation || unit.orientation ? [{ label: t("unitPage.orientation"), value: unit.orientation ? t(`orientation.${unit.orientation}`) : "—" }] : []),
              ...counts.map((field) => ({ label: t(`count.${field}`), value: dash(unit[field]) })),
              ...attributes.map((key) => {
                const value = unit.attributes[key];
                return { label: t(`attribute.${key}`), value: typeof value === "boolean" ? (value ? t("unitPage.yes") : t("unitPage.no")) : dash(value) };
              }),
            ]}
          />
          {unit.description ? (
            <div className="mt-4">
              <p className="nesto-eyebrow text-fg-subtle">{t("unitPage.technicalNotes")}</p>
              <p className="mt-1 whitespace-pre-line text-body text-fg">{unit.description}</p>
            </div>
          ) : null}
        </section>

        <section className="nesto-card p-5" aria-labelledby="unit-areas">
          <h2 id="unit-areas" className="text-card font-semibold text-fg">
            {t("unitPage.areas")}
          </h2>
          <DetailGrid className="mt-4" columns={3} items={areas.map((field) => ({ label: t(`area.${field}`), value: <span className="tabular-nums">{area(unit.areas[field], locale)}</span> }))} />
        </section>
      </div>

      <div className="space-y-4 lg:col-start-2 lg:self-start">
        {files ? (
          <section className="nesto-card p-5" aria-labelledby="unit-sales-plan">
            <h2 id="unit-sales-plan" className="text-card font-semibold text-fg">
              {t("unitPage.salesPlan")}
            </h2>
            {files.salesPlan ? (
              <Link href={files.salesPlan.href} className="mt-3 flex items-center gap-2 text-table font-medium text-fg hover:underline">
                <FileText className="size-4 text-fg-subtle" aria-hidden="true" />
                <span className="truncate">{files.salesPlan.name}</span>
                {files.salesPlan.versionNumber ? <span className="text-meta text-fg-muted">v{files.salesPlan.versionNumber}</span> : null}
              </Link>
            ) : (
              <p className="mt-3 text-table text-fg-muted">
                {t("unitPage.salesPlanMissing")}{" "}
                {files.capabilities.canManageDocuments ? (
                  <Link href={links.documents} className="font-medium text-accent-strong hover:underline">
                    {t("unitPage.uploadIt")}
                  </Link>
                ) : null}
              </p>
            )}
          </section>
        ) : null}

        {aside}
      </div>
    </div>
  );
}
