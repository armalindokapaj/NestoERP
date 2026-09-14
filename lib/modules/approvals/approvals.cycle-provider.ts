import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import type { ApprovalGuard } from "@/lib/core/approvals/approval-guard";
import { delegationsTo, type ActiveDelegation } from "@/lib/core/approvals/approval-delegations";
import { currentStepOf, loadApprovalStepsFor, stepEligibility, type StepRow } from "@/lib/core/approvals/approval-steps";
import { moduleAndPermissions, recordDefinition } from "@/lib/core/records/record.registry";
import type { RecordType } from "@/lib/core/records/record.types";
import { prisma } from "@/lib/database/prisma";
import { approvalDocuments } from "./approvals.documents";
import {
  approvalError,
  dateRange,
  keysetWhere,
  memberNames,
  notFound,
  personOrUnknown,
  translateSourceError,
  type ApprovalProvider,
  type ProviderDetail,
  type ProviderItem,
  type ProviderQuery,
} from "./approvals.provider";
import type {
  ApprovalDecision,
  ApprovalDecisionOutcome,
  ApprovalMoney,
  ApprovalPerson,
  ApprovalPriority,
  ApprovalProviderKey,
  ApprovalStepDTO,
  ApprovalSummaryField,
  ApprovalTab,
  ApprovalWarning,
  UnifiedApprovalHistoryEntry,
  UnifiedApprovalStatus,
} from "./approvals.types";

/**
 * A provider over a module's own approval table (PRD #41 §9, §11, §18, §19).
 *
 * Finance, Sales, Legal, Procurement, QA/QC and HSE each keep one row per
 * submission with the same shape — record type and id, status, who submitted
 * and when, who decided and why. This reads that table and hands everything
 * that is about the record itself to the module: which records a reader can
 * reach, what an invoice or a permit says, and the service call that decides
 * it. No generic approval table is introduced (§19).
 *
 * Queries (§250), all company-scoped and each backed by the table's own
 * indexes:
 *
 *   waiting    status = PENDING, record types this reader may decide   [companyId, status]
 *   requested  submittedByMemberId = me                                [submittedByMemberId]
 *   decided    decidedByMemberId = me, status = outcome                [decidedByMemberId]
 *              plus chain steps decided by me                          approval_steps [companyId, decidedByMemberId, status]
 *   history    record types whose approvals this reader may view       [companyId, status], [submittedAt]
 *
 * Every row then survives only if the reader can reach its record through the
 * module's own scope (§239), and a decision re-reads everything inside the
 * module's own transaction (§122, §186).
 */

type CycleStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "RETURNED";

export const CYCLE_SELECT = {
  id: true,
  recordType: true,
  recordId: true,
  status: true,
  submittedByMemberId: true,
  submittedAt: true,
  decidedByMemberId: true,
  decidedAt: true,
  decisionNote: true,
} as const;

export type CycleRow = {
  id: string;
  recordType: string;
  recordId: string;
  status: CycleStatus;
  submittedByMemberId: string;
  submittedAt: Date;
  decidedByMemberId: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
};

/** The calls a provider makes on a module's approval table; every module's Prisma delegate has them. */
export type CycleTable = {
  findMany(args: { where: object; orderBy?: object | object[]; take?: number; select: typeof CYCLE_SELECT }): Promise<CycleRow[]>;
  findFirst(args: { where: object; orderBy?: object | object[]; select: typeof CYCLE_SELECT }): Promise<CycleRow | null>;
  count(args: { where: object }): Promise<number>;
};

/** What a module says about one record in an approval (PRD #41 §17, §184, §185). */
export type RecordFacts = {
  id: string;
  reference: string | null;
  title: string;
  subtitle: string | null;
  amount: ApprovalMoney | null;
  project: { id: string; name: string; code: string | null } | null;
  href: string;
  /** A real deadline for the decision from the source, never invented (§37). */
  dueAt?: Date | null;
  priority?: ApprovalPriority;
  requiresStrongConfirmation?: boolean;
  summary: ApprovalSummaryField[];
  description?: string | null;
  warnings?: ApprovalWarning[];
  reason?: string | null;
};

export type MatchFilters = { q?: string; projectId?: string; amountMin?: number; amountMax?: number };

export type RecordAdapter = {
  recordType: RecordType;
  noun: string;
  /** Seeing this type's approvals beyond your own: the module's approval view grant and the record's. */
  canView(context: UserContext): boolean;
  canApprove(context: UserContext): boolean;
  canReject(context: UserContext): boolean;
  /** The grant that lets a submitter decide their own, where the module has one. */
  selfPermission: Permission | null;
  /** Why this type needs approval at all, when a record says nothing more specific. */
  reason: string;
  /** Record ids matching the filters, inside the reader's scope; bounded. */
  match(context: UserContext, filters: MatchFilters): Promise<string[]>;
  hydrate(context: UserContext, ids: string[]): Promise<Map<string, RecordFacts>>;
  approve(context: UserContext, recordId: string, note: string | null, guard: ApprovalGuard): Promise<void>;
  reject?(context: UserContext, recordId: string, note: string, guard: ApprovalGuard): Promise<void>;
  returnForRevision?(context: UserContext, recordId: string, note: string, guard: ApprovalGuard): Promise<void>;
};

export type CycleProviderConfig = {
  key: ApprovalProviderKey;
  moduleKey: ModuleKey;
  label: string;
  table: () => CycleTable;
  /** Keyed by the table's record type value: "INVOICE", "PURCHASE_ORDER". */
  records: Record<string, RecordAdapter>;
  /** Set when the module writes chains for some of its approvals (PRD #41 §21). */
  chain?: { canReadAs(recordId: string): (memberContext: UserContext) => Promise<boolean> };
};

/** How many rows one source contributes to one view before the Center stops asking (§252). */
export const WINDOW = 300;
const MAX_ROUNDS = 4;

const CYCLE_STATUSES = new Set<UnifiedApprovalStatus>(["PENDING", "APPROVED", "REJECTED", "RETURNED", "CANCELLED"]);

const DECIDED_TAB_STATUS: Partial<Record<ApprovalTab, CycleStatus>> = {
  approved: "APPROVED",
  rejected: "REJECTED",
  returned: "RETURNED",
};

export function createCycleProvider(config: CycleProviderConfig): ApprovalProvider {
  const types = Object.keys(config.records);
  const adapterFor = (recordType: string): RecordAdapter | null => config.records[recordType] ?? null;
  // Only modules that return for revision have a RETURNED status at all.
  const returns = Object.values(config.records).some((adapter) => Boolean(adapter.returnForRevision));

  async function reachableIds(context: UserContext, rows: CycleRow[]): Promise<Set<string>> {
    const reachable = new Set<string>();
    for (const type of new Set(rows.map((row) => row.recordType))) {
      const adapter = adapterFor(type);
      const definition = adapter ? recordDefinition(adapter.recordType) : null;
      // The record's own door first: module on, and the record type's view grants (PRD #41 §5).
      if (!adapter || !definition || !moduleAndPermissions(context, definition.moduleKey, definition.viewPermissions)) continue;
      const ids = rows.filter((row) => row.recordType === type).map((row) => row.recordId);
      for (const id of await definition.reachable(context, [...new Set(ids)])) reachable.add(`${type}:${id}`);
    }
    return reachable;
  }

  function selfAllowed(context: UserContext, adapter: RecordAdapter): boolean {
    return Boolean(adapter.selfPermission && can(context, adapter.selfPermission));
  }

  async function matchClause(context: UserContext, query: ProviderQuery): Promise<object | null> {
    if (!query.q && !query.projectId && query.amountMin === undefined && query.amountMax === undefined) return null;
    const filters = { q: query.q, projectId: query.projectId, amountMin: query.amountMin, amountMax: query.amountMax };
    const clauses: object[] = [];
    for (const type of types) {
      const ids = await config.records[type].match(context, filters);
      if (ids.length > 0) clauses.push({ recordType: type, recordId: { in: ids } });
    }
    // Nothing matched: a clause no row can satisfy, rather than no clause.
    return clauses.length > 0 ? { OR: clauses } : { id: { in: [] } };
  }

  /** Rows for a view, in date order, until `limit` survive reachability or the table runs out. */
  async function collectRows(
    context: UserContext,
    query: ProviderQuery,
    base: object[],
    dateField: "submittedAt" | "decidedAt",
    keep: (row: CycleRow) => Promise<boolean> | boolean,
  ): Promise<Array<{ row: CycleRow; sortAt: Date }>> {
    const table = config.table();
    const kept: Array<{ row: CycleRow; sortAt: Date }> = [];
    let after = query.after;
    const take = query.tab === "waiting" ? WINDOW : Math.min(WINDOW, Math.max(query.limit * 2, 40));
    for (let round = 0; round < (query.tab === "waiting" ? 1 : MAX_ROUNDS); round += 1) {
      const keyset = query.tab === "waiting" ? null : keysetWhere(dateField, config.key, { after, order: query.order });
      const rows = await table.findMany({
        where: { AND: [...base, ...(keyset ? [keyset] : [])] },
        orderBy: [{ [dateField]: query.order }, { id: query.order }],
        take,
        select: CYCLE_SELECT,
      });
      const reachable = await reachableIds(context, rows);
      for (const row of rows) {
        if (!reachable.has(`${row.recordType}:${row.recordId}`)) continue;
        if (!(await keep(row))) continue;
        kept.push({ row, sortAt: (dateField === "decidedAt" ? row.decidedAt : row.submittedAt) ?? row.submittedAt });
      }
      if (rows.length < take || kept.length >= query.limit) break;
      const last = rows[rows.length - 1];
      after = { at: (dateField === "decidedAt" ? last.decidedAt : last.submittedAt) ?? last.submittedAt, providerKey: config.key, approvalId: last.id };
    }
    return kept.slice(0, query.tab === "waiting" ? WINDOW : query.limit);
  }

  type Eligibility = { eligible: boolean; onBehalfOf: string | null; blocked: string | null };

  async function eligibilityFor(
    context: UserContext,
    rows: CycleRow[],
    chains: Map<string, StepRow[]>,
  ): Promise<Map<string, Eligibility>> {
    const result = new Map<string, Eligibility>();
    let delegations: ActiveDelegation[] | undefined;
    for (const row of rows) {
      const adapter = adapterFor(row.recordType);
      if (!adapter || row.status !== "PENDING") continue;
      const steps = chains.get(row.id) ?? [];
      if (steps.length > 0 && config.chain) {
        const step = currentStepOf(steps);
        if (!step) continue;
        delegations ??= await delegationsTo(context.companyId, context.membershipId, config.key);
        const verdict = await stepEligibility(context, step, {
          providerKey: config.key,
          steps,
          submittedByMemberId: row.submittedByMemberId,
          allowSelf: selfAllowed(context, adapter),
          canReadAs: config.chain.canReadAs(row.recordId),
          delegations,
        });
        result.set(
          row.id,
          verdict.eligible
            ? { eligible: true, onBehalfOf: verdict.onBehalfOfMemberId, blocked: null }
            : {
                eligible: false,
                onBehalfOf: null,
                blocked:
                  verdict.reason === "SELF_APPROVAL"
                    ? "You requested this, so somebody else decides it."
                    : verdict.reason === "ALREADY_DECIDED_STEP"
                      ? "You decided an earlier step, so somebody else takes this one."
                      : verdict.reason === "RESERVED_FOR_LATER_STEP"
                        ? `You take a later step, so the ${step.label} decision goes to somebody else.`
                      : steps.length === 1
                        ? "Waiting for the designated approver."
                        : `Waiting for the ${step.label} decision (step ${step.stepNumber} of ${steps.length}).`,
              },
        );
        continue;
      }
      if (row.submittedByMemberId === context.membershipId && !selfAllowed(context, adapter)) {
        result.set(row.id, { eligible: false, onBehalfOf: null, blocked: "You requested this, so somebody else decides it." });
        continue;
      }
      const able = adapter.canApprove(context) || adapter.canReject(context);
      result.set(row.id, { eligible: able, onBehalfOf: null, blocked: able ? null : "Waiting for an approver." });
    }
    return result;
  }

  async function buildItems(
    context: UserContext,
    entries: Array<{ row: CycleRow; sortAt: Date }>,
    known?: { chains: Map<string, StepRow[]>; eligibility: Map<string, Eligibility> },
  ): Promise<{ items: ProviderItem[]; facts: Map<string, RecordFacts>; chains: Map<string, StepRow[]> }> {
    const rows = entries.map((entry) => entry.row);
    const chains = known?.chains ?? (config.chain ? await loadApprovalStepsFor(config.key, rows.map((row) => row.id)) : new Map<string, StepRow[]>());
    const eligibility = known?.eligibility ?? (await eligibilityFor(context, rows, chains));

    const facts = new Map<string, RecordFacts>();
    for (const type of new Set(rows.map((row) => row.recordType))) {
      const adapter = adapterFor(type);
      if (!adapter) continue;
      const ids = [...new Set(rows.filter((row) => row.recordType === type).map((row) => row.recordId))];
      for (const [id, fact] of await adapter.hydrate(context, ids)) facts.set(`${type}:${id}`, fact);
    }
    const names = await memberNames(context.companyId, [
      ...rows.flatMap((row) => [row.submittedByMemberId, row.decidedByMemberId]),
      ...[...eligibility.values()].map((value) => value.onBehalfOf),
    ]);

    const items: ProviderItem[] = [];
    for (const { row, sortAt } of entries) {
      const adapter = adapterFor(row.recordType);
      const fact = facts.get(`${row.recordType}:${row.recordId}`);
      if (!adapter || !fact) continue;
      const steps = chains.get(row.id) ?? [];
      const current = currentStepOf(steps);
      const pending = row.status === "PENDING";
      const verdict = eligibility.get(row.id);
      const able = pending && Boolean(verdict?.eligible);
      const inChain = steps.length > 0;
      // A one-step chain is a named approver, not a sequence: no "step 1 of 1" (PRD #42 §73).
      const sequence = steps.length > 1;
      items.push({
        id: `${config.key}:${row.id}`,
        providerKey: config.key,
        sourceType: adapter.recordType,
        sourceId: row.recordId,
        approvalId: row.id,
        sourceLabel: adapter.noun,
        title: fact.title,
        subtitle: fact.subtitle,
        reference: fact.reference,
        status: row.status,
        priority: fact.priority ?? (inChain && steps.length > 2 ? "HIGH" : "NORMAL"),
        amount: fact.amount,
        project: fact.project,
        requester: personOrUnknown(names, row.submittedByMemberId),
        requestedAt: row.submittedAt.toISOString(),
        dueAt: pending && fact.dueAt ? fact.dueAt.toISOString() : null,
        decidedAt: row.decidedAt?.toISOString() ?? null,
        decidedBy: row.decidedByMemberId ? personOrUnknown(names, row.decidedByMemberId) : null,
        currentStep: sequence ? (current?.stepNumber ?? steps.length) : null,
        totalSteps: sequence ? steps.length : null,
        stepLabel: sequence ? (current?.label ?? null) : null,
        href: fact.href,
        canApprove: able && (inChain || adapter.canApprove(context)),
        canReject: able && Boolean(adapter.reject) && (inChain || adapter.canReject(context)),
        canReturn: able && Boolean(adapter.returnForRevision) && (inChain || adapter.canReject(context)),
        requiresStrongConfirmation: Boolean(fact.requiresStrongConfirmation),
        blockedReason: pending && !able ? (verdict?.blocked ?? null) : null,
        onBehalfOf: able && verdict?.onBehalfOf ? personOrUnknown(names, verdict.onBehalfOf) : null,
        version: 1 + steps.filter((step) => step.status !== "PENDING").length,
        sortAt: sortAt.toISOString(),
      });
    }
    return { items, facts, chains };
  }

  function waitingTypes(context: UserContext): string[] {
    return types.filter((type) => {
      const adapter = config.records[type];
      return adapter.canApprove(context) || adapter.canReject(context) || Boolean(config.chain);
    });
  }

  async function queue(context: UserContext, query: ProviderQuery): Promise<ProviderItem[]> {
    const me = context.membershipId;
    const base: object[] = [{ companyId: context.companyId }];
    const statuses = query.statuses.filter((status) => CYCLE_STATUSES.has(status) && (returns || status !== "RETURNED"));
    if (query.statuses.length > 0 && statuses.length === 0) return [];
    const match = await matchClause(context, query);
    if (match) base.push(match);
    if (query.requesterId) base.push({ submittedByMemberId: query.requesterId });

    if (query.tab === "waiting") {
      const allowed = waitingTypes(context);
      if (allowed.length === 0) return [];
      base.push({ status: "PENDING", recordType: { in: allowed } });
      const range = dateRange(query);
      if (range) base.push({ submittedAt: range });
      const entries = await collectRows(context, query, base, "submittedAt", () => true);
      const rows = entries.map((entry) => entry.row);
      const chains = config.chain ? await loadApprovalStepsFor(config.key, rows.map((row) => row.id)) : new Map<string, StepRow[]>();
      const eligibility = await eligibilityFor(context, rows, chains);
      const mine = entries.filter((entry) => eligibility.get(entry.row.id)?.eligible);
      return (await buildItems(context, mine, { chains, eligibility })).items;
    }

    if (query.tab === "requested" || query.tab === "history") {
      if (query.tab === "requested") base.push({ submittedByMemberId: me });
      else {
        const viewable = types.filter((type) => config.records[type].canView(context));
        if (!can(context, "approvals.history.view") || viewable.length === 0) return [];
        base.push({ recordType: { in: viewable } });
      }
      if (statuses.length > 0) base.push({ status: { in: statuses } });
      const range = dateRange(query);
      if (range) base.push({ submittedAt: range });
      return (await buildItems(context, await collectRows(context, query, base, "submittedAt", () => true))).items;
    }

    // Approved, rejected, returned: decisions this person took, or, on Returned, requests returned to them.
    const outcome = DECIDED_TAB_STATUS[query.tab]!;
    if (outcome === "RETURNED" && !returns) return [];
    const range = dateRange(query);
    if (statuses.length > 0 && !statuses.includes(outcome) && query.tab !== "returned") {
      // The tab's own outcome is the status; a contradictory filter matches nothing.
      return [];
    }
    const whose =
      query.tab === "returned" && query.returned === "to"
        ? [{ submittedByMemberId: me }]
        : query.tab === "returned" && query.returned === "all"
          ? [{ OR: [{ decidedByMemberId: me }, { submittedByMemberId: me }] }]
          : [{ decidedByMemberId: me }];
    const cycles = await collectRows(context, query, [...base, ...whose, { status: outcome }, ...(range ? [{ decidedAt: range }] : [])], "decidedAt", () => true);

    // A step of a chain decided by this person, while the cycle carried on or ended elsewhere.
    let stepEntries: Array<{ row: CycleRow; sortAt: Date }> = [];
    if (config.chain && !(query.tab === "returned" && query.returned === "to")) {
      const keyset = keysetWhere("decidedAt", config.key, query, "approvalId");
      const steps = await prisma.approvalStep.findMany({
        where: {
          AND: [
            { companyId: context.companyId, providerKey: config.key, decidedByMemberId: me, status: outcome },
            ...(range ? [{ decidedAt: range }] : []),
            ...(keyset ? [keyset] : []),
          ],
        },
        orderBy: [{ decidedAt: query.order }, { approvalId: query.order }],
        take: Math.min(WINDOW, query.limit * 2),
        select: { approvalId: true, decidedAt: true },
      });
      const known = new Set(cycles.map((entry) => entry.row.id));
      const wanted = steps.filter((step) => !known.has(step.approvalId));
      if (wanted.length > 0) {
        const rows = await config.table().findMany({
          where: { AND: [...base, { id: { in: wanted.map((step) => step.approvalId) } }] },
          select: CYCLE_SELECT,
        });
        const reachable = await reachableIds(context, rows);
        const byId = new Map(rows.map((row) => [row.id, row]));
        stepEntries = wanted.flatMap((step) => {
          const row = byId.get(step.approvalId);
          return row && reachable.has(`${row.recordType}:${row.recordId}`) ? [{ row, sortAt: step.decidedAt ?? row.submittedAt }] : [];
        });
      }
    }
    const merged = [...cycles, ...stepEntries].sort((a, b) => {
      const diff = a.sortAt.getTime() - b.sortAt.getTime() || a.row.id.localeCompare(b.row.id);
      return query.order === "desc" ? -diff : diff;
    });
    return (await buildItems(context, merged.slice(0, query.limit))).items;
  }

  async function loadVisibleRow(context: UserContext, approvalId: string): Promise<{ row: CycleRow; adapter: RecordAdapter } | null> {
    const row = await config.table().findFirst({ where: { id: approvalId, companyId: context.companyId }, select: CYCLE_SELECT });
    if (!row) return null;
    const adapter = adapterFor(row.recordType);
    if (!adapter) return null;
    if (!(await reachableIds(context, [row])).has(`${row.recordType}:${row.recordId}`)) return null;
    return { row, adapter };
  }

  async function detail(context: UserContext, approvalId: string): Promise<ProviderDetail | null> {
    const visible = await loadVisibleRow(context, approvalId);
    if (!visible) return null;
    const { row, adapter } = visible;

    const built = await buildItems(context, [{ row, sortAt: row.submittedAt }]);
    const item = built.items[0];
    if (!item) return null;
    const steps = built.chains.get(row.id) ?? [];
    const decidedAStep = steps.some((step) => step.decidedByMemberId === context.membershipId || step.onBehalfOfMemberId === context.membershipId);
    const mayOpen =
      row.submittedByMemberId === context.membershipId ||
      row.decidedByMemberId === context.membershipId ||
      decidedAStep ||
      adapter.canView(context) ||
      item.canApprove ||
      item.canReject;
    if (!mayOpen) return null;

    const fact = built.facts.get(`${row.recordType}:${row.recordId}`)!;
    const cycles = await config.table().findMany({
      where: { companyId: context.companyId, recordType: row.recordType, recordId: row.recordId },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      take: 50,
      select: CYCLE_SELECT,
    });
    const cycleSteps = config.chain ? await loadApprovalStepsFor(config.key, cycles.map((cycle) => cycle.id)) : new Map<string, StepRow[]>();
    const names = await memberNames(context.companyId, [
      ...cycles.flatMap((cycle) => [cycle.submittedByMemberId, cycle.decidedByMemberId]),
      ...[...cycleSteps.values()].flat().flatMap((step) => [step.decidedByMemberId, step.onBehalfOfMemberId]),
    ]);

    const history = cycleHistory(cycles, cycleSteps, names);
    const current = currentStepOf(steps);
    const sequence = steps.length > 1;
    const stepDTOs: ApprovalStepDTO[] = (sequence ? steps : []).map((step) => ({
      number: step.stepNumber,
      label: step.label,
      status: step.status === "PENDING" ? (current?.id === step.id ? "PENDING" : "WAITING") : step.status,
      decidedBy: step.decidedByMemberId ? personOrUnknown(names, step.decidedByMemberId).name : null,
      decidedAt: step.decidedAt?.toISOString() ?? null,
      onBehalfOf: step.onBehalfOfMemberId ? personOrUnknown(names, step.onBehalfOfMemberId).name : null,
    }));

    const warnings = [...(fact.warnings ?? [])];
    if (row.status === "PENDING" && row.submittedByMemberId === context.membershipId && !item.canApprove) {
      warnings.push({ code: "SELF_APPROVAL_BLOCKED", message: "You requested this, so somebody else has to decide it.", severity: "INFO" });
    }
    if (item.onBehalfOf) {
      warnings.push({ code: "DELEGATED", message: `You would decide this on behalf of ${item.onBehalfOf.name}, under their delegation.`, severity: "INFO" });
    }

    const documents = await approvalDocuments(context, adapter.recordType, row.recordId);
    const definition = recordDefinition(adapter.recordType);
    const discussion = definition?.collaboration ? { parentType: adapter.recordType, parentId: row.recordId } : null;

    return {
      item,
      // The chain written when it was submitted is what it needs, whatever the policy says today.
      reason:
        sequence
          ? `${fact.reason ?? adapter.reason} Decisions, in order: ${steps.map((step) => step.label).join(" → ")}.`
          : (fact.reason ?? adapter.reason),
      summary: fact.summary,
      description: fact.description ?? null,
      warnings,
      documents: documents.documents,
      documentsAvailable: documents.available,
      history,
      chainMode: sequence ? "SEQUENTIAL" : "SINGLE",
      completionRule: null,
      steps: stepDTOs,
      commentsEnabled: Boolean(discussion),
      discussion,
      sourceRecord: { label: `Open full ${adapter.noun.toLowerCase()}`, href: fact.href },
    };
  }

  async function findByRecord(context: UserContext, recordType: string, recordId: string): Promise<string | null> {
    const matching = types.filter((type) => config.records[type].recordType === recordType);
    if (matching.length === 0) return null;
    const rows = await config.table().findMany({
      where: { companyId: context.companyId, recordType: { in: matching }, recordId },
      orderBy: [{ submittedAt: "desc" }],
      take: 10,
      select: CYCLE_SELECT,
    });
    if (rows.length === 0) return null;
    if (!(await reachableIds(context, rows.slice(0, 1))).size) return null;
    return (rows.find((row) => row.status === "PENDING") ?? rows[0]).id;
  }

  async function decide(
    context: UserContext,
    approvalId: string,
    decision: ApprovalDecision,
    input: { note: string | null; expectedVersion?: number },
  ): Promise<{ outcome: ApprovalDecisionOutcome; alreadyApplied: boolean }> {
    const visible = await loadVisibleRow(context, approvalId);
    if (!visible) throw notFound();
    const { row, adapter } = visible;
    const wanted: CycleStatus = decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "RETURNED";
    if (decision !== "APPROVE" && !input.note?.trim()) {
      throw approvalError("APPROVAL_REASON_REQUIRED", "Give a reason.", "VALIDATION_ERROR");
    }

    if (row.status !== "PENDING") {
      // The same person asking for the same outcome again gets the answer, not a second decision (§124).
      if (row.decidedByMemberId === context.membershipId && row.status === wanted) return { outcome: wanted, alreadyApplied: true };
      const newer = await config.table().count({ where: { companyId: context.companyId, recordType: row.recordType, recordId: row.recordId, status: "PENDING" } });
      throw newer > 0
        ? approvalError("APPROVAL_SOURCE_CHANGED", "This request was resubmitted since you opened it. Review the latest version.")
        : approvalError("APPROVAL_ALREADY_DECIDED", "This approval was already decided.");
    }

    const steps = config.chain ? ((await loadApprovalStepsFor(config.key, [row.id])).get(row.id) ?? []) : [];
    const current = currentStepOf(steps);
    const version = 1 + steps.filter((step) => step.status !== "PENDING").length;
    if (decision === "APPROVE" && steps.some((step) => step.status === "APPROVED" && step.decidedByMemberId === context.membershipId) && input.expectedVersion === version - 1) {
      return { outcome: "STEP_APPROVED", alreadyApplied: true };
    }
    if (input.expectedVersion !== undefined && input.expectedVersion !== version) {
      throw approvalError("APPROVAL_SOURCE_CHANGED", "This approval moved on since you opened it. Review the latest version.");
    }
    if (steps.length === 0 && row.submittedByMemberId === context.membershipId && !selfAllowed(context, adapter)) {
      throw approvalError("APPROVAL_SELF_APPROVAL_BLOCKED", "You requested this, so somebody else has to decide it.", "FORBIDDEN");
    }

    const guard: ApprovalGuard = { approvalId: row.id, ...(current ? { stepNumber: current.stepNumber } : {}) };
    try {
      if (decision === "APPROVE") await adapter.approve(context, row.recordId, input.note, guard);
      else if (decision === "REJECT") {
        if (!adapter.reject) throw approvalError("APPROVAL_REJECT_NOT_SUPPORTED", `A ${adapter.noun.toLowerCase()} is not rejected here; open it to act on it.`, "VALIDATION_ERROR");
        await adapter.reject(context, row.recordId, input.note ?? "", guard);
      } else {
        if (!adapter.returnForRevision) throw approvalError("APPROVAL_RETURN_NOT_SUPPORTED", `A ${adapter.noun.toLowerCase()} cannot be returned for revision.`, "VALIDATION_ERROR");
        await adapter.returnForRevision(context, row.recordId, input.note ?? "", guard);
      }
    } catch (error) {
      translateSourceError(error);
    }

    if (decision === "APPROVE" && steps.length > 0) {
      const after = await config.table().findFirst({ where: { id: row.id }, select: CYCLE_SELECT });
      if (after?.status === "PENDING") return { outcome: "STEP_APPROVED", alreadyApplied: false };
    }
    return { outcome: wanted, alreadyApplied: false };
  }

  return {
    key: config.key,
    moduleKey: config.moduleKey,
    label: config.label,
    recordTypes: [...new Set(Object.values(config.records).map((adapter) => adapter.recordType))],
    available: (context) => isModuleEnabled(context, config.moduleKey) && canAccessModule(context, config.moduleKey),
    queue,
    detail,
    findByRecord,
    decide,
  };
}

/** The decision trail of every cycle on a record, oldest first (PRD #41 §53, §54, §210). */
function cycleHistory(cycles: CycleRow[], chains: Map<string, StepRow[]>, names: Map<string, ApprovalPerson>): UnifiedApprovalHistoryEntry[] {
  const entries: UnifiedApprovalHistoryEntry[] = [];
  cycles.forEach((cycle, index) => {
    entries.push({
      id: `${cycle.id}:requested`,
      action: index === 0 ? "Requested" : "Resubmitted",
      actorName: personOrUnknown(names, cycle.submittedByMemberId).name,
      actorRole: null,
      occurredAt: cycle.submittedAt.toISOString(),
      note: null,
      step: null,
      tone: "info",
    });
    const steps = chains.get(cycle.id) ?? [];
    // A one-step chain reads as a plain decision: the step line is the decision, with its note.
    const single = steps.length === 1;
    let decidedByStep = false;
    for (const step of steps) {
      if (step.status === "PENDING" || step.status === "CANCELLED" || step.status === "SKIPPED" || !step.decidedAt) continue;
      const verb = step.status === "APPROVED" ? "approved" : step.status === "REJECTED" ? "rejected" : "returned";
      const actor = personOrUnknown(names, step.decidedByMemberId).name;
      decidedByStep = true;
      entries.push({
        id: `${step.id}:decided`,
        action: single ? (step.status === "APPROVED" ? "Approved" : step.status === "REJECTED" ? "Rejected" : "Returned for revision") : `${step.label} ${verb}`,
        actorName: step.onBehalfOfMemberId ? `${actor}, for ${personOrUnknown(names, step.onBehalfOfMemberId).name}` : actor,
        actorRole: null,
        occurredAt: step.decidedAt.toISOString(),
        note: step.decisionNote,
        step: single ? null : step.stepNumber,
        tone: step.status === "APPROVED" ? "success" : step.status === "REJECTED" ? "danger" : "warning",
      });
    }
    if (cycle.status === "PENDING") {
      const current = currentStepOf(steps);
      entries.push({
        id: `${cycle.id}:pending`,
        action: current && !single ? `${current.label} pending` : "Awaiting decision",
        actorName: null,
        actorRole: null,
        occurredAt: (steps.filter((step) => step.decidedAt).at(-1)?.decidedAt ?? cycle.submittedAt).toISOString(),
        note: null,
        step: single ? null : (current?.stepNumber ?? null),
        tone: "neutral",
      });
      return;
    }
    const final: Record<Exclude<CycleStatus, "PENDING">, { action: string; tone: UnifiedApprovalHistoryEntry["tone"] }> = {
      APPROVED: { action: steps.length > 0 ? "Final approval" : "Approved", tone: "success" },
      REJECTED: { action: "Rejected", tone: "danger" },
      RETURNED: { action: "Returned for revision", tone: "warning" },
      CANCELLED: { action: "Withdrawn", tone: "neutral" },
    };
    if (single && decidedByStep) return;
    // In a chain the step already carries the decider's note; the final line only closes the cycle.
    entries.push({
      id: `${cycle.id}:closed`,
      action: final[cycle.status].action,
      actorName: cycle.decidedByMemberId ? personOrUnknown(names, cycle.decidedByMemberId).name : null,
      actorRole: null,
      occurredAt: (cycle.decidedAt ?? cycle.submittedAt).toISOString(),
      note: steps.length > 0 ? null : cycle.decisionNote,
      step: null,
      tone: final[cycle.status].tone,
    });
  });
  return entries;
}
