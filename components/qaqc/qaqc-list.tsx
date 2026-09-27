import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { listPageRedirect, pageHref, type paginationMeta } from "@/lib/modules/shared/list-query";
import { clearListFilters } from "@/lib/tables/list-url";
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
 *
 * AUD-08 (§3–§5): each list is one parsed query — section (`view`), filters,
 * search, sort, page and page size — handed to the service that also feeds the
 * count and the CSV export. A page that is the register with one value fixed
 * (Work and Materials fix the inspection type, Reinspections fixes the view)
 * passes it as `fixed`: it is part of the query, its control is not offered,
 * and page links, Clear and the out-of-range redirect stay on that page
 * (`basePath`) instead of jumping to /qaqc/inspections.
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

/** Sizes the list schemas accept (`paginationSchema`: at most 100). */
const PAGE_SIZES = [25, 50, 100] as const;

/** Filter keys read from the URL that have no toolbar control (a person, a parent NCR). */
const EXTRA_FILTER_KEYS = ["assignedToMemberId", "assignedInspectorMemberId", "ncrId"] as const;

type ProjectOption = { id: string; code: string; name: string };

/**
 * The projects a list can be narrowed to — only projects in the reader's
 * QA/QC scope that hold a record of this kind (PRD #21 §202). Showing the
 * filter means a list opened from a project tab's "View all" says so, and
 * Clear can undo it (AUD-08 §3).
 */
const PROJECT_OPTIONS: Partial<Record<QaqcListKind, (context: UserContext) => Promise<{ projects: ProjectOption[] }>>> = {
  requests: requests.requestFilterOptions,
  inspections: inspections.inspectionFilterOptions,
  defects: defects.defectFilterOptions,
  ncrs: ncrs.ncrFilterOptions,
};

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
  searchParams: urlParams,
  basePath = `/qaqc/${kind}`,
  fixed = {},
}: {
  context: UserContext;
  kind: QaqcListKind;
  searchParams: SearchParams;
  /** The page this list is on; page links, Clear and redirects stay here. */
  basePath?: string;
  /** Query values the page fixes (a section, an inspection type): applied, never offered. */
  fixed?: Record<string, string>;
}) {
  // The fixed values win over anything in the URL, and are part of the query.
  const searchParams: SearchParams = { ...urlParams, ...fixed };
  const shared = {
    search: read(searchParams, "search"),
    view: read(searchParams, "view"),
    sort: read(searchParams, "sort"),
    page: read(searchParams, "page"),
    limit: read(searchParams, "limit"),
    projectId: read(searchParams, "projectId"),
  };
  const listId = `qaqc.${kind}`;
  const sortKeys = SORT_OPTIONS[kind].map((option) => option.value);
  const sortConfig = (value: string) => ({ value, keys: sortKeys });
  const projectOptions = PROJECT_OPTIONS[kind]?.(context);

  const filters: FilterConfig[] = [
    { param: "view", label: "View", options: VIEW_OPTIONS[kind] },
  ];

  let rendered: React.ReactNode;
  let pagination: ReturnType<typeof paginationMeta>;
  let empty = false;
  // The page and sort the parser read, for the redirect and the header controls.
  let requestedPage = 1;
  let appliedSortValue: string;

  if (kind === "requests") {
    const query = requestListQuerySchema.parse({
      ...shared,
      status: multi(searchParams, "status", REQUEST_STATUSES),
      inspectionType: multi(searchParams, "type", INSPECTION_TYPES),
      priority: multi(searchParams, "priority", PRIORITIES),
    });
    const result = await requests.listRequests(context, query);
    requestedPage = query.page;
    appliedSortValue = query.sort;
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
    rendered = <RequestTable requests={result.data} listId={listId} sort={sortConfig(query.sort)} />;
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
    requestedPage = query.page;
    appliedSortValue = query.sort;
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
    rendered = <InspectionTable inspections={result.data} listId={listId} sort={sortConfig(query.sort)} />;
    pagination = result.pagination;
    empty = result.data.length === 0;
  } else if (kind === "defects") {
    const query = defectListQuerySchema.parse({
      ...shared,
      status: multi(searchParams, "status", DEFECT_STATUSES),
      severity: multi(searchParams, "severity", SEVERITIES),
    });
    const result = await defects.listDefects(context, query);
    requestedPage = query.page;
    appliedSortValue = query.sort;
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
    rendered = <DefectTable defects={result.data} listId={listId} sort={sortConfig(query.sort)} />;
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
    requestedPage = query.page;
    appliedSortValue = query.sort;
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
    rendered = <NcrTable ncrs={result.data} listId={listId} sort={sortConfig(query.sort)} />;
    pagination = result.pagination;
    empty = result.data.length === 0;
  } else {
    const query = correctiveActionListQuerySchema.parse({
      ...shared,
      status: multi(searchParams, "status", CORRECTIVE_ACTION_STATUSES),
      ncrId: read(searchParams, "ncrId"),
    });
    const result = await actions.listActions(context, query);
    requestedPage = query.page;
    appliedSortValue = query.sort;
    filters.push({
      param: "status",
      label: "Status",
      options: CORRECTIVE_ACTION_STATUSES.map((value) => ({
        value,
        label: correctiveActionStatusLabels[value],
      })),
    });
    rendered = <CorrectiveActionTable actions={result.data} listId={listId} sort={sortConfig(query.sort)} />;
    pagination = result.pagination;
    empty = result.data.length === 0;
  }

  const projectList = projectOptions ? (await projectOptions).projects : null;
  if (projectList) {
    filters.push({
      param: "projectId",
      label: "Project",
      options: projectList.map((project) => ({ value: project.id, label: `${project.code} — ${project.name}` })),
    });
  }
  // Without a Project control a URL `projectId` still narrows the list, so Clear must remove it.
  const extraFilterKeys: string[] = [...EXTRA_FILTER_KEYS, ...(projectList ? [] : ["projectId"])];

  // A value the page fixes is not a control the reader can change or clear.
  const toolbarFilters = filters.filter((filter) => !(filter.param in fixed));

  // A page past the end — after a close or a narrower filter — moves once to
  // the last real page, page 1 when nothing matches (AUD-08 §4, DT-05).
  if (pagination.page !== requestedPage) {
    redirect(listPageRedirect(basePath, urlParams, pagination.page));
  }

  // Every key this list filters by, except the fixed ones: a narrowed list
  // that matches nothing says so, never the first-run copy (AUD-08 §8).
  const filterKeys = ["search", ...toolbarFilters.map((filter) => filter.param), ...extraFilterKeys];
  const hasFilters = filterKeys.some((key) => {
    const value = read(urlParams, key);
    return Boolean(value && !(key === "view" && value === "all"));
  });
  // Clear drops this list's search and filters, keeps sort and page size (AUD-08 §3).
  const cleared = clearListFilters(pageHref("", urlParams, 1).replace(/^\?/, ""), filterKeys);

  const buildHref = (page: number) => pageHref(basePath, urlParams, page);

  const create = CREATE[kind];
  const copy = EMPTY_COPY[kind];

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search by number or title…"
        filters={toolbarFilters}
        sortOptions={SORT_OPTIONS[kind]}
        extraFilterParams={extraFilterKeys}
        applied={{ sort: appliedSortValue }}
      />

      {empty ? (
        hasFilters ? (
          <EmptyState
            icon={<ClipboardCheck />}
            title="Nothing matches these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: cleared ? `${basePath}?${cleared}` : basePath }}
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
          <Pagination meta={pagination} buildHref={buildHref} pageSizes={PAGE_SIZES} listId={listId} />
        </>
      )}
    </div>
  );
}

export { CREATE as QAQC_CREATE };
