import type { EmploymentType, Prisma, WorkerCategory } from "@prisma/client";

import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { todayDay, type Day } from "../employment/employment.dates";
import { startHistory, syncCache } from "../employment/employment.history";

/**
 * HR's door for employees added in bulk (E-04 §93-§98, ADR 0006).
 *
 * The import decides which rows are good and in what order; the employment is
 * still HR's, made here the way HR makes one by hand: a new person of the
 * group, an employment of this company with its first history rows, and the
 * audit of both. No login is created — an account is asked for afterwards,
 * one employee at a time (§98). Somebody whose start date has come is employed
 * from it; a later one is planned until then.
 */
export type ImportedEmployee = {
  firstName: string;
  lastName: string;
  employeeNumber: string | null;
  employmentType: EmploymentType;
  workerCategory: WorkerCategory | null;
  tradeId: string | null;
  jobTitle: string | null;
  departmentId: string | null;
  workPhone: string | null;
  startDate: Day;
};

export async function createImportedEmployment(tx: Prisma.TransactionClient, context: UserContext, row: ImportedEmployee, batchId: string): Promise<{ employmentId: string; personId: string }> {
  const name = `${row.firstName} ${row.lastName}`;
  const person = await tx.personProfile.create({
    data: {
      parentGroupId: context.parentGroupId,
      firstName: row.firstName,
      lastName: row.lastName,
      jobTitle: row.jobTitle,
      workPhone: row.workPhone,
      lifecycleStatus: "EMPLOYEE",
      createdByUserId: context.userId,
    },
    select: { id: true },
  });
  const employment = await tx.employeeProfile.create({
    data: {
      companyId: context.companyId,
      personProfileId: person.id,
      employeeNumber: row.employeeNumber,
      employmentStatus: "PLANNED",
      employmentType: row.employmentType,
      workerCategory: row.workerCategory,
      tradeId: row.tradeId,
      createdByMemberId: context.membershipId,
    },
    select: { id: true },
  });
  const started = row.startDate <= todayDay();
  await startHistory(tx, {
    employmentId: employment.id,
    companyId: context.companyId,
    placement: { departmentId: row.departmentId, jobTitle: row.jobTitle, managerMemberId: null, workLocationType: null, workLocation: null, employmentType: row.employmentType },
    start: row.startDate,
    status: started ? "ACTIVE" : "PLANNED",
    statusFrom: started ? row.startDate : todayDay(),
    assignmentReason: "HIRE",
    statusReason: "HIRE",
    source: "CHANGE",
    actorUserId: context.userId,
  });
  await syncCache(tx, { id: employment.id, companyId: context.companyId }, { actorMemberId: context.membershipId });

  await recordUserAction(context, { actionKey: AuditAction.HR_PERSON_PROFILE_CREATED, entity: { type: "PersonProfile", id: person.id, label: name }, after: { lifecycleStatus: "EMPLOYEE" }, metadata: { importBatchId: batchId } }, { tx });
  await recordUserAction(
    context,
    {
      actionKey: AuditAction.HR_EMPLOYEE_CREATED,
      entity: { type: "EmployeeProfile", id: employment.id, label: name },
      after: { employmentStatus: started ? "ACTIVE" : "PLANNED", personProfileId: person.id, departmentId: row.departmentId },
      metadata: { importBatchId: batchId },
    },
    { tx },
  );
  return { employmentId: employment.id, personId: person.id };
}
