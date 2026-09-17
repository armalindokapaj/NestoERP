import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordSystemAction } from "@/lib/core/audit/audit.service";
import { jobStopRequested } from "@/lib/core/jobs/job.context";
import { JobError } from "@/lib/core/jobs/job.errors";
import { claimIdempotencyKey, idempotencyKeyClaimed } from "@/lib/core/jobs/job.idempotency";
import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import { companyDays } from "@/lib/core/notifications/company-day";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { businessDateString } from "../finance.fields";
import { toAmountString } from "../finance.money";
import { paidByInstallment } from "../finance.settlement";
import { contractFinanceFacts } from "./unit-finance.core";
import { saleAudience } from "./unit-finance.events";
import { DUE_SOON_DAYS } from "./unit-finance.types";

/**
 * Job `finance.unit-installments` (E-05F §94-§96): once an hour, per company, the
 * installments of every active schedule on a signed or active sale contract are
 * read against the company's day. One falling due within seven days is announced
 * once per due date; one past due and not paid in full is announced once, and
 * when it is the contract's first overdue installment the unit's financial status
 * change to Overdue is audited as the system.
 *
 * Nothing is written to the installments: overdue is derived from the due date
 * and the money allocated, so the page, the inventory and this job agree without
 * it (§22, §96). A second run finds every notice claimed; an installment paid a
 * moment before the job reached it is skipped.
 */

export const JOB = "finance.unit-installments";
const BATCH = 200;
const DAY = 86_400_000;

type Row = {
  id: string;
  label: string;
  amount: import("@prisma/client").Prisma.Decimal;
  currency: string;
  dueDate: Date;
  contractId: string;
  schedule: { activatedByMemberId: string | null };
};

async function contractContext(companyId: string, contractId: string) {
  return prisma.contract.findFirst({
    where: { companyId, id: contractId },
    select: { id: true, contractNumber: true, projectId: true, units: { where: { releasedAt: null }, orderBy: { createdAt: "asc" }, select: { unitId: true, unit: { select: { unitCode: true, projectId: true } } } } },
  });
}

async function notice(companyId: string, row: Row, kind: "overdue" | "due", today: Date): Promise<boolean> {
  const key = kind === "overdue" ? `overdue:${row.id}` : `due:${row.id}:${businessDateString(row.dueDate)}`;
  const claim = { companyId, jobKey: JOB, key };
  if (await idempotencyKeyClaimed(prisma, claim)) return false;
  const contract = await contractContext(companyId, row.contractId);
  const first = contract?.units[0];
  if (!contract || !first) return false;

  return prisma.$transaction(async (tx) => {
    if (!(await claimIdempotencyKey(tx, claim))) return false;
    const memberIds = [...new Set([row.schedule.activatedByMemberId, ...(await saleAudience(tx, companyId, contract.units.map((unit) => unit.unitId)))].filter((id): id is string => Boolean(id)))];
    const days = Math.round((row.dueDate.getTime() - today.getTime()) / DAY);
    if (memberIds.length > 0) {
      await enqueueNotificationEvent(tx, {
        companyId,
        eventType: kind === "overdue" ? NotificationEvent.UNIT_INSTALLMENT_OVERDUE : NotificationEvent.UNIT_INSTALLMENT_DUE_SOON,
        moduleKey: "projects",
        entityType: "project_unit",
        entityId: first.unitId,
        actorMemberId: null,
        projectId: first.unit.projectId,
        payload: {
          memberIds,
          installmentId: row.id,
          installmentLabel: row.label,
          unitCode: contract.units.map((unit) => unit.unit.unitCode).join(", "),
          contractNumber: contract.contractNumber,
          dueDate: businessDateString(row.dueDate),
          dueLabel: days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`,
        },
      });
    }
    if (kind === "overdue") {
      // The unit became Overdue when its earliest overdue installment fell due: audited once for that
      // episode, whichever of its overdue installments the run reaches first (§40, §97).
      const facts = (await contractFinanceFacts(tx, companyId, [contract.id], today)).get(contract.id);
      const earliest = facts?.currentInstallments.find((installment) => installment.status === "OVERDUE");
      if (facts?.financialStatus === "OVERDUE" && earliest && (await claimIdempotencyKey(tx, { companyId, jobKey: JOB, key: `overdue-status:${contract.id}:${earliest.id}` }))) {
        await recordSystemAction(
          companyId,
          {
            actionKey: AuditAction.UNIT_FINANCIAL_STATUS_CHANGED,
            entity: { type: "Contract", id: contract.id, label: contract.contractNumber },
            projectId: contract.projectId,
            before: { contractId: contract.id },
            after: { contractId: contract.id, financialStatus: "OVERDUE", paid: toAmountString(facts.paid), outstanding: toAmountString(facts.outstanding), overdue: toAmountString(facts.overdue), currency: facts.currency },
          },
          { tx },
        );
      }
    }
    return true;
  });
}

export async function runUnitInstallmentNotices(now = new Date()): Promise<{ overdue: number; dueSoon: number }> {
  const counts = { overdue: 0, dueSoon: 0 };
  const run = await forEachCompany(
    JOB,
    async ({ companyId }) => {
      // Units live in Projects and their money in Finance: a company with either switched off is not announced to.
      if (!(await prisma.companyModule.findFirst({ where: { companyId, enabled: true, module: { key: "projects" } }, select: { id: true } }))) return;
      const today = (await companyDays(companyId))(now).start;
      const horizon = new Date(today.getTime() + (DUE_SOON_DAYS + 1) * DAY);
      let failed = 0;
      for (let after: string | undefined; !jobStopRequested(); ) {
        const rows = (await prisma.paymentInstallment.findMany({
          where: {
            companyId,
            dueDate: { lt: horizon },
            // An active schedule of a contract still owed and still selling a unit (§82, §85).
            schedule: { is: { status: "ACTIVE", contract: { is: { status: { in: ["SIGNED", "ACTIVE"] }, units: { some: { releasedAt: null } } } } } },
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: "asc" },
          take: BATCH,
          select: { id: true, label: true, amount: true, currency: true, dueDate: true, contractId: true, schedule: { select: { activatedByMemberId: true } } },
        })) as Row[];
        const paid = await paidByInstallment(rows.map((row) => row.id));
        for (const row of rows) {
          const settled = paid.get(row.id);
          if (settled && settled.greaterThanOrEqualTo(row.amount)) continue;
          const kind = row.dueDate.getTime() < today.getTime() ? "overdue" : "due";
          try {
            if (await notice(companyId, row, kind, today)) counts[kind === "overdue" ? "overdue" : "dueSoon"] += 1;
          } catch (error) {
            failed += 1;
            logger.error(`${JOB}.item_failed`, { companyId, installmentId: row.id, ...serialiseError(error) });
          }
        }
        if (rows.length < BATCH) break;
        after = rows[rows.length - 1]!.id;
      }
      if (failed) throw new JobError("PARTIAL_FAILURE", `${failed} installment notices could not be sent`);
    },
    { moduleKey: "finance" },
  );
  if (counts.overdue) incrementCounter(Metric.UNIT_INSTALLMENTS_OVERDUE, {}, counts.overdue);
  if (counts.dueSoon) incrementCounter(Metric.UNIT_INSTALLMENTS_DUE_SOON, {}, counts.dueSoon);
  assertEveryCompanySucceeded(JOB, run);
  return counts;
}
