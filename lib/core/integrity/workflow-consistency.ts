import { Prisma, type PrismaClient } from "@prisma/client";

import { ATTENTION_CONDITIONS, findAttentionCondition } from "@/lib/core/notifications/attention.conditions";

/**
 * Cross-module workflow consistency, read from the data (AUD-10 §8, CW-21).
 *
 * The integrations of AUD-10 each keep an invariant between two modules: a
 * linked meeting action follows its Task (§5), an approval source agrees with
 * its cycle (§4), a conversion creates one task (§5, CW-07), a link stays
 * inside its company (§3), a committed decision leaves its durable event (§7).
 * Each service holds its invariant inside its own transaction; this reads the
 * rows afterwards and says where one does not hold — after the seed, after a
 * test suite, on a demo database somebody has been clicking through.
 *
 * What it will never do:
 *
 * - **Write.** Every query runs in one READ ONLY, REPEATABLE READ transaction,
 *   so the database itself refuses a write and every check reads the same
 *   snapshot. The attention conditions' own `holds` probes are reads. Nothing
 *   is repaired: §8 asks for explicit, dry-run, audited repair tooling, and
 *   none is authorised by AUD-10.
 * - **Disclose.** A finding names row ids, codes and statuses — never a title,
 *   a person's name or an amount — and at most `limit` ids per finding, with
 *   the full count beside them (§8: bounded identifiers and reasons).
 *
 * Errors are corruption: the scripts exit non-zero. Warnings are either a
 * sanctioned state worth a look or a projection the next worker run
 * converges (a stale attention item); they never fail the run. Sanctioned
 * exceptions are not reported at all: a CANCELLED action (the sync skips it),
 * an ARCHIVED task's action (it keeps its last mapped status, §5), a unit
 * sale's reservation (its source status never moves on a decision).
 */

export type WorkflowFindingLevel = "error" | "warning";

export type WorkflowFinding = {
  level: WorkflowFindingLevel;
  code: string;
  /** Which check found it, for the report and the matrix (docs/integration/workflow-matrix.md). */
  check: string;
  /** Rows involved, in full. */
  count: number;
  /** At most `limit` of their ids — `table:id`, never content. */
  ids: string[];
  reason: string;
};

export type WorkflowConsistencyReport = {
  findings: WorkflowFinding[];
  /** Every check that ran, found something or not. */
  checks: string[];
  errors: number;
  warnings: number;
};

export type WorkflowConsistencyOptions = {
  /** Only these companies' rows. Default: every company. */
  companyIds?: string[];
  /** Ids listed per finding. Default 20. */
  limit?: number;
  /** How far back a committed transition must have left its outbox event. Default 7 days — well inside the 30-day retention of processed outbox rows. */
  windowDays?: number;
  /** The clock the window is measured from. */
  now?: Date;
  /** Attention items probed for staleness, at most. Default 500. */
  attentionLimit?: number;
};

type Check = {
  key: string;
  code: string;
  level: WorkflowFindingLevel;
  reason: string;
  /** A query yielding `id` (the reported id) and `company_id` for every offending row. */
  sql: Prisma.Sql;
};

const raw = (identifier: string) => Prisma.raw(`"${identifier.replaceAll('"', '""')}"`);

/* -------------------------------------------------------------------------- */
/* Meeting action ↔ Task (§5, CW-07..CW-11)                                    */
/* -------------------------------------------------------------------------- */

/** The §5 mapping, as SQL over `t` (task) and `a` (action): true where they agree. */
const ACTION_FOLLOWS_TASK = Prisma.sql`(
  (t."status" = 'TODO' AND a."status" = 'OPEN')
  OR (t."status" IN ('IN_PROGRESS', 'BLOCKED') AND a."status" = 'IN_PROGRESS')
  OR (t."status" = 'COMPLETED' AND a."status" = 'DONE'))`;

function meetingChecks(): Check[] {
  return [
    {
      key: "meeting_action.status_follows_task",
      code: "ACTION_TASK_STATUS_MISMATCH",
      level: "error",
      reason: "a linked action's status is not what its task's status maps to (TODO→OPEN, IN_PROGRESS/BLOCKED→IN_PROGRESS, COMPLETED→DONE)",
      sql: Prisma.sql`
        SELECT 'meeting_action_items:' || a."id" AS id, a."companyId" AS company_id
        FROM "meeting_action_items" a JOIN "tasks" t ON t."id" = a."linkedTaskId"
        WHERE a."status" <> 'CANCELLED' AND t."status" <> 'ARCHIVED' AND NOT ${ACTION_FOLLOWS_TASK}`,
    },
    {
      key: "meeting_action.owner_follows_task",
      code: "ACTION_TASK_OWNER_MISMATCH",
      level: "error",
      reason: "a linked action's owner is not its task's assignee",
      sql: Prisma.sql`
        SELECT 'meeting_action_items:' || a."id" AS id, a."companyId" AS company_id
        FROM "meeting_action_items" a JOIN "tasks" t ON t."id" = a."linkedTaskId"
        WHERE a."status" <> 'CANCELLED' AND a."ownerMemberId" IS DISTINCT FROM t."assigneeMemberId"`,
    },
    {
      key: "meeting_action.completion_time",
      code: "ACTION_COMPLETED_AT_MISMATCH",
      level: "error",
      reason: "an action is DONE without a completion time, or carries one while not DONE",
      sql: Prisma.sql`
        SELECT 'meeting_action_items:' || a."id" AS id, a."companyId" AS company_id
        FROM "meeting_action_items" a
        WHERE a."status" <> 'CANCELLED' AND ((a."status" = 'DONE') <> (a."completedAt" IS NOT NULL))`,
    },
    {
      key: "meeting_action.same_company",
      code: "CROSS_COMPANY_LINK",
      level: "error",
      reason: "an action and its linked task, or an action and its meeting, belong to different companies",
      sql: Prisma.sql`
        SELECT 'meeting_action_items:' || a."id" AS id, a."companyId" AS company_id
        FROM "meeting_action_items" a
        JOIN "meetings" m ON m."id" = a."meetingId"
        LEFT JOIN "tasks" t ON t."id" = a."linkedTaskId"
        WHERE m."companyId" <> a."companyId" OR (t."id" IS NOT NULL AND t."companyId" <> a."companyId")`,
    },
    {
      /*
       * One action, one task (CW-07). The column is unique, so an action can
       * never name two tasks; the duplicate shows up instead as a second task
       * the conversion trail records for the same action, alive, and not the
       * one the action names.
       */
      key: "meeting_action.one_conversion",
      code: "DUPLICATE_CONVERSION",
      level: "error",
      reason: "more than one live task was recorded as the conversion of the same meeting action",
      sql: Prisma.sql`
        SELECT 'meeting_action_items:' || c."actionId" AS id, c."companyId" AS company_id
        FROM (
          SELECT e."companyId", e."metadataJson"->>'actionId' AS "actionId", e."metadataJson"->>'taskId' AS "taskId"
          FROM "audit_events" e
          WHERE e."actionKey" = 'MEETING_ACTION_TASK_CREATED' AND e."metadataJson" ? 'actionId' AND e."metadataJson" ? 'taskId'
        ) c
        JOIN "tasks" t ON t."id" = c."taskId" AND t."status" <> 'ARCHIVED'
        GROUP BY c."companyId", c."actionId"
        HAVING count(DISTINCT c."taskId") > 1`,
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Task-from-record links: daily logs, planning (§3, §5)                       */
/* -------------------------------------------------------------------------- */

const ENTRY_TABLES = [
  { table: "daily_log_delay_entries", linkType: "DELAY_ACTION" },
  { table: "daily_log_instruction_entries", linkType: "INSTRUCTION_ACTION" },
] as const;

function linkChecks(): Check[] {
  const checks: Check[] = [
    {
      key: "daily_log.one_conversion",
      code: "DUPLICATE_CONVERSION",
      level: "error",
      reason: "more than one live task was created from the same daily log entry",
      sql: Prisma.sql`
        SELECT 'daily_log_entry:' || c."entryId" AS id, c."companyId" AS company_id
        FROM (
          SELECT e."companyId", e."changesJson"->'entryId'->>'after' AS "entryId", e."changesJson"->'taskId'->>'after' AS "taskId"
          FROM "audit_events" e
          WHERE e."actionKey" = 'DAILY_LOG_TASK_CREATED' AND e."changesJson"->'entryId'->>'after' IS NOT NULL
        ) c
        JOIN "tasks" t ON t."id" = c."taskId" AND t."status" <> 'ARCHIVED'
        GROUP BY c."companyId", c."entryId"
        HAVING count(DISTINCT c."taskId") > 1`,
    },
  ];

  // A task converted from an entry that the entry no longer names: the entry was converted again over it.
  for (const entry of ENTRY_TABLES) {
    checks.push({
      key: `daily_log.${entry.linkType.toLowerCase()}_named_by_entry`,
      code: "ORPHANED_CONVERSION",
      level: "error",
      reason: `a daily log ${entry.linkType} task is not the task any of the log's entries names — the entry was converted twice`,
      sql: Prisma.sql`
        SELECT 'daily_log_task_links:' || l."id" AS id, l."companyId" AS company_id
        FROM "daily_log_task_links" l
        WHERE l."linkType" = ${entry.linkType}::"DailyLogTaskLinkType"
          AND NOT EXISTS (SELECT 1 FROM ${raw(entry.table)} x WHERE x."dailyLogId" = l."dailyLogId" AND x."linkedTaskId" = l."taskId")`,
    });
  }

  // Link rows and link columns that name a task — none has a foreign key to it — in another company, or none at all.
  const taskReferences: Array<{ table: string; column: string; company: string }> = [
    { table: "daily_log_task_links", column: "taskId", company: "companyId" },
    { table: "daily_log_work_activities", column: "linkedTaskId", company: "companyId" },
    { table: "daily_log_delay_entries", column: "linkedTaskId", company: "companyId" },
    { table: "daily_log_instruction_entries", column: "linkedTaskId", company: "companyId" },
    { table: "project_milestone_task_links", column: "taskId", company: "companyId" },
    { table: "project_milestone_blockers", column: "linkedTaskId", company: "companyId" },
  ];
  for (const ref of taskReferences) {
    checks.push({
      key: `${ref.table}.${ref.column}.same_company`,
      code: "CROSS_COMPANY_LINK",
      level: "error",
      reason: `${ref.table}.${ref.column} names a task of another company`,
      sql: Prisma.sql`
        SELECT ${`${ref.table}:`} || x."id" AS id, x.${raw(ref.company)} AS company_id
        FROM ${raw(ref.table)} x JOIN "tasks" t ON t."id" = x.${raw(ref.column)}
        WHERE t."companyId" <> x.${raw(ref.company)}`,
    });
    checks.push({
      key: `${ref.table}.${ref.column}.exists`,
      code: "DANGLING_LINK",
      level: "warning",
      reason: `${ref.table}.${ref.column} names a task that does not exist`,
      sql: Prisma.sql`
        SELECT ${`${ref.table}:`} || x."id" AS id, x.${raw(ref.company)} AS company_id
        FROM ${raw(ref.table)} x
        WHERE x.${raw(ref.column)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "tasks" t WHERE t."id" = x.${raw(ref.column)})`,
    });
  }

  // Parent records a link row sits under, in another company.
  checks.push(
    {
      key: "daily_log_task_links.log_same_company",
      code: "CROSS_COMPANY_LINK",
      level: "error",
      reason: "a daily log task link and its daily log belong to different companies",
      sql: Prisma.sql`
        SELECT 'daily_log_task_links:' || l."id" AS id, l."companyId" AS company_id
        FROM "daily_log_task_links" l JOIN "daily_logs" d ON d."id" = l."dailyLogId" WHERE d."companyId" <> l."companyId"`,
    },
    {
      key: "daily_log_document_links.same_company",
      code: "CROSS_COMPANY_LINK",
      level: "error",
      reason: "a daily log names a document of another company, or the link row disagrees with its log",
      sql: Prisma.sql`
        SELECT 'daily_log_document_links:' || l."dailyLogId" || '/' || l."documentId" AS id, l."companyId" AS company_id
        FROM "daily_log_document_links" l
        JOIN "daily_logs" d ON d."id" = l."dailyLogId"
        LEFT JOIN "documents" doc ON doc."id" = l."documentId"
        WHERE d."companyId" <> l."companyId" OR (doc."id" IS NOT NULL AND doc."companyId" <> l."companyId")`,
    },
    {
      key: "unit_document_links.same_company",
      code: "CROSS_COMPANY_LINK",
      level: "error",
      reason: "a unit names a document of another company",
      sql: Prisma.sql`
        SELECT 'unit_document_links:' || l."id" AS id, l."companyId" AS company_id
        FROM "unit_document_links" l JOIN "documents" doc ON doc."id" = l."documentId"
        WHERE doc."companyId" <> l."companyId"`,
    },
    {
      key: "task.meeting_parent_same_company",
      code: "CROSS_COMPANY_LINK",
      level: "error",
      reason: "a task raised from a meeting names a meeting of another company",
      sql: Prisma.sql`
        SELECT 'tasks:' || t."id" AS id, t."companyId" AS company_id
        FROM "tasks" t JOIN "meetings" m ON m."id" = t."entityId"
        WHERE t."entityType" = 'meeting' AND m."companyId" <> t."companyId"`,
    },
  );
  return checks;
}

/* -------------------------------------------------------------------------- */
/* Approval source ↔ cycle (§4, CW-02..CW-06)                                  */
/* -------------------------------------------------------------------------- */

/**
 * The cycle providers' source tables (docs/integration/workflow-matrix.md).
 * HR leave has no cycle table — the request is its own approval — and a unit
 * sale's decision never moves its source's status; both are checked for what
 * they do have, below.
 */
export const APPROVAL_SOURCES: ReadonlyArray<{
  provider: string;
  cycle: string;
  recordType: string;
  source: string;
  statusColumn: string;
  /** The source status that means "waiting for a decision": it needs a PENDING cycle. */
  pending: string;
  /** Further source statuses a PENDING cycle may sit on: a published unit's submitted correction stays PUBLISHED until decided. */
  alsoPendingIn?: string[];
}> = [
  { provider: "finance", cycle: "finance_approvals", recordType: "INVOICE", source: "invoices", statusColumn: "status", pending: "PENDING_APPROVAL" },
  { provider: "finance", cycle: "finance_approvals", recordType: "EXPENSE", source: "expenses", statusColumn: "status", pending: "PENDING_APPROVAL" },
  { provider: "finance", cycle: "finance_approvals", recordType: "BUDGET", source: "project_budgets", statusColumn: "status", pending: "PENDING_APPROVAL" },
  { provider: "finance", cycle: "finance_approvals", recordType: "COMMITMENT", source: "commitments", statusColumn: "status", pending: "PENDING_APPROVAL" },
  { provider: "procurement", cycle: "procurement_approvals", recordType: "PURCHASE_REQUEST", source: "purchase_requests", statusColumn: "status", pending: "PENDING_APPROVAL" },
  { provider: "procurement", cycle: "procurement_approvals", recordType: "PURCHASE_ORDER", source: "purchase_orders", statusColumn: "status", pending: "PENDING_APPROVAL" },
  { provider: "sales", cycle: "sales_approvals", recordType: "PROPOSAL", source: "proposals", statusColumn: "status", pending: "PENDING_APPROVAL" },
  { provider: "legal", cycle: "contract_approvals", recordType: "CONTRACT", source: "contracts", statusColumn: "status", pending: "PENDING_APPROVAL" },
  { provider: "legal", cycle: "contract_approvals", recordType: "AMENDMENT", source: "contract_amendments", statusColumn: "status", pending: "PENDING_APPROVAL" },
  { provider: "qaqc", cycle: "quality_approvals", recordType: "INSPECTION", source: "quality_inspections", statusColumn: "status", pending: "PENDING_APPROVAL" },
  { provider: "qaqc", cycle: "quality_approvals", recordType: "NCR", source: "non_conformance_reports", statusColumn: "status", pending: "PENDING_APPROVAL" },
  { provider: "hse", cycle: "hse_approvals", recordType: "INSPECTION", source: "hse_inspections", statusColumn: "status", pending: "PENDING_APPROVAL" },
  { provider: "hse", cycle: "hse_approvals", recordType: "RISK_ASSESSMENT", source: "hse_risk_assessments", statusColumn: "status", pending: "PENDING_APPROVAL" },
  { provider: "hse", cycle: "hse_approvals", recordType: "WORK_PERMIT", source: "hse_work_permits", statusColumn: "status", pending: "PENDING_APPROVAL" },
  { provider: "hse", cycle: "hse_approvals", recordType: "INCIDENT_CLOSE", source: "hse_incidents", statusColumn: "status", pending: "PENDING_CLOSE" },
  { provider: "timesheets", cycle: "timesheet_approvals", recordType: "TIMESHEET", source: "timesheets", statusColumn: "status", pending: "SUBMITTED" },
  { provider: "projects", cycle: "unit_publication_approvals", recordType: "UNIT", source: "project_units", statusColumn: "publicationStatus", pending: "READY_FOR_PUBLISHING", alsoPendingIn: ["PUBLISHED"] },
];

const CYCLE_TABLES = [...new Set([...APPROVAL_SOURCES.map((source) => source.cycle), "unit_sale_approvals"])];

function approvalChecks(): Check[] {
  const checks: Check[] = [];
  for (const source of APPROVAL_SOURCES) {
    const cycle = raw(source.cycle);
    const table = raw(source.source);
    const status = raw(source.statusColumn);
    checks.push(
      {
        key: `approvals.${source.provider}.${source.recordType.toLowerCase()}.source_pending_has_cycle`,
        code: "APPROVAL_SOURCE_WITHOUT_CYCLE",
        level: "error",
        reason: `${source.source} is ${source.pending} with no PENDING ${source.cycle} row — the Center shows nothing to decide`,
        sql: Prisma.sql`
          SELECT ${`${source.source}:`} || s."id" AS id, s."companyId" AS company_id
          FROM ${table} s
          WHERE s.${status}::text = ${source.pending}
            AND NOT EXISTS (SELECT 1 FROM ${cycle} c WHERE c."recordType"::text = ${source.recordType} AND c."recordId" = s."id" AND c."status"::text = 'PENDING')`,
      },
      {
        key: `approvals.${source.provider}.${source.recordType.toLowerCase()}.cycle_pending_has_source`,
        code: "APPROVAL_CYCLE_WITHOUT_SOURCE",
        level: "error",
        reason: `a PENDING ${source.cycle} row's ${source.source} record is not ${source.pending} (or does not exist) — the Center offers a decision the module will refuse`,
        sql: Prisma.sql`
          SELECT ${`${source.cycle}:`} || c."id" AS id, c."companyId" AS company_id
          FROM ${cycle} c
          WHERE c."recordType"::text = ${source.recordType} AND c."status"::text = 'PENDING'
            AND NOT EXISTS (SELECT 1 FROM ${table} s WHERE s."id" = c."recordId" AND s.${status}::text = ANY(${[source.pending, ...(source.alsoPendingIn ?? [])]}::text[]))`,
      },
      {
        key: `approvals.${source.provider}.${source.recordType.toLowerCase()}.same_company`,
        code: "CROSS_COMPANY_LINK",
        level: "error",
        reason: `a ${source.cycle} row and its ${source.source} record belong to different companies`,
        sql: Prisma.sql`
          SELECT ${`${source.cycle}:`} || c."id" AS id, c."companyId" AS company_id
          FROM ${cycle} c JOIN ${table} s ON s."id" = c."recordId"
          WHERE c."recordType"::text = ${source.recordType} AND s."companyId" <> c."companyId"`,
      },
    );
  }

  for (const table of CYCLE_TABLES) {
    checks.push({
      key: `approvals.${table}.one_pending`,
      code: "APPROVAL_MULTIPLE_PENDING",
      level: "error",
      reason: `a record has more than one PENDING ${table} row — two queue items for one decision`,
      sql: Prisma.sql`
        SELECT ${`${table}:`} || c."recordType"::text || '/' || c."recordId" AS id, c."companyId" AS company_id
        FROM ${raw(table)} c WHERE c."status"::text = 'PENDING'
        GROUP BY c."companyId", c."recordType", c."recordId" HAVING count(*) > 1`,
    });
  }

  checks.push(
    {
      key: "approvals.unit_sales.same_company",
      code: "CROSS_COMPANY_LINK",
      level: "error",
      reason: "a unit sale approval and its unit belong to different companies",
      sql: Prisma.sql`
        SELECT 'unit_sale_approvals:' || c."id" AS id, c."companyId" AS company_id
        FROM "unit_sale_approvals" c JOIN "project_units" u ON u."id" = c."recordId" WHERE u."companyId" <> c."companyId"`,
    },
    {
      // Parallel reviewers: many PENDING reviews on one version is the design; one reviewer twice is not (pendingKey).
      key: "approvals.documents.version_in_review_has_review",
      code: "APPROVAL_SOURCE_WITHOUT_CYCLE",
      level: "error",
      reason: "a document version is IN_REVIEW with no PENDING review",
      sql: Prisma.sql`
        SELECT 'document_versions:' || v."id" AS id, v."companyId" AS company_id
        FROM "document_versions" v
        WHERE v."reviewState" = 'IN_REVIEW' AND NOT EXISTS (SELECT 1 FROM "document_reviews" r WHERE r."documentVersionId" = v."id" AND r."status" = 'PENDING')`,
    },
    {
      key: "approvals.documents.pending_review_has_version_in_review",
      code: "APPROVAL_CYCLE_WITHOUT_SOURCE",
      level: "error",
      reason: "a PENDING document review's version is not IN_REVIEW",
      sql: Prisma.sql`
        SELECT 'document_reviews:' || r."id" AS id, r."companyId" AS company_id
        FROM "document_reviews" r JOIN "document_versions" v ON v."id" = r."documentVersionId"
        WHERE r."status" = 'PENDING' AND v."reviewState" <> 'IN_REVIEW'`,
    },
    {
      key: "approvals.documents.same_company",
      code: "CROSS_COMPANY_LINK",
      level: "error",
      reason: "a document review and its document belong to different companies",
      sql: Prisma.sql`
        SELECT 'document_reviews:' || r."id" AS id, r."companyId" AS company_id
        FROM "document_reviews" r JOIN "documents" d ON d."id" = r."documentId" WHERE d."companyId" <> r."companyId"`,
    },
  );
  return checks;
}

/* -------------------------------------------------------------------------- */
/* Committed transitions and their durable event (§7, CW-06, CW-16)            */
/* -------------------------------------------------------------------------- */

/** The registry record type each cycle's decision event names (lib/core/notifications/approval-notifications.ts). */
const DECISION_EVENT_ENTITY: ReadonlyArray<{ cycle: string; recordType: string; entityType: string }> = [
  { cycle: "finance_approvals", recordType: "INVOICE", entityType: "invoice" },
  { cycle: "finance_approvals", recordType: "EXPENSE", entityType: "expense" },
  { cycle: "finance_approvals", recordType: "BUDGET", entityType: "budget" },
  { cycle: "finance_approvals", recordType: "COMMITMENT", entityType: "commitment" },
  { cycle: "procurement_approvals", recordType: "PURCHASE_REQUEST", entityType: "purchase_request" },
  { cycle: "procurement_approvals", recordType: "PURCHASE_ORDER", entityType: "purchase_order" },
  { cycle: "sales_approvals", recordType: "PROPOSAL", entityType: "proposal" },
  { cycle: "contract_approvals", recordType: "CONTRACT", entityType: "contract" },
  { cycle: "contract_approvals", recordType: "AMENDMENT", entityType: "amendment" },
  { cycle: "quality_approvals", recordType: "INSPECTION", entityType: "quality_inspection" },
  { cycle: "quality_approvals", recordType: "NCR", entityType: "non_conformance_report" },
  { cycle: "hse_approvals", recordType: "INSPECTION", entityType: "hse_inspection" },
  { cycle: "hse_approvals", recordType: "RISK_ASSESSMENT", entityType: "risk_assessment" },
  { cycle: "hse_approvals", recordType: "WORK_PERMIT", entityType: "work_permit" },
  { cycle: "hse_approvals", recordType: "INCIDENT_CLOSE", entityType: "incident" },
];

/** Where the event is looked for around the transition: both are written in one transaction, a few ms apart. */
const EVENT_SLACK = Prisma.sql`interval '5 minutes'`;

function outboxChecks(since: Date): Check[] {
  const checks: Check[] = DECISION_EVENT_ENTITY.map((decision) => ({
    key: `outbox.approval_decided.${decision.entityType}`,
    code: "MISSING_EVENT_INTENT",
    level: "error" as const,
    reason: `a ${decision.cycle} ${decision.recordType} decision committed with no APPROVAL_<decision> outbox event — the requester is never told`,
    sql: Prisma.sql`
      SELECT ${`${decision.cycle}:`} || c."id" AS id, c."companyId" AS company_id
      FROM ${raw(decision.cycle)} c
      WHERE c."recordType"::text = ${decision.recordType}
        AND c."status"::text IN ('APPROVED', 'REJECTED', 'RETURNED')
        AND c."decidedAt" >= ${since}
        -- A decision taken on an open cycle: the row existed before it was decided. A row inserted
        -- already decided is imported history (the seed's backdated cycles), not a transition.
        AND c."decidedAt" >= c."createdAt"
        AND NOT EXISTS (
          SELECT 1 FROM "notification_event_outbox" o
          WHERE o."companyId" = c."companyId" AND o."entityType" = ${decision.entityType} AND o."entityId" = c."recordId"
            AND o."eventType" = 'APPROVAL_' || c."status"::text
            AND o."createdAt" BETWEEN c."decidedAt" - ${EVENT_SLACK} AND c."decidedAt" + ${EVENT_SLACK})`,
  }));

  checks.push({
    key: "outbox.task_completed",
    code: "MISSING_EVENT_INTENT",
    level: "error",
    reason: "a task completion committed (its TASK_COMPLETED activity exists) with no TASK_COMPLETED outbox event",
    sql: Prisma.sql`
      SELECT 'activities:' || a."id" AS id, a."companyId" AS company_id
      FROM "activities" a
      WHERE a."action" = 'TASK_COMPLETED' AND a."entityType" = 'Task' AND a."createdAt" >= ${since}
        AND NOT EXISTS (
          SELECT 1 FROM "notification_event_outbox" o
          WHERE o."companyId" = a."companyId" AND o."entityType" = 'task' AND o."entityId" = a."entityId" AND o."eventType" = 'TASK_COMPLETED'
            AND ((a."correlationId" IS NOT NULL AND o."correlationId" = a."correlationId")
              OR o."createdAt" BETWEEN a."createdAt" - ${EVENT_SLACK} AND a."createdAt" + ${EVENT_SLACK}))`,
  });

  checks.push({
    key: "outbox.failed_events",
    code: "OUTBOX_EVENT_FAILED",
    level: "warning",
    reason: "an outbox event is FAILED: its business change committed, its delivery did not — inspect lastErrorCode and retry it with the worker CLI",
    sql: Prisma.sql`
      SELECT 'notification_event_outbox:' || o."id" AS id, o."companyId" AS company_id
      FROM "notification_event_outbox" o WHERE o."status" = 'FAILED'`,
  });
  return checks;
}

/* -------------------------------------------------------------------------- */
/* Structural guarantees the checks above lean on                              */
/* -------------------------------------------------------------------------- */

/** Unique indexes whose absence would let a duplicate through unseen (§5 CW-07, §10). */
const REQUIRED_UNIQUE_INDEXES: ReadonlyArray<{ table: string; columns: string[]; code: string; reason: string }> = [
  { table: "meeting_action_items", columns: ["linkedTaskId"], code: "UNIQUE_GUARD_MISSING", reason: "nothing stops two actions naming one task, or a conversion race linking twice" },
  { table: "notifications", columns: ["companyId", "recipientMemberId", "dedupeKey"], code: "UNIQUE_GUARD_MISSING", reason: "a redelivered event could write a second notification per recipient" },
];

async function missingUniqueIndexes(tx: Prisma.TransactionClient): Promise<WorkflowFinding[]> {
  const findings: WorkflowFinding[] = [];
  for (const guard of REQUIRED_UNIQUE_INDEXES) {
    const rows = await tx.$queryRaw<Array<{ found: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_index i
        JOIN pg_class t ON t.oid = i.indrelid
        WHERE t.relname = ${guard.table} AND t.relnamespace = to_regnamespace(current_schema())::oid AND i.indisunique AND i.indpred IS NULL
          AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a WHERE a.attrelid = t.oid AND a.attnum = ANY(i.indkey))
            = (SELECT array_agg(c ORDER BY c) FROM unnest(${guard.columns}::text[]) c)
      ) AS found`;
    if (!rows[0]?.found) {
      findings.push({ level: "error", code: guard.code, check: `unique.${guard.table}`, count: 1, ids: [`${guard.table}(${guard.columns.join(",")})`], reason: guard.reason });
    }
  }
  return findings;
}

/* -------------------------------------------------------------------------- */
/* Stale projections                                                           */
/* -------------------------------------------------------------------------- */

/**
 * ACTIVE attention items whose condition no longer holds (PRD #25 §13-§15):
 * the one projection AUD-10's workflows feed that is not recomputed on read.
 * The resolving write is in the deciding transaction (approvals, action
 * completion) and the reconciler sweeps the rest, so a stale item is a
 * warning — it converges — not corruption. Probed with each condition's own
 * read-only `holds`, a bounded number of items.
 */
async function staleAttention(prisma: PrismaClient, options: Required<Pick<WorkflowConsistencyOptions, "limit" | "attentionLimit">> & { companyIds?: string[]; now: Date }): Promise<WorkflowFinding[]> {
  const items = await prisma.attentionItem.findMany({
    where: { status: "ACTIVE", conditionKey: { in: [...ATTENTION_CONDITIONS] }, ...(options.companyIds ? { companyId: { in: options.companyIds } } : {}) },
    select: { id: true, companyId: true, conditionKey: true, entityType: true, entityId: true },
    orderBy: { id: "asc" },
    take: options.attentionLimit,
  });
  const verdicts = new Map<string, boolean>();
  const stale: string[] = [];
  for (const item of items) {
    const condition = findAttentionCondition(item.conditionKey);
    if (!condition) continue;
    const key = `${item.companyId}:${item.conditionKey}:${item.entityType}:${item.entityId}`;
    if (!verdicts.has(key)) verdicts.set(key, await condition.holds(item.companyId, item.entityType, item.entityId, options.now));
    if (!verdicts.get(key)) stale.push(`attention_items:${item.id}`);
  }
  if (stale.length === 0) return [];
  return [{ level: "warning", code: "STALE_PROJECTION", check: "attention.condition_holds", count: stale.length, ids: stale.slice(0, options.limit), reason: "an ACTIVE attention item's condition no longer holds; the attention reconciler resolves it on its next run" }];
}

/* -------------------------------------------------------------------------- */
/* The run                                                                     */
/* -------------------------------------------------------------------------- */

export function workflowChecks(since: Date): Check[] {
  return [...meetingChecks(), ...linkChecks(), ...approvalChecks(), ...outboxChecks(since)];
}

export async function findWorkflowInconsistencies(prisma: PrismaClient, options: WorkflowConsistencyOptions = {}): Promise<WorkflowConsistencyReport> {
  const limit = options.limit ?? 20;
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - (options.windowDays ?? 7) * 24 * 60 * 60 * 1000);
  const companyIds = options.companyIds?.length ? options.companyIds : undefined;
  const checks = workflowChecks(since);
  const findings: WorkflowFinding[] = [];

  await prisma.$transaction(
    async (tx) => {
      // The database, not this file's good intentions, keeps the run read-only — and one snapshot for every check.
      await tx.$executeRawUnsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
      findings.push(...(await missingUniqueIndexes(tx)));
      for (const check of checks) {
        const scope = companyIds ? Prisma.sql`WHERE q.company_id = ANY(${companyIds}::text[])` : Prisma.empty;
        const rows = await tx.$queryRaw<Array<{ id: string; total: bigint }>>`
          SELECT q.id, count(*) OVER () AS total FROM (${check.sql}) q ${scope} ORDER BY q.id LIMIT ${limit}`;
        if (rows.length === 0) continue;
        findings.push({ level: check.level, code: check.code, check: check.key, count: Number(rows[0].total), ids: rows.map((row) => row.id), reason: check.reason });
      }
    },
    { timeout: 300_000, maxWait: 30_000 },
  );

  findings.push(...(await staleAttention(prisma, { limit, attentionLimit: options.attentionLimit ?? 500, companyIds, now })));

  return {
    findings,
    checks: ["unique.guards", ...checks.map((check) => check.key), "attention.condition_holds"],
    errors: findings.filter((finding) => finding.level === "error").length,
    warnings: findings.filter((finding) => finding.level === "warning").length,
  };
}
