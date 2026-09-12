import { ClipboardCheck } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import type { paginationMeta } from "@/lib/modules/shared/list-query";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import * as actions from "@/lib/modules/qaqc/corrective-actions/action.service";
import * as defects from "@/lib/modules/qaqc/defects/defect.service";
import * as inspections from "@/lib/modules/qaqc/inspections/inspection.service";
import * as ncrs from "@/lib/modules/qaqc/ncrs/ncr.service";
import * as requests from "@/lib/modules/qaqc/requests/request.service";
import {
  correctiveActionListQuerySchema,
  defectListQuerySchema,
  inspectionListQuerySchema,
  ncrListQuerySchema,
  requestListQuerySchema,
} from "@/lib/modules/qaqc/qaqc.schema";
import {
  CORRECTIVE_ACTION_STATUSES,
  DEFECT_STATUSES,
  INSPECTION_RESULTS,
  INSPECTION_STATUSES,
  INSPECTION_TYPES,
  NCR_CATEGORIES,
  NCR_STATUSES,
  PRIORITIES,
  REQUEST_STATUSES,
  SEVERITIES,
  correctiveActionStatusLabels,
  defectStatusLabels,
  inspectionResultLabels,
  inspectionStatusLabels,
  inspectionTypeLabels,
  ncrCategoryLabels,
  ncrStatusLabels,
  priorityLabels,
  requestStatusLabels,
  severityLabels,
} from "@/lib/modules/qaqc/qaqc.status";
import {
  CorrectiveActionTable,
  DefectTable,
  InspectionTable,
  NcrTable,
  RequestTable,
} from "./qaqc-tables";

/**
 * The QA/QC lists, from one place (PRD #21 §39, §63, §115, §127, §143).
 *
 * Search, filters and sort all write to the URL, so refresh, back/forward and a
 * shared link reproduce the same list (PRD #7 §17). The filter options name
 * only statuses and categories, never records — a dropdown must not become a
 * directory of quality failures the reader cannot open (PRD #21 §202).
 */

export type QaqcListKind =
  | "requests"
  | "inspections"
  | "defects"
  | "ncrs"
  | "corrective-actions";

type SearchParams = Record<string, string | string[] | undefined>;

const EMPTY_COPY: Record<QaqcListKind, { title: string; description: string }> = {
  requests: {
    title: "No inspection requests.",
    description:
      "A request is somebody asking for an inspection. Quality picks it up and carries it out.",
  },
  inspections: {
    title: "No inspections yet.",
    description:
      "An inspection is the act of looking, with a verdict. It can be raised from a request or started directly.",
  },
  defects: {
    title: "No defects.",
    description:
      "A defect is a fault on a job that somebody must fix. If it also needs a root cause, escalate it to an NCR.",
  },
  ncrs: {
    title: "No non-conformances.",
    description:
      "An NCR is a formal statement that a requirement was not met. It closes only once the cause is understood and the fix verified.",
  },
  "corrective-actions": {
    title: "No corrective actions.",
    description:
      "A corrective action is what somebody actually does about a non-conformance — and the reason an NCR can close.",
  },
};

const VIEW_OPTIONS: Record<QaqcListKind, { value: string; label: string }[]> = {
  requests: [
    { value: "all", label: "All requests" },
    { value: "open", label: "Still open" },
    { value: "unassigned", label: "Unassigned" },
    { value: "mine", label: "Mine" },
  ],
  inspections: [
    { value: "all", label: "All inspections" },
    { value: "open", label: "Still open" },
    { value: "awaiting-approval", label: "Awaiting approval" },
    { value: "reinspections", label: "Reinspections" },
    { value: "mine", label: "Mine" },
  ],
  defects: [
    { value: "all", label: "All defects" },
    { value: "open", label: "Still open" },
    { value: "overdue", label: "Overdue" },
    { value: "mine", label: "Mine" },
  ],
  ncrs: [
    { value: "all", label: "All NCRs" },
    { value: "open", label: "Still open" },
    { value: "overdue", label: "Overdue" },
    { value: "awaiting-approval", label: "Awaiting approval" },
    { value: "mine", label: "Mine" },
  ],
  "corrective-actions": [
    { value: "all", label: "All actions" },
    { value: "open", label: "Still open" },
    { value: "awaiting-verification", label: "Awaiting verification" },
    { value: "overdue", label: "Overdue" },
    { value: "mine", label: "Mine" },
  ],
};

const SORT_OPTIONS: Record<QaqcListKind, { value: string; label: string }[]> = {
  requests: [
    { value: "created-desc", label: "Newest first" },
    { value: "required-asc", label: "Needed soonest" },
    { value: "priority-desc", label: "Most urgent" },
    { value: "number-asc", label: "By number" },
  ],
  inspections: [
    { value: "created-desc", label: "Newest first" },
    { value: "date-desc", label: "Inspected most recently" },
    { value: "date-asc", label: "Inspected longest ago" },
    { value: "number-asc", label: "By number" },
  ],
  defects: [
    { value: "created-desc", label: "Newest first" },
    { value: "due-asc", label: "Due soonest" },
    { value: "severity-desc", label: "Most severe" },
    { value: "number-asc", label: "By number" },
  ],
  ncrs: [
    { value: "created-desc", label: "Newest first" },
    { value: "due-asc", label: "Due soonest" },
    { value: "severity-desc", label: "Most severe" },
    { value: "number-asc", label: "By number" },
  ],
  "corrective-actions": [
    { value: "created-desc", label: "Newest first" },
    { value: "due-asc", label: "Due soonest" },
    { value: "number-asc", label: "By number" },
  ],
};

const CREATE = {
  requests: { permission: "qaqc.request.create", label: "Request an inspection" },
  inspections: { permission: "qaqc.inspection.create", label: "New inspection" },
  defects: { permission: "qaqc.defect.create", label: "New defect" },
  ncrs: { permission: "qaqc.ncr.create", label: "New NCR" },
  "corrective-actions": {
    permission: "qaqc.corrective_action.create",
    label: "New corrective action",
  },
} as const;

function read(params: SearchParams, key: string): string | undefined {
  return typeof params[key] === "string" ? (params[key] as string) : undefined;
}

function multi(params: SearchParams, key: string, allowed: readonly string[]) {
  const values = read(params, key)?.split(",").filter((value) => allowed.includes(value));
  return values?.length ? values : undefined;
}

export async function QaqcListSection({
  context,
  kind,
  searchParams,
}: {
  context: UserContext;
  kind: QaqcListKind;
  searchParams: SearchParams;
}) {
  const shared = {
    search: read(searchParams, "search"),
    view: read(searchParams, "view"),
    sort: read(searchParams, "sort"),
    page: read(searchParams, "page"),
    projectId: read(searchParams, "projectId"),
  };

  const filters: FilterConfig[] = [
    { param: "view", label: "View", options: VIEW_OPTIONS[kind] },
  ];

  let rendered: React.ReactNode;
  let pagination: ReturnType<typeof paginationMeta>;
  let empty = false;

  if (kind === "requests") {
    const query = requestListQuerySchema.parse({
      ...shared,
      status: multi(searchParams, "status", REQUEST_STATUSES),
      inspectionType: multi(searchParams, "type", INSPECTION_TYPES),
      priority: multi(searchParams, "priority", PRIORITIES),
    });
    const result = await requests.listRequests(context, query);
    filters.push(
      {
        param: "status",
        label: "Status",
        options: REQUEST_STATUSES.map((value) => ({ value, label: requestStatusLabels[value] })),
      },
      {
        param: "type",
        label: "Type",
        options: INSPECTION_TYPES.map((value) => ({ value, label: inspectionTypeLabels[value] })),
      },
      {
        param: "priority",
        label: "Priority",
        options: PRIORITIES.map((value) => ({ value, label: priorityLabels[value] })),
      },
    );
    rendered = <RequestTable requests={result.data} />;
    pagination = result.pagination;
    empty = result.data.length === 0;
  } else if (kind === "inspections") {
    const query = inspectionListQuerySchema.parse({
      ...shared,
      status: multi(searchParams, "status", INSPECTION_STATUSES),
      result: multi(searchParams, "result", INSPECTION_RESULTS),
      inspectionType: multi(searchParams, "type", INSPECTION_TYPES),
    });
    const result = await inspections.listInspections(context, query);
    filters.push(
      {
        param: "status",
        label: "Status",
        options: INSPECTION_STATUSES.map((value) => ({
          value,
          label: inspectionStatusLabels[value],
        })),
      },
      {
        // Separate from status on purpose: they answer different questions.
        param: "result",
        label: "Result",
        options: INSPECTION_RESULTS.map((value) => ({
          value,
          label: inspectionResultLabels[value],
        })),
      },
      {
        param: "type",
        label: "Type",
        options: INSPECTION_TYPES.map((value) => ({ value, label: inspectionTypeLabels[value] })),
      },
    );
    rendered = <InspectionTable inspections={result.data} />;
    pagination = result.pagination;
    empty = result.data.length === 0;
  } else if (kind === "defects") {
    const query = defectListQuerySchema.parse({
      ...shared,
      status: multi(searchParams, "status", DEFECT_STATUSES),
      severity: multi(searchParams, "severity", SEVERITIES),
    });
    const result = await defects.listDefects(context, query);
    filters.push(
      {
        param: "status",
        label: "Status",
        options: DEFECT_STATUSES.map((value) => ({ value, label: defectStatusLabels[value] })),
      },
      {
        param: "severity",
        label: "Severity",
        options: SEVERITIES.map((value) => ({ value, label: severityLabels[value] })),
      },
    );
    rendered = <DefectTable defects={result.data} />;
    pagination = result.pagination;
    empty = result.data.length === 0;
  } else if (kind === "ncrs") {
    const query = ncrListQuerySchema.parse({
      ...shared,
      status: multi(searchParams, "status", NCR_STATUSES),
      severity: multi(searchParams, "severity", SEVERITIES),
      category: multi(searchParams, "category", NCR_CATEGORIES),
    });
    const result = await ncrs.listNcrs(context, query);
    filters.push(
      {
        param: "status",
        label: "Status",
        options: NCR_STATUSES.map((value) => ({ value, label: ncrStatusLabels[value] })),
      },
      {
        param: "category",
        label: "Category",
        options: NCR_CATEGORIES.map((value) => ({ value, label: ncrCategoryLabels[value] })),
      },
      {
        param: "severity",
        label: "Severity",
        options: SEVERITIES.map((value) => ({ value, label: severityLabels[value] })),
      },
    );
    rendered = <NcrTable ncrs={result.data} />;
    pagination = result.pagination;
    empty = result.data.length === 0;
  } else {
    const query = correctiveActionListQuerySchema.parse({
      ...shared,
      status: multi(searchParams, "status", CORRECTIVE_ACTION_STATUSES),
      ncrId: read(searchParams, "ncrId"),
    });
    const result = await actions.listActions(context, query);
    filters.push({
      param: "status",
      label: "Status",
      options: CORRECTIVE_ACTION_STATUSES.map((value) => ({
        value,
        label: correctiveActionStatusLabels[value],
      })),
    });
    rendered = <CorrectiveActionTable actions={result.data} />;
    pagination = result.pagination;
    empty = result.data.length === 0;
  }

  const hasFilters = Boolean(
    shared.search ||
      (shared.view && shared.view !== "all") ||
      read(searchParams, "status") ||
      read(searchParams, "severity") ||
      read(searchParams, "category") ||
      read(searchParams, "result") ||
      read(searchParams, "type") ||
      read(searchParams, "priority"),
  );

  function buildHref(page: number) {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && key !== "page") next.set(key, value);
    }
    if (page > 1) next.set("page", String(page));
    const query = next.toString();
    return query ? `/qaqc/${kind}?${query}` : `/qaqc/${kind}`;
  }

  const create = CREATE[kind];
  const copy = EMPTY_COPY[kind];

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search by number or title…"
        filters={filters}
        sortOptions={SORT_OPTIONS[kind]}
      />

      {empty ? (
        hasFilters ? (
          <EmptyState
            icon={<ClipboardCheck />}
            title="Nothing matches these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: `/qaqc/${kind}` }}
          />
        ) : (
          <EmptyState
            icon={<ClipboardCheck />}
            title={copy.title}
            description={copy.description}
            action={
              can(context, create.permission)
                ? { label: create.label, href: `/qaqc/${kind}/new` }
                : undefined
            }
          />
        )
      ) : (
        <>
          {rendered}
          <Pagination meta={pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}

export { CREATE as QAQC_CREATE };
