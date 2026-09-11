/**
 * The metric registry (PRD #27 §18-§23, §370).
 *
 * One definition per metric, used everywhere it appears. Without this, the
 * dashboard and the report can quietly disagree about what "outstanding
 * receivables" means, and both look authoritative (PRD #27 §21, §22, §275).
 */

export type MetricValueType = "NUMBER" | "CURRENCY" | "PERCENT" | "DURATION" | "QUANTITY";
export type MetricAggregation = "COUNT" | "SUM" | "AVG" | "RATIO" | "DERIVED";

export type MetricDefinition = {
  key: string;
  moduleKey: string;
  label: string;
  description: string;
  valueType: MetricValueType;
  aggregation: MetricAggregation;
  /** Whether values must be grouped by currency or unit before display. */
  currencyBehavior?: "SINGLE" | "GROUPED";
  unitBehavior?: "SINGLE" | "GROUPED";
  requiredPermission: string;
  /** Which date field decides whether a record falls in the period (PRD #27 §378). */
  dateField?: string;
  /** Snapshot metrics describe now; flow metrics describe the period (PRD #27 §379). */
  kind: "SNAPSHOT" | "FLOW";
};

const METRICS: MetricDefinition[] = [
  {
    key: "finance.invoice.outstanding",
    moduleKey: "finance",
    label: "Outstanding receivables",
    description: "Issued invoice totals less payments applied, excluding cancelled and void invoices.",
    valueType: "CURRENCY",
    aggregation: "SUM",
    currencyBehavior: "GROUPED",
    requiredPermission: "finance.invoice.view",
    kind: "SNAPSHOT",
  },
  {
    key: "finance.invoice.overdue",
    moduleKey: "finance",
    label: "Overdue receivables",
    description: "Outstanding amounts whose due date has passed in the company timezone.",
    valueType: "CURRENCY",
    aggregation: "SUM",
    currencyBehavior: "GROUPED",
    requiredPermission: "finance.invoice.view",
    dateField: "dueDate",
    kind: "SNAPSHOT",
  },
  {
    key: "finance.invoice.invoiced",
    moduleKey: "finance",
    label: "Invoiced revenue",
    description: "Total of invoices issued in the period. Not accounting revenue recognition.",
    valueType: "CURRENCY",
    aggregation: "SUM",
    currencyBehavior: "GROUPED",
    requiredPermission: "finance.invoice.view",
    dateField: "issueDate",
    kind: "FLOW",
  },
  {
    key: "finance.expense.total",
    moduleKey: "finance",
    label: "Expenses",
    description: "Approved expenses recorded in the period.",
    valueType: "CURRENCY",
    aggregation: "SUM",
    currencyBehavior: "GROUPED",
    requiredPermission: "finance.expense.view",
    dateField: "expenseDate",
    kind: "FLOW",
  },
  {
    key: "projects.active.count",
    moduleKey: "projects",
    label: "Active projects",
    description: "Projects currently in an active status.",
    valueType: "NUMBER",
    aggregation: "COUNT",
    requiredPermission: "project.view",
    kind: "SNAPSHOT",
  },
  {
    key: "tasks.open.count",
    moduleKey: "tasks",
    label: "Open tasks",
    description: "Tasks not completed or archived, within the viewer's scope.",
    valueType: "NUMBER",
    aggregation: "COUNT",
    requiredPermission: "task.view",
    kind: "SNAPSHOT",
  },
  {
    key: "tasks.overdue.count",
    moduleKey: "tasks",
    label: "Overdue tasks",
    description: "Open tasks whose due date has passed. Uses the canonical Tasks overdue rule.",
    valueType: "NUMBER",
    aggregation: "COUNT",
    requiredPermission: "task.view",
    dateField: "dueAt",
    kind: "SNAPSHOT",
  },
  {
    key: "sales.pipeline.value",
    moduleKey: "sales",
    label: "Pipeline value",
    description: "Open opportunity value, grouped by currency.",
    valueType: "CURRENCY",
    aggregation: "SUM",
    currencyBehavior: "GROUPED",
    requiredPermission: "sales.opportunity.view",
    kind: "SNAPSHOT",
  },
  {
    key: "hr.headcount",
    moduleKey: "hr",
    label: "Active employees",
    description: "Employee profiles in an active employment status.",
    valueType: "NUMBER",
    aggregation: "COUNT",
    requiredPermission: "hr.employee.view",
    kind: "SNAPSHOT",
  },
];

const BY_KEY = new Map<string, MetricDefinition>();
for (const metric of METRICS) {
  if (BY_KEY.has(metric.key)) throw new Error(`Duplicate metric key: ${metric.key}`);
  BY_KEY.set(metric.key, metric);
}

export function findMetric(key: string): MetricDefinition | undefined {
  return BY_KEY.get(key);
}

export function metricDefinitions(): MetricDefinition[] {
  return [...METRICS];
}
