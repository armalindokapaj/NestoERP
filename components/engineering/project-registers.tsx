import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { can } from "@/lib/access/can";
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

const choose = <T extends string>(values: readonly T[], labels: Record<string, string>) => values.map((value) => ({ value, label: labels[value] }));

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

async function contractorFilter(context: UserContext, projectId: string): Promise<FilterConfig[]> {
  const options = await projectEngineeringOptions(context, projectId, "rfi.respond").catch(() => null);
  return options?.contractors.length ? [{ param: "contractorId", label: "Contractor", options: options.contractors.map((item) => ({ value: item.id, label: item.label })) }] : [];
}

export async function ProjectDocumentRegister({ context, projectId, params, drawings }: { context: UserContext; projectId: string; params: Params; drawings: boolean }) {
  const query = engineeringDocumentListSchema.parse({ ...flat(params), projectId, drawings: drawings ? "1" : undefined });
  const [result, contractors] = await Promise.all([orNotFound(listEngineeringDocuments(context, query)), contractorFilter(context, projectId)]);
  const base = `/projects/${projectId}/engineering/${drawings ? "drawings" : "documents"}`;
  keepPageInRange(base, params, query.page, result);
  const filters: FilterConfig[] = [
    { param: "discipline", label: "Discipline", options: choose(DISCIPLINES, DISCIPLINE_LABELS) },
    { param: "status", label: "Status", options: choose(DOCUMENT_STATUSES, REVIEW_STATUS_LABELS) },
    ...(drawings ? [] : [{ param: "type", label: "Type", options: choose(DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS) }]),
    ...contractors,
  ];
  return (
    <div className="space-y-4">
      <Heading
        title={drawings ? "Drawing register" : "Engineering documents"}
        description={drawings ? "Drawings and shop drawings with their current revision and review." : "Specifications, calculations, reports and every other controlled technical document."}
        action={can(context, "engineering_document.create") ? <NewDocumentButton projectId={projectId} drawing={drawings} /> : null}
      />
      <ListToolbar searchPlaceholder={drawings ? "Search drawing number or title…" : "Search number or title…"} searchParam="q" filters={filters} />
      <DocumentRegister items={result.items} drawings={drawings} />
      <Pager base={base} params={params} result={result} />
    </div>
  );
}

export async function ProjectRfiRegister({ context, projectId, params }: { context: UserContext; projectId: string; params: Params }) {
  const query = rfiListSchema.parse({ ...flat(params), projectId });
  const [result, contractors] = await Promise.all([orNotFound(listRfis(context, query)), contractorFilter(context, projectId)]);
  const base = `/projects/${projectId}/engineering/rfis`;
  keepPageInRange(base, params, query.page, result);
  const filters: FilterConfig[] = [
    { param: "status", label: "Status", options: choose(RFI_STATUSES, RFI_STATUS_LABELS) },
    { param: "priority", label: "Priority", options: choose(RFI_PRIORITIES, RFI_PRIORITY_LABELS) },
    { param: "discipline", label: "Discipline", options: choose(DISCIPLINES, DISCIPLINE_LABELS) },
    { param: "assignee", label: "Assignee", options: [{ value: "me", label: "Assigned to me" }] },
    ...contractors,
  ];
  return (
    <div className="space-y-4">
      <Heading title="RFIs" description="Questions to the design team, their answers and how long they took." action={can(context, "rfi.create") ? <NewRfiButton projectId={projectId} /> : null} />
      <ListToolbar searchPlaceholder="Search RFI number or subject…" searchParam="q" filters={filters} />
      <RfiRegister items={result.items} />
      <Pager base={base} params={params} result={result} />
    </div>
  );
}

const VIEWS = {
  all: { title: "Submittals", description: "Technical review packages from contractors and the design team.", types: undefined, defaultType: "TECHNICAL_SUBMITTAL", path: "submittals", create: "New submittal" },
  method: { title: "Method statements", description: "How the work will be done — reviewed before it starts; HSE and QA/QC records link here.", types: "METHOD_STATEMENT", defaultType: "METHOD_STATEMENT", path: "method-statements", create: "New method statement" },
  material: { title: "Material submittals", description: "Products, samples and data for approval. Approval here buys and receives nothing.", types: "MATERIAL_SUBMITTAL,PRODUCT_DATA,SAMPLE", defaultType: "MATERIAL_SUBMITTAL", path: "material-submittals", create: "New material submittal" },
} as const;

export async function ProjectSubmittalRegister({ context, projectId, params, view }: { context: UserContext; projectId: string; params: Params; view: keyof typeof VIEWS }) {
  const spec = VIEWS[view];
  const query = submittalListSchema.parse({ ...flat(params), projectId, types: spec.types });
  const [result, contractors] = await Promise.all([orNotFound(listSubmittals(context, query)), contractorFilter(context, projectId)]);
  const base = `/projects/${projectId}/engineering/${spec.path}`;
  keepPageInRange(base, params, query.page, result);
  const filters: FilterConfig[] = [
    { param: "status", label: "Status", options: choose(SUBMITTAL_STATUSES, REVIEW_STATUS_LABELS) },
    ...(view === "all" ? [{ param: "type", label: "Type", options: choose(SUBMITTAL_TYPES, SUBMITTAL_TYPE_LABELS) }] : []),
    { param: "reviewer", label: "Reviewer", options: [{ value: "me", label: "Assigned to me" }] },
    ...contractors,
  ];
  return (
    <div className="space-y-4">
      <Heading title={spec.title} description={spec.description} action={can(context, "submittal.create") ? <NewSubmittalButton projectId={projectId} defaultType={spec.defaultType} label={spec.create} /> : null} />
      <ListToolbar searchPlaceholder="Search number, title or product…" searchParam="q" filters={filters} />
      <SubmittalRegister items={result.items} />
      <Pager base={base} params={params} result={result} />
    </div>
  );
}

export async function ProjectTransmittalRegister({ context, projectId, params }: { context: UserContext; projectId: string; params: Params }) {
  const query = transmittalListSchema.parse({ ...flat(params), projectId });
  const [result, contractors] = await Promise.all([orNotFound(listTransmittals(context, query)), contractorFilter(context, projectId)]);
  const base = `/projects/${projectId}/engineering/transmittals`;
  keepPageInRange(base, params, query.page, result);
  const filters: FilterConfig[] = [
    { param: "status", label: "Status", options: choose(TRANSMITTAL_STATUSES, TRANSMITTAL_STATUS_LABELS) },
    { param: "direction", label: "Direction", options: choose(TRANSMITTAL_DIRECTIONS, TRANSMITTAL_DIRECTION_LABELS) },
    ...contractors,
  ];
  return (
    <div className="space-y-4">
      <Heading title="Transmittals" description="Formal issues of documents, with the exact versions each one carried." action={can(context, "transmittal.create") ? <NewTransmittalButton projectId={projectId} /> : null} />
      <ListToolbar searchPlaceholder="Search number, recipient or document number…" searchParam="q" filters={filters} />
      <TransmittalRegister items={result.items} />
      <Pager base={base} params={params} result={result} />
    </div>
  );
}
