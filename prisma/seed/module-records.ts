/**
 * Module test records (PRD #9 §67–§87).
 *
 * Every department module now has a domain of its own, so what is left here is
 * the platform's own support queue — the last thing still on the generic record
 * shell, and the reason the shell's machinery is still worth keeping
 * (PRD #9 §252).
 */
import type { PrismaClient } from "@prisma/client";

import { COMPANY_A, type SeedMembers } from "./constants";

type Members = SeedMembers;

export async function seedModuleRecords(prisma: PrismaClient, members: Members) {
  // Finance has its own seed now (prisma/seed/finance.ts): invoices with line
  // items, expenses, payments, budgets, commitments and approvals (PRD #15 §328).
  // HR has its own seed now (prisma/seed/hr.ts): employment records,
  // compensation, leave with balances, and attendance (PRD #16 §327).
  // Sales has its own seed now (prisma/seed/sales.ts): leads, opportunities,
  // proposals with line items, approvals, tasks and documents (PRD #17 §301).
  // Legal has its own seed now (prisma/seed/contracts.ts): contracts with
  // parties, obligations, amendments, approvals, tasks and documents
  // (PRD #18 §406).
  // Procurement has its own seed now (prisma/seed/procurement.ts): suppliers,
  // requests with items, RFQs with quotes, orders, receipts and approvals
  // (PRD #19 §440).
  // Inventory has its own seed now (prisma/seed/inventory.ts): items,
  // warehouses, locations, a movement ledger and the balances projected from it
  // (PRD #20 §301).
  // QA/QC has its own seed now (prisma/seed/qaqc.ts): templates with real
  // checklists, inspections at every stage, material decisions that balance,
  // defects, NCRs and the corrective actions that let them close (PRD #21 §342).
  // HSE has its own seed now (prisma/seed/hse.ts): checklists, inspections at
  // every stage, hazards scored on the 5×5 matrix, incidents and near misses,
  // risk assessments, permits, toolbox talks, PPE checks and stop-work
  // (PRD #22 §374). It was the last department module on this shell.
  await seedSupport(prisma, members);
}

/* Support — 3 requests (PRD #9 §87) ---------------------------------------- */

const SUPPORT = [
  { reference: "SUP-001", subject: "Password reset for site engineer", status: "RESOLVED", user: "user_it" },
  { reference: "SUP-002", subject: "Request access to Procurement module", status: "OPEN", user: "user_pm" },
  { reference: "SUP-003", subject: "Laptop replacement — Architecture", status: "IN_PROGRESS", user: "user_architect" },
] as const;

async function seedSupport(prisma: PrismaClient, members: Members) {
  let index = 0;
  for (const request of SUPPORT) {
    index += 1;
    const id = `support_${index.toString().padStart(3, "0")}`;
    await prisma.supportRequest.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: COMPANY_A,
        requestedMemberId: members.get(request.user)!,
        reference: request.reference,
        subject: request.subject,
        body: "Seeded support request used to exercise the Support module shell.",
        status: request.status,
        createdBy: request.user,
      },
    });
  }
}
