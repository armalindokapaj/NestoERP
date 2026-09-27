import { redirect } from "next/navigation";
import { HardHat } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { listPageRedirect, pageHref, type paginationMeta } from "@/lib/modules/shared/list-query";
import { clearListFilters } from "@/lib/tables/list-url";
import * as actionService from "@/lib/modules/hse/actions/action.service";
import * as environment from "@/lib/modules/hse/environment/environment.service";
import * as hazards from "@/lib/modules/hse/hazards/hazard.service";
import * as incidents from "@/lib/modules/hse/incidents/incident.service";
import * as inspections from "@/lib/modules/hse/inspections/inspection.service";
import * as permits from "@/lib/modules/hse/permits/permit.service";
import * as ppe from "@/lib/modules/hse/ppe/ppe.service";
import * as risk from "@/lib/modules/hse/risk-assessments/risk.service";
import * as stopWork from "@/lib/modules/hse/stop-work/stop-work.service";
import * as templates from "@/lib/modules/hse/templates/template.service";
import * as toolbox from "@/lib/modules/hse/toolbox/toolbox.service";
import {
  actionListSchema,
  hazardListSchema,
  incidentListSchema,
  inspectionListSchema,
  observationListSchema,
  permitListSchema,
  ppeListSchema,
  riskAssessmentListSchema,
  stopWorkListSchema,
  templateListSchema,
  toolboxListSchema,
} from "@/lib/modules/hse/hse.schema";
import { RISK_LEVELS, riskLevelLabels } from "@/lib/modules/hse/hse.risk";
import {
  ACTION_STATUSES,
  ACTION_TYPES,
  ENVIRONMENTAL_CATEGORIES,
  ENVIRONMENTAL_STATUSES,
  HAZARD_CATEGORIES,
  HAZARD_STATUSES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  INSPECTION_RESULTS,
  INSPECTION_STATUSES,
  INSPECTION_TYPES,
  PERMIT_STATUSES,
  PERMIT_TYPES,
  PPE_RESULTS,
  PRIORITIES,
  RISK_ASSESSMENT_STATUSES,
  SEVERITIES,
  STOP_WORK_STATUSES,
  TEMPLATE_STATUSES,
  TOOLBOX_STATUSES,
  actionStatusLabels,
  actionTypeLabels,
  environmentalCategoryLabels,
  environmentalStatusLabels,
  hazardCategoryLabels,
  hazardStatusLabels,
  incidentStatusLabels,
  incidentTypeLabels,
  inspectionResultLabels,
  inspectionStatusLabels,
  inspectionTypeLabels,
  permitStatusLabels,
  permitTypeLabels,
  ppeResultLabels,
  priorityLabels,
  riskAssessmentStatusLabels,
  severityLabels,
  stopWorkStatusLabels,
  templateStatusLabels,
  toolboxStatusLabels,
} from "@/lib/modules/hse/hse.status";
import {
  ActionTable,
  HazardTable,
  IncidentTable,
  InspectionTable,
  ObservationTable,
  PermitTable,
  PpeTable,
  RiskAssessmentTable,
  StopWorkTable,
  TemplateTable,
  ToolboxTable,
} from "./hse-tables";

/**
 * The HSE lists, from one place (PRD #22 §290–§310).
 *
 * Search, filters and sort all write to the URL, so refresh, back/forward and a
 * shared link reproduce the same list (PRD #7 §17). The filter options name
 * only statuses and categories, never records — a dropdown must not become a
 * directory of incidents the reader cannot open (PRD #22 §309, §311).
 *
 * AUD-08 (§3–§5): each list is one parsed query — section (`view`), filters,
 * search, sort, page and page size — handed to the service that also feeds the
 * count and the CSV export. A page past the end moves once to the last real
 * page; page links keep every other key; the table names its list
 * (`hse.<kind>`) for column preferences and offers header sorts only for the
 * allowlisted sort values below.
 */

export type HseListKind =
  | "inspections"
  | "templates"
  | "hazards"
  | "incidents"
  | "risk-assessments"
  | "actions"
  | "toolbox-talks"
  | "permits"
  | "ppe"
  | "environment"
  | "stop-work";

type SearchParams = Record<string, string | string[] | undefined>;

const EMPTY_COPY: Record<HseListKind, { title: string; description: string }> = {
  inspections: {
    title: "No safety inspections yet.",
    description:
      "An inspection is a walk-round against a checklist, with a verdict somebody signs off.",
  },
  templates: {
    title: "No safety checklists.",
    description:
      "A checklist is what the company inspects against. Once a version has been used it is versioned rather than rewritten.",
  },
  hazards: {
    title: "No hazards reported.",
    description:
      "A hazard is a condition that could hurt somebody. Anyone on site can report one; the risk score decides how fast it is dealt with.",
  },
  incidents: {
    title: "No incidents or near misses.",
    description:
      "An incident is something that happened. A near miss is the same record — and the one worth reporting before it becomes the other.",
  },
  "risk-assessments": {
    title: "No risk assessments.",
    description:
      "A risk assessment evaluates an activity line by line. Once approved it is frozen, and a material change makes a new version.",
  },
  actions: {
    title: "No HSE actions.",
    description:
      "An action is the safety obligation that came out of a hazard, an incident or an inspection — and somebody else verifies it was done.",
  },
  "toolbox-talks": {
    title: "No toolbox talks.",
    description: "A toolbox talk is a short briefing, and the record of who was there.",
  },
  permits: {
    title: "No work permits.",
    description:
      "A permit authorises controlled work for a fixed window. Outside that window it authorises nothing.",
  },
  ppe: {
    title: "No PPE checks.",
    description:
      "A PPE check records whether the protective equipment was there and being worn. It never touches Inventory.",
  },
  environment: {
    title: "No environmental observations.",
    description: "A spill, dust, noise or waste going astray — recorded, assigned and closed out.",
  },
  "stop-work": {
    title: "No stop-work records.",
    description:
      "A stop-work halts a job because it was not safe to carry on. Releasing it is a separate act.",
  },
};

const VIEW_OPTIONS: Partial<Record<HseListKind, { value: string; label: string }[]>> = {
  inspections: [
    { value: "all", label: "All inspections" },
    { value: "due", label: "Still to do" },
    { value: "failed", label: "Failed or conditional" },
    { value: "mine", label: "Mine" },
  ],
  hazards: [
    { value: "all", label: "All hazards" },
    { value: "open", label: "Still open" },
    { value: "critical", label: "Critical" },
    { value: "overdue", label: "Overdue" },
    { value: "mine", label: "Mine" },
  ],
  incidents: [
    { value: "all", label: "All incidents" },
    { value: "open", label: "Still open" },
    { value: "near-miss", label: "Near misses" },
    { value: "serious", label: "High and critical" },
    { value: "mine", label: "Mine" },
  ],
  "risk-assessments": [
    { value: "all", label: "All assessments" },
    { value: "approved", label: "Approved" },
    { value: "review-due", label: "Due for review" },
    { value: "mine", label: "Mine" },
  ],
  actions: [
    { value: "all", label: "All actions" },
    { value: "open", label: "Still open" },
    { value: "verification", label: "Awaiting verification" },
    { value: "overdue", label: "Overdue" },
    { value: "mine", label: "Mine" },
  ],
  permits: [
    { value: "all", label: "All permits" },
    { value: "active", label: "Active now" },
    { value: "expiring", label: "Expiring this week" },
    { value: "pending", label: "Awaiting approval" },
    { value: "mine", label: "Mine" },
  ],
  environment: [
    { value: "all", label: "All observations" },
    { value: "open", label: "Still open" },
    { value: "mine", label: "Mine" },
  ],
};

const SORT_OPTIONS: Record<HseListKind, { value: string; label: string }[]> = {
  inspections: [
    { value: "recent", label: "Recently updated" },
    { value: "scheduled-asc", label: "Scheduled soonest" },
    { value: "number-asc", label: "By number" },
  ],
  templates: [
    { value: "recent", label: "Recently updated" },
    { value: "code-asc", label: "By code" },
    { value: "name-asc", label: "By name" },
  ],
  hazards: [
    { value: "recent", label: "Recently updated" },
    { value: "risk-desc", label: "Highest risk first" },
    { value: "due-asc", label: "Due soonest" },
    { value: "number-asc", label: "By number" },
  ],
  incidents: [
    { value: "recent", label: "Recently updated" },
    { value: "occurred-desc", label: "Most recent first" },
    { value: "severity-desc", label: "Most severe" },
    { value: "number-asc", label: "By number" },
  ],
  "risk-assessments": [
    { value: "recent", label: "Recently updated" },
    { value: "review-asc", label: "Review due soonest" },
    { value: "number-asc", label: "By number" },
  ],
  actions: [
    { value: "recent", label: "Recently updated" },
    { value: "due-asc", label: "Due soonest" },
    { value: "priority-desc", label: "Most urgent" },
    { value: "number-asc", label: "By number" },
  ],
  "toolbox-talks": [
    { value: "recent", label: "Recently updated" },
    { value: "date-desc", label: "Most recent first" },
    { value: "number-asc", label: "By number" },
  ],
  permits: [
    { value: "recent", label: "Recently updated" },
    { value: "expiry-asc", label: "Expiring soonest" },
    { value: "number-asc", label: "By number" },
  ],
  ppe: [
    { value: "recent", label: "Most recent first" },
    { value: "number-asc", label: "By number" },
  ],
  environment: [
    { value: "recent", label: "Recently updated" },
    { value: "observed-desc", label: "Most recent first" },
    { value: "number-asc", label: "By number" },
  ],
  "stop-work": [
    { value: "recent", label: "Active first" },
    { value: "issued-desc", label: "Most recent first" },
    { value: "number-asc", label: "By number" },
  ],
};

export const HSE_CREATE = {
  inspections: { permission: "hse.inspection.create", label: "New inspection" },
  templates: { permission: "hse.template.create", label: "New checklist" },
  hazards: { permission: "hse.hazard.create", label: "Report a hazard" },
  incidents: { permission: "hse.incident.create", label: "Report an incident" },
  "risk-assessments": { permission: "hse.risk.create", label: "New risk assessment" },
  actions: { permission: "hse.action.create", label: "New action" },
  "toolbox-talks": { permission: "hse.toolbox.create", label: "Record a toolbox talk" },
  permits: { permission: "hse.permit.create", label: "New permit" },
  ppe: { permission: "hse.ppe.create", label: "New PPE check" },
  environment: { permission: "hse.environment.create", label: "Report an observation" },
  "stop-work": { permission: "hse.stop_work.create", label: "Stop work" },
} as const;

/** Sizes the list schemas accept (`paginationSchema`: at most 100). */
const PAGE_SIZES = [25, 50, 100] as const;

/** Filter keys read from the URL that have no toolbar control (a person). */
const EXTRA_FILTER_KEYS = ["assignedToMemberId", "assignedInspectorMemberId"] as const;

type ProjectOption = { id: string; code: string; name: string };

/**
 * The projects a list can be narrowed to — only projects in the reader's HSE
 * scope that hold a record of this kind (PRD #22 §309). The filter was already
 * parsed from the URL; showing it means a list opened from a project tab's
 * "View all" says it is narrowed, and Clear can undo it (AUD-08 §3).
 */
const PROJECT_OPTIONS: Partial<Record<HseListKind, (context: UserContext) => Promise<{ projects: ProjectOption[] }>>> = {
  inspections: inspections.inspectionFilterOptions,
  hazards: hazards.hazardFilterOptions,
  incidents: incidents.incidentFilterOptions,
  "risk-assessments": risk.riskFilterOptions,
  actions: actionService.actionFilterOptions,
  "toolbox-talks": toolbox.toolboxFilterOptions,
  permits: permits.permitFilterOptions,
  ppe: ppe.ppeFilterOptions,
  environment: environment.observationFilterOptions,
};

function read(params: SearchParams, key: string): string | undefined {
  return typeof params[key] === "string" ? (params[key] as string) : undefined;
}

function multi(params: SearchParams, key: string, allowed: readonly string[]) {
  const values = read(params, key)
    ?.split(",")
    .filter((value) => allowed.includes(value));
  return values?.length ? values : undefined;
}

function options<T extends string>(values: readonly T[], labels: Record<T, string>) {
  return values.map((value) => ({ value, label: labels[value] }));
}

export async function HseListSection({
  context,
  kind,
  searchParams,
}: {
  context: UserContext;
  kind: HseListKind;
  searchParams: SearchParams;
}) {
  const shared = {
    search: read(searchParams, "search"),
    view: read(searchParams, "view"),
    sort: read(searchParams, "sort"),
    page: read(searchParams, "page"),
    limit: read(searchParams, "limit"),
    projectId: read(searchParams, "projectId"),
  };
  const listId = `hse.${kind}`;
  const sortKeys = SORT_OPTIONS[kind].map((option) => option.value);

  const filters: FilterConfig[] = [];
  const views = VIEW_OPTIONS[kind];
  if (views) filters.push({ param: "view", label: "View", options: views });
  const projectOptions = PROJECT_OPTIONS[kind]?.(context);

  let rendered: React.ReactNode;
  let pagination: ReturnType<typeof paginationMeta>;
  // The page the parser read, before the service clamps it to the last page.
  let requestedPage = 1;
  // The sort the server applied to the rows on screen, for the header controls.
  let appliedSortValue: string;

  switch (kind) {
    case "inspections": {
      const query = inspectionListSchema.parse({
        ...shared,
        status: multi(searchParams, "status", INSPECTION_STATUSES),
        result: multi(searchParams, "result", INSPECTION_RESULTS),
        inspectionType: multi(searchParams, "inspectionType", INSPECTION_TYPES),
        assignedInspectorMemberId: read(searchParams, "assignedInspectorMemberId"),
      });
      const result = await inspections.listInspections(context, query);
      requestedPage = query.page;
      appliedSortValue = query.sort;
      filters.push(
        { param: "status", label: "Status", options: options(INSPECTION_STATUSES, inspectionStatusLabels) },
        { param: "result", label: "Result", options: options(INSPECTION_RESULTS, inspectionResultLabels) },
        { param: "inspectionType", label: "Type", options: options(INSPECTION_TYPES, inspectionTypeLabels) },
      );
      rendered = <InspectionTable inspections={result.data} listId={listId} sort={{ value: query.sort, keys: sortKeys }} />;
      pagination = result.pagination;
      break;
    }

    case "templates": {
      const query = templateListSchema.parse({
        ...shared,
        status: multi(searchParams, "status", TEMPLATE_STATUSES),
        inspectionType: multi(searchParams, "inspectionType", INSPECTION_TYPES),
      });
      const result = await templates.listTemplates(context, query);
      requestedPage = query.page;
      appliedSortValue = query.sort;
      filters.push(
        { param: "status", label: "Status", options: options(TEMPLATE_STATUSES, templateStatusLabels) },
        { param: "inspectionType", label: "Type", options: options(INSPECTION_TYPES, inspectionTypeLabels) },
      );
      rendered = <TemplateTable templates={result.data} listId={listId} sort={{ value: query.sort, keys: sortKeys }} />;
      pagination = result.pagination;
      break;
    }

    case "hazards": {
      const query = hazardListSchema.parse({
        ...shared,
        status: multi(searchParams, "status", HAZARD_STATUSES),
        riskLevel: multi(searchParams, "riskLevel", RISK_LEVELS),
        hazardCategory: multi(searchParams, "hazardCategory", HAZARD_CATEGORIES),
        assignedToMemberId: read(searchParams, "assignedToMemberId"),
      });
      const result = await hazards.listHazards(context, query);
      requestedPage = query.page;
      appliedSortValue = query.sort;
      filters.push(
        { param: "status", label: "Status", options: options(HAZARD_STATUSES, hazardStatusLabels) },
        { param: "riskLevel", label: "Risk", options: options(RISK_LEVELS, riskLevelLabels) },
        { param: "hazardCategory", label: "Category", options: options(HAZARD_CATEGORIES, hazardCategoryLabels) },
      );
      rendered = <HazardTable hazards={result.data} listId={listId} sort={{ value: query.sort, keys: sortKeys }} />;
      pagination = result.pagination;
      break;
    }

    case "incidents": {
      const query = incidentListSchema.parse({
        ...shared,
        status: multi(searchParams, "status", INCIDENT_STATUSES),
        incidentType: multi(searchParams, "incidentType", INCIDENT_TYPES),
        severity: multi(searchParams, "severity", SEVERITIES),
      });
      const result = await incidents.listIncidents(context, query);
      requestedPage = query.page;
      appliedSortValue = query.sort;
      filters.push(
        { param: "status", label: "Status", options: options(INCIDENT_STATUSES, incidentStatusLabels) },
        { param: "incidentType", label: "Type", options: options(INCIDENT_TYPES, incidentTypeLabels) },
        { param: "severity", label: "Severity", options: options(SEVERITIES, severityLabels) },
      );
      rendered = <IncidentTable incidents={result.data} listId={listId} sort={{ value: query.sort, keys: sortKeys }} />;
      pagination = result.pagination;
      break;
    }

    case "risk-assessments": {
      const query = riskAssessmentListSchema.parse({
        ...shared,
        status: multi(searchParams, "status", RISK_ASSESSMENT_STATUSES),
      });
      const result = await risk.listRiskAssessments(context, query);
      requestedPage = query.page;
      appliedSortValue = query.sort;
      filters.push({
        param: "status",
        label: "Status",
        options: options(RISK_ASSESSMENT_STATUSES, riskAssessmentStatusLabels),
      });
      rendered = <RiskAssessmentTable assessments={result.data} listId={listId} sort={{ value: query.sort, keys: sortKeys }} />;
      pagination = result.pagination;
      break;
    }

    case "actions": {
      const query = actionListSchema.parse({
        ...shared,
        status: multi(searchParams, "status", ACTION_STATUSES),
        actionType: multi(searchParams, "actionType", ACTION_TYPES),
        priority: multi(searchParams, "priority", PRIORITIES),
        assignedToMemberId: read(searchParams, "assignedToMemberId"),
      });
      const result = await actionService.listActions(context, query);
      requestedPage = query.page;
      appliedSortValue = query.sort;
      filters.push(
        { param: "status", label: "Status", options: options(ACTION_STATUSES, actionStatusLabels) },
        { param: "priority", label: "Priority", options: options(PRIORITIES, priorityLabels) },
        { param: "actionType", label: "Type", options: options(ACTION_TYPES, actionTypeLabels) },
      );
      rendered = <ActionTable actions={result.data} listId={listId} sort={{ value: query.sort, keys: sortKeys }} />;
      pagination = result.pagination;
      break;
    }

    case "toolbox-talks": {
      const query = toolboxListSchema.parse({
        ...shared,
        status: multi(searchParams, "status", TOOLBOX_STATUSES),
      });
      const result = await toolbox.listToolboxTalks(context, query);
      requestedPage = query.page;
      appliedSortValue = query.sort;
      filters.push({
        param: "status",
        label: "Status",
        options: options(TOOLBOX_STATUSES, toolboxStatusLabels),
      });
      rendered = <ToolboxTable talks={result.data} listId={listId} sort={{ value: query.sort, keys: sortKeys }} />;
      pagination = result.pagination;
      break;
    }

    case "permits": {
      const query = permitListSchema.parse({
        ...shared,
        status: multi(searchParams, "status", PERMIT_STATUSES),
        permitType: multi(searchParams, "permitType", PERMIT_TYPES),
      });
      const result = await permits.listPermits(context, query);
      requestedPage = query.page;
      appliedSortValue = query.sort;
      filters.push(
        { param: "status", label: "Status", options: options(PERMIT_STATUSES, permitStatusLabels) },
        { param: "permitType", label: "Type", options: options(PERMIT_TYPES, permitTypeLabels) },
      );
      rendered = <PermitTable permits={result.data} listId={listId} sort={{ value: query.sort, keys: sortKeys }} />;
      pagination = result.pagination;
      break;
    }

    case "ppe": {
      const query = ppeListSchema.parse({
        ...shared,
        result: multi(searchParams, "result", PPE_RESULTS),
      });
      const result = await ppe.listPpeChecks(context, query);
      requestedPage = query.page;
      appliedSortValue = query.sort;
      filters.push({
        param: "result",
        label: "Result",
        options: options(PPE_RESULTS, ppeResultLabels),
      });
      rendered = <PpeTable
          checks={result.data}
          canEdit={can(context, "hse.ppe.update")}
          listId={listId}
          sort={{ value: query.sort, keys: sortKeys }}
        />;
      pagination = result.pagination;
      break;
    }

    case "environment": {
      const query = observationListSchema.parse({
        ...shared,
        status: multi(searchParams, "status", ENVIRONMENTAL_STATUSES),
        category: multi(searchParams, "category", ENVIRONMENTAL_CATEGORIES),
        severity: multi(searchParams, "severity", SEVERITIES),
      });
      const result = await environment.listObservations(context, query);
      requestedPage = query.page;
      appliedSortValue = query.sort;
      filters.push(
        { param: "status", label: "Status", options: options(ENVIRONMENTAL_STATUSES, environmentalStatusLabels) },
        { param: "category", label: "Category", options: options(ENVIRONMENTAL_CATEGORIES, environmentalCategoryLabels) },
        { param: "severity", label: "Severity", options: options(SEVERITIES, severityLabels) },
      );
      rendered = <ObservationTable observations={result.data} listId={listId} sort={{ value: query.sort, keys: sortKeys }} />;
      pagination = result.pagination;
      break;
    }

    case "stop-work": {
      const query = stopWorkListSchema.parse({
        ...shared,
        status: multi(searchParams, "status", STOP_WORK_STATUSES),
      });
      const result = await stopWork.listStopWorks(context, query);
      requestedPage = query.page;
      appliedSortValue = query.sort;
      filters.push({
        param: "status",
        label: "Status",
        options: options(STOP_WORK_STATUSES, stopWorkStatusLabels),
      });
      rendered = <StopWorkTable records={result.data} listId={listId} sort={{ value: query.sort, keys: sortKeys }} />;
      pagination = result.pagination;
      break;
    }
  }

  const projectList = projectOptions ? (await projectOptions).projects : null;
  if (projectList) {
    filters.push({
      param: "projectId",
      label: "Project",
      options: projectList.map((project) => ({ value: project.id, label: `${project.code} — ${project.name}` })),
    });
  }
  // Without a Project control (templates, stop-work) a URL `projectId` still
  // narrows the list, so Clear must still remove it.
  const extraFilterKeys: string[] = [...EXTRA_FILTER_KEYS, ...(projectList ? [] : ["projectId"])];

  const basePath = `/hse/${kind}`;
  // A page past the end — after a close, an archive or a narrower filter —
  // moves once to the last real page, page 1 when nothing matches (AUD-08 §4, DT-05).
  if (pagination.page !== requestedPage) {
    redirect(listPageRedirect(basePath, searchParams, pagination.page));
  }

  const copy = EMPTY_COPY[kind];
  const create = HSE_CREATE[kind];
  // Every key this list filters by: a narrowed list that matches nothing is
  // "nothing matches", never the first-run "no hazards yet" (AUD-08 §8).
  const filterKeys = ["search", ...filters.map((filter) => filter.param), ...extraFilterKeys];
  const filtered = filterKeys.some((key) => {
    const value = read(searchParams, key);
    return Boolean(value && !(key === "view" && value === "all"));
  });
  // Clear drops this list's search and filters, keeps sort and page size (AUD-08 §3).
  const cleared = clearListFilters(pageHref("", searchParams, 1).replace(/^\?/, ""), filterKeys);

  const buildHref = (page: number) => pageHref(basePath, searchParams, page);

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder={`Search ${kind.replace(/-/g, " ")}`}
        filters={filters}
        sortOptions={SORT_OPTIONS[kind]}
        extraFilterParams={extraFilterKeys}
        applied={{ sort: appliedSortValue }}
      />

      {pagination.total === 0 ? (
        filtered ? (
          <EmptyState
            icon={<HardHat />}
            title="Nothing matches those filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: cleared ? `${basePath}?${cleared}` : basePath }}
          />
        ) : (
          <EmptyState
            icon={<HardHat />}
            title={copy.title}
            description={copy.description}
            action={
              can(context, create.permission)
                ? { label: create.label, href: `/hse/${kind}/new` }
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
