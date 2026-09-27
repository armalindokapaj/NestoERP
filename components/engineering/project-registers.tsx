import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { NoResultsState, hasActiveFilters } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { engineeringLabel, type EngineeringLabelGroup } from "@/lib/i18n/modules/engineering/labels";
import { getTranslations } from "@/lib/i18n/server";
import type { Translate } from "@/lib/i18n/translator";
import type { UserContext } from "@/lib/context/types";
import { listEngineeringDocuments, projectEngineeringOptions } from "@/lib/modules/engineering/engineering.documents";
import { listRfis } from "@/lib/modules/engineering/engineering.rfis";
import { engineeringDocumentListSchema, rfiListSchema, submittalListSchema, transmittalListSchema } from "@/lib/modules/engineering/engineering.schema";
import { listSubmittals } from "@/lib/modules/engineering/engineering.submittals";
import { listTransmittals } from "@/lib/modules/engineering/engineering.transmittals";
import {
  DISCIPLINES,
  DISCIPLINE_LABELS,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  REVIEW_STATUS_LABELS,
  RFI_PRIORITIES,
  RFI_PRIORITY_LABELS,
  RFI_STATUSES,
  RFI_STATUS_LABELS,
  SUBMITTAL_STATUSES,
  SUBMITTAL_TYPES,
  SUBMITTAL_TYPE_LABELS,
  TRANSMITTAL_DIRECTIONS,
  TRANSMITTAL_DIRECTION_LABELS,
  TRANSMITTAL_STATUSES,
  TRANSMITTAL_STATUS_LABELS,
} from "@/lib/modules/engineering/engineering.types";
import { flat, keepPageInRange, orNotFound, pageHref, registerMeta } from "./page-helpers";
import { NewDocumentButton, NewRfiButton, NewSubmittalButton } from "./record-dialogs";
import { DocumentRegister, RfiRegister, SubmittalRegister, TransmittalRegister } from "./registers";
import { NewTransmittalButton } from "./transmittal-editor";

/**
 * The project registers (PRD #46 §76-§78, §124, §166-§169): the same register
 * components as the company views, narrowed to one project, with filters in
 * the URL and creation beside the heading.
 */

type Params = Record<string, string | string[] | undefined>;

const choose = <T extends string>(t: Translate<"engineering">, group: EngineeringLabelGroup, values: readonly T[], labels: Record<string, string>) => values.map((value) => ({ value, label: engineeringLabel(t, group, value, labels[value]) }));

function Heading({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-section font-semibold text-fg">{title}</h2>
        <p className="mt-0.5 text-table text-fg-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}

/**
 * The register's count and pages (AUD-08 §4): "1–50 of 73", "0 results" when
 * empty, and a count even on a single page — never the old pager that said
 * nothing until a second page existed.
 */
function Pager({ base, params, result }: { base: string; params: Params; result: { page: number; pageSize: number; total: number } }) {
  return <Pagination meta={registerMeta(result)} buildHref={(page) => pageHref(base, params, page)} />;
}

/** Search or a filter narrows the register: nothing found is "no matches", not an empty register (AUD-05 §6, UX-11). */
const narrowed = (params: Params, filters: FilterConfig[]) => hasActiveFilters(params, ["q", ...filters.map((filter) => filter.param)]);

async function contractorFilter(context: UserContext, projectId: string, t: Translate<"engineering">): Promise<FilterConfig[]> {
  const options = await projectEngineeringOptions(context, projectId, "rfi.respond").catch(() => null);
  return options?.contractors.length ? [{ param: "contractorId", label: t("filters.contractor"), options: options.contractors.map((item) => ({ value: item.id, label: item.label })) }] : [];
}

export async function ProjectDocumentRegister({ context, projectId, params, drawings }: { context: UserContext; projectId: string; params: Params; drawings: boolean }) {
  const t = await getTranslations("engineering");
  const query = engineeringDocumentListSchema.parse({ ...flat(params), projectId, drawings: drawings ? "1" : undefined });
  const [result, contractors] = await Promise.all([orNotFound(listEngineeringDocuments(context, query)), contractorFilter(context, projectId, t)]);
  const base = `/projects/${projectId}/engineering/${drawings ? "drawings" : "documents"}`;
  keepPageInRange(base, params, query.page, result);
  const filters: FilterConfig[] = [
    { param: "discipline", label: t("filters.discipline"), options: choose(t, "discipline", DISCIPLINES, DISCIPLINE_LABELS) },
    { param: "status", label: t("filters.status"), options: choose(t, "reviewStatus", DOCUMENT_STATUSES, REVIEW_STATUS_LABELS) },
    ...(drawings ? [] : [{ param: "type", label: t("filters.type"), options: choose(t, "documentType", DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS) }]),
    ...contractors,
  ];
  return (
    <div className="space-y-4">
      <Heading
        title={drawings ? t("project.drawingRegister") : t("project.engineeringDocuments")}
        description={drawings ? t("project.drawingRegisterBody") : t("project.engineeringDocumentsBody")}
        action={can(context, "engineering_document.create") ? <NewDocumentButton projectId={projectId} drawing={drawings} /> : null}
      />
      <ListToolbar searchPlaceholder={drawings ? t("filters.searchDrawing") : t("filters.searchNumberTitle")} searchParam="q" filters={filters} />
      {result.items.length === 0 && narrowed(params, filters) ? <NoResultsState noun={drawings ? t("nouns.drawings") : t("nouns.documents")} clearHref={base} /> : <DocumentRegister items={result.items} drawings={drawings} />}
      <Pager base={base} params={params} result={result} />
    </div>
  );
}

export async function ProjectRfiRegister({ context, projectId, params }: { context: UserContext; projectId: string; params: Params }) {
  const t = await getTranslations("engineering");
  const query = rfiListSchema.parse({ ...flat(params), projectId });
  const [result, contractors] = await Promise.all([orNotFound(listRfis(context, query)), contractorFilter(context, projectId, t)]);
  const base = `/projects/${projectId}/engineering/rfis`;
  keepPageInRange(base, params, query.page, result);
  const filters: FilterConfig[] = [
    { param: "status", label: t("filters.status"), options: choose(t, "rfiStatus", RFI_STATUSES, RFI_STATUS_LABELS) },
    { param: "priority", label: t("filters.priority"), options: choose(t, "priority", RFI_PRIORITIES, RFI_PRIORITY_LABELS) },
    { param: "discipline", label: t("filters.discipline"), options: choose(t, "discipline", DISCIPLINES, DISCIPLINE_LABELS) },
    { param: "assignee", label: t("filters.assignee"), options: [{ value: "me", label: t("filters.assignedToMe") }] },
    ...contractors,
  ];
  return (
    <div className="space-y-4">
      <Heading title={t("project.rfis")} description={t("project.rfisBody")} action={can(context, "rfi.create") ? <NewRfiButton projectId={projectId} /> : null} />
      <ListToolbar searchPlaceholder={t("filters.searchRfi")} searchParam="q" filters={filters} />
      {result.items.length === 0 && narrowed(params, filters) ? <NoResultsState noun={t("nouns.rfis")} clearHref={base} /> : <RfiRegister items={result.items} />}
      <Pager base={base} params={params} result={result} />
    </div>
  );
}

const VIEWS = {
  all: { title: "project.submittals", description: "project.submittalsBody", noun: "nouns.submittals", types: undefined, defaultType: "TECHNICAL_SUBMITTAL", path: "submittals", create: "project.newSubmittal" },
  method: { title: "project.methodStatements", description: "project.methodStatementsBody", noun: "nouns.methodStatements", types: "METHOD_STATEMENT", defaultType: "METHOD_STATEMENT", path: "method-statements", create: "project.newMethodStatement" },
  material: { title: "project.materialSubmittals", description: "project.materialSubmittalsBody", noun: "nouns.materialSubmittals", types: "MATERIAL_SUBMITTAL,PRODUCT_DATA,SAMPLE", defaultType: "MATERIAL_SUBMITTAL", path: "material-submittals", create: "project.newMaterialSubmittal" },
} as const;

export async function ProjectSubmittalRegister({ context, projectId, params, view }: { context: UserContext; projectId: string; params: Params; view: keyof typeof VIEWS }) {
  const t = await getTranslations("engineering");
  const spec = VIEWS[view];
  const query = submittalListSchema.parse({ ...flat(params), projectId, types: spec.types });
  const [result, contractors] = await Promise.all([orNotFound(listSubmittals(context, query)), contractorFilter(context, projectId, t)]);
  const base = `/projects/${projectId}/engineering/${spec.path}`;
  keepPageInRange(base, params, query.page, result);
  const filters: FilterConfig[] = [
    { param: "status", label: t("filters.status"), options: choose(t, "reviewStatus", SUBMITTAL_STATUSES, REVIEW_STATUS_LABELS) },
    ...(view === "all" ? [{ param: "type", label: t("filters.type"), options: choose(t, "submittalType", SUBMITTAL_TYPES, SUBMITTAL_TYPE_LABELS) }] : []),
    { param: "reviewer", label: t("filters.reviewer"), options: [{ value: "me", label: t("filters.assignedToMe") }] },
    ...contractors,
  ];
  return (
    <div className="space-y-4">
      <Heading title={t(spec.title)} description={t(spec.description)} action={can(context, "submittal.create") ? <NewSubmittalButton projectId={projectId} defaultType={spec.defaultType} label={t(spec.create)} /> : null} />
      <ListToolbar searchPlaceholder={t("filters.searchSubmittal")} searchParam="q" filters={filters} />
      {result.items.length === 0 && narrowed(params, filters) ? <NoResultsState noun={t(spec.noun)} clearHref={base} /> : <SubmittalRegister items={result.items} />}
      <Pager base={base} params={params} result={result} />
    </div>
  );
}

export async function ProjectTransmittalRegister({ context, projectId, params }: { context: UserContext; projectId: string; params: Params }) {
  const t = await getTranslations("engineering");
  const query = transmittalListSchema.parse({ ...flat(params), projectId });
  const [result, contractors] = await Promise.all([orNotFound(listTransmittals(context, query)), contractorFilter(context, projectId, t)]);
  const base = `/projects/${projectId}/engineering/transmittals`;
  keepPageInRange(base, params, query.page, result);
  const filters: FilterConfig[] = [
    { param: "status", label: t("filters.status"), options: choose(t, "transmittalStatus", TRANSMITTAL_STATUSES, TRANSMITTAL_STATUS_LABELS) },
    { param: "direction", label: t("filters.direction"), options: choose(t, "direction", TRANSMITTAL_DIRECTIONS, TRANSMITTAL_DIRECTION_LABELS) },
    ...contractors,
  ];
  return (
    <div className="space-y-4">
      <Heading title={t("project.transmittals")} description={t("project.transmittalsBody")} action={can(context, "transmittal.create") ? <NewTransmittalButton projectId={projectId} /> : null} />
      <ListToolbar searchPlaceholder={t("filters.searchProjectTransmittal")} searchParam="q" filters={filters} />
      {result.items.length === 0 && narrowed(params, filters) ? <NoResultsState noun={t("nouns.transmittals")} clearHref={base} /> : <TransmittalRegister items={result.items} />}
      <Pager base={base} params={params} result={result} />
    </div>
  );
}
