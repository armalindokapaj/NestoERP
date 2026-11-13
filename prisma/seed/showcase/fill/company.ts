/**
 * The companies' own books and people. A current budget on every project at
 * a believable cost per m², the costs booked against it (supplier bills for
 * each delivery, monthly subcontract valuations, site overheads) and the
 * payments that settled them; each office's timesheets, leave and
 * attendance; and the site workforce — trades, crews and workers on every
 * building project, with who was on site each day.
 */
import type { FinanceCostCategory, Prisma, PrismaClient } from "@prisma/client";

import { SHOWCASE_GROUP } from "../dataset";
import { at, businessDay, castOf, dec, EUR, Numbers, random, round2, type Cast, type Clock } from "./kit";
import { PROJECT_DATES } from "./sales";

const VAT = 0.2;

/** Cost per m² of built area, and how it splits by category. */
const COST_PER_M2: Record<string, number> = {
  project_a: 780,
  project_b: 900,
  project_c: 420,
  project_d: 820,
  project_e: 1050,
  project_showcase_promenada: 760,
  project_showcase_kodra: 900,
  project_showcase_rinas: 850,
};
const SPLIT: Array<{ category: FinanceCostCategory; description: string; share: number }> = [
  { category: "SUBCONTRACTOR", description: "Subcontracts: MEP, façade, lifts, earthworks", share: 0.44 },
  { category: "MATERIALS", description: "Materials: concrete, steel, blocks, finishes", share: 0.3 },
  { category: "LABOR", description: "Own labour and site management", share: 0.1 },
  { category: "EQUIPMENT", description: "Cranes, hoists and plant", share: 0.06 },
  { category: "SERVICES", description: "Design, supervision, testing and permits", share: 0.05 },
  { category: "ADMINISTRATION", description: "Insurance, guarantees and site office", share: 0.02 },
  { category: "OTHER", description: "Contingency", share: 0.03 },
];

const TRADES = ["Formwork carpenters", "Steel fixers", "Concrete crew", "Masons", "Electricians", "Plumbers", "General labour"];
const WORKER_FIRST = ["Agim", "Bujar", "Dashamir", "Fatmir", "Gjergj", "Hysen", "Ilirjan", "Kujtim", "Lulzim", "Mehmet", "Naim", "Petrit", "Qemal", "Ramadan", "Shpëtim", "Vladimir", "Xhevdet", "Ylber", "Zenel", "Arjan", "Besnik", "Edmond", "Fation", "Genc"];
const WORKER_LAST = ["Hoxhaj", "Kola", "Muça", "Dauti", "Gjoni", "Kryemadhi", "Lleshi", "Mema", "Osmani", "Rrapaj", "Shkurti", "Tahiri", "Vata", "Zeneli", "Bushi", "Dervishi", "Kaçi", "Nela"];

const WORKFORCE_PROJECTS = ["project_b", "project_c", "project_d", "project_e", "project_showcase_promenada"];

export async function seedShowcaseCompany(prisma: PrismaClient, clock: Clock) {
  const numbers = new Numbers(prisma);
  const totals = { budgets: 0, expenses: 0, disbursements: 0, timesheets: 0, workLogs: 0, leave: 0, attendance: 0, workers: 0, crews: 0 };

  /* Budgets and costs --------------------------------------------------------- */
  for (const [projectId, perM2] of Object.entries(COST_PER_M2)) {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { companyId: true, builtArea: true, name: true } });
    const cast = await castOf(prisma, project.companyId!);
    const total = Math.round((Number(project.builtArea ?? 30000) * perM2) / 10000) * 10000;
    const previous = await prisma.projectBudget.aggregate({ where: { projectId }, _max: { version: true } });
    await prisma.projectBudget.updateMany({ where: { projectId }, data: { isCurrent: false } });
    const design = projectId === "project_showcase_rinas";
    const dates = PROJECT_DATES[projectId]!;
    await prisma.projectBudget.create({
      data: {
        companyId: cast.companyId, projectId, version: (previous._max.version ?? 0) + 1, name: design ? "Feasibility budget" : "Approved construction budget", currency: EUR, status: design ? "DRAFT" : "APPROVED", isCurrent: true, totalAmount: dec(total),
        notes: design ? "From the feasibility model; to be firmed up after the concept design." : `${project.name} at €${perM2}/m² of built area, approved by the board.`,
        approvedByMemberId: design ? null : cast.member("ceo"), approvedAt: design ? null : at(clock, Math.min(-5, dates.start - 20)), createdByMemberId: cast.member("finance"), createdAt: at(clock, Math.min(-6, dates.start - 25)),
        lineItems: { create: SPLIT.map((line, index) => ({ category: line.category, description: line.description, plannedAmount: dec(Math.round(total * line.share)), sortOrder: index + 1 })) },
      },
    });
    totals.budgets += 1;
  }

  // Supplier bills for every delivery, paid on their terms once due.
  const receipts = await prisma.goodsReceipt.findMany({ where: { status: "RECORDED", purchaseOrder: { id: { startsWith: "po_" } } }, select: { id: true, companyId: true, projectId: true, receiptDate: true, supplier: { select: { name: true, paymentTermsDays: true } }, purchaseOrder: { select: { poNumber: true, subtotal: true } }, items: { select: { acceptedQuantity: true, purchaseOrderItem: { select: { quantity: true } } } } } });
  for (const receipt of receipts) {
    const cast = await castOf(prisma, receipt.companyId);
    const share = receipt.items.reduce((sum, item) => sum + Number(item.acceptedQuantity), 0) / Math.max(1, receipt.items.reduce((sum, item) => sum + Number(item.purchaseOrderItem.quantity), 0));
    const net = round2(Number(receipt.purchaseOrder.subtotal) * share);
    const billed = Math.round((receipt.receiptDate.getTime() - clock.now.getTime()) / 86_400_000) + 3;
    await expense(cast, receipt.projectId, billed, "MATERIALS", `Invoice for ${receipt.purchaseOrder.poNumber}`, receipt.supplier.name, net, billed + (receipt.supplier.paymentTermsDays ?? 30));
  }

  // Monthly valuations on every running subcontract.
  const subcontracts = await prisma.contract.findMany({ where: { contractType: "SUBCONTRACT", status: { in: ["ACTIVE", "COMPLETED"] }, id: { startsWith: "contract_" } }, select: { companyId: true, projectId: true, contractNumber: true, contractValue: true, counterpartyName: true, signedDate: true, status: true } });
  for (const contract of subcontracts) {
    const cast = await castOf(prisma, contract.companyId);
    const signed = Math.round((contract.signedDate!.getTime() - clock.now.getTime()) / 86_400_000);
    const months = Math.max(1, Math.floor(-signed / 30));
    const value = Number(contract.contractValue);
    const monthly = contract.status === "COMPLETED" ? value / months : (value * 0.75) / Math.max(months, 10);
    for (let month = 1; month <= Math.min(months, 10); month += 1) {
      const day = signed + month * 30;
      if (day > -2) break;
      await expense(cast, contract.projectId, day, "SUBCONTRACTOR", `Valuation ${month} — ${contract.contractNumber}`, contract.counterpartyName ?? "Subcontractor", round2(monthly * (0.85 + ((month * 7) % 5) / 10) * 0.95), day + 45);
    }
  }

  // Kodra Villas, handed over in 2023: what it cost, paid in full.
  {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: "project_showcase_kodra" }, select: { companyId: true, builtArea: true } });
    const cast = await castOf(prisma, project.companyId!);
    const total = Number(project.builtArea ?? 9800) * COST_PER_M2.project_showcase_kodra! * 0.97;
    const dates = PROJECT_DATES.project_showcase_kodra!;
    for (const line of SPLIT.filter((row) => row.category !== "OTHER")) {
      for (let part = 0; part < 4; part += 1) {
        const day = Math.round(dates.start + ((dates.end - dates.start) * (part + 1)) / 5);
        await expense(cast, "project_showcase_kodra", day, line.category, `${line.description.split(":")[0]} — stage ${part + 1}`, line.category === "SUBCONTRACTOR" ? "Instal Termo" : line.category === "MATERIALS" ? "Ferro Adriatik" : "Various", round2((total * line.share) / 4 / (1 + VAT)), day + 30);
      }
    }
  }

  // Site overheads: utilities and security, monthly.
  for (const projectId of WORKFORCE_PROJECTS) {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { companyId: true } });
    const cast = await castOf(prisma, project.companyId!);
    for (let month = 1; month <= 6; month += 1) {
      await expense(cast, projectId, -month * 30, "SERVICES", "Site electricity and water", "OSHEE / UKT", 1850 + month * 40, -month * 30 + 20);
      await expense(cast, projectId, -month * 30 + 2, "SERVICES", "Site security, monthly", "Roja Siguri", 2400, -month * 30 + 30);
    }
  }

  /* Office time: timesheets, leave, attendance ------------------------------------ */
  for (const companyId of ["company_demo_b", "company_demo_c", "company_demo_d", "company_demo_e"]) {
    const cast = await castOf(prisma, companyId);
    const rand = random(`time:${companyId}`);
    const profiles = await prisma.employeeProfile.findMany({ where: { companyId, companyMemberId: { not: null } }, select: { id: true, companyMemberId: true } });
    const projects = await prisma.project.findMany({ where: { companyId, status: "ACTIVE" }, select: { id: true } });
    const approver = (memberId: string) => (memberId === cast.member("ceo") ? cast.member("owner") : cast.member("ceo"));
    for (const profile of profiles) {
      const memberId = profile.companyMemberId!;
      await prisma.timesheetApproverAssignment.upsert({ where: { memberId }, update: {}, create: { companyId, memberId, approverMemberId: approver(memberId) } });
      // Four weeks of timesheets: three approved, this week's still a draft.
      const monday = -((clock.now.getUTCDay() + 6) % 7);
      for (let week = 3; week >= 0; week -= 1) {
        const start = monday - week * 7;
        const status = week === 0 ? "DRAFT" : week === 1 ? "SUBMITTED" : "APPROVED";
        const timesheet = await prisma.timesheet.create({
          data: { companyId, memberId, periodStart: businessDay(clock, start), periodEnd: businessDay(clock, start + 6), status, approverMemberId: approver(memberId), submittedAt: status === "DRAFT" ? null : at(clock, start + 4, 17), submittedByMemberId: status === "DRAFT" ? null : memberId, approvedAt: status === "APPROVED" ? at(clock, start + 7, 10) : null, approvedByMemberId: status === "APPROVED" ? approver(memberId) : null, submissionVersion: status === "DRAFT" ? 0 : 1, createdAt: at(clock, start, 9) },
          select: { id: true },
        });
        const logs: Prisma.WorkLogCreateManyInput[] = [];
        for (let day = 0; day < 5; day += 1) {
          if (start + day > 0) break;
          const projectId = projects.length ? rand.pick(projects).id : null;
          logs.push({ companyId, timesheetId: timesheet.id, memberId, workDate: businessDay(clock, start + day), projectId, workType: projectId ? "PROJECT_WORK" : "INTERNAL", minutes: rand.pick([360, 390, 420]), description: rand.pick(["Site coordination", "Progress review and look-ahead", "Drawings and RFIs", "Procurement follow-up", "Valuations and cost report", "Sales and buyer meetings"]), billable: false, createdByMemberId: memberId });
          logs.push({ companyId, timesheetId: timesheet.id, memberId, workDate: businessDay(clock, start + day), workType: "ADMIN", minutes: rand.pick([60, 90, 120]), description: "Email and reporting", billable: false, createdByMemberId: memberId });
        }
        if (logs.length) await prisma.workLog.createMany({ data: logs });
        totals.workLogs += logs.length;
        if (status !== "DRAFT") await prisma.timesheetApproval.create({ data: { companyId, recordType: "TIMESHEET", recordId: timesheet.id, status: status === "APPROVED" ? "APPROVED" : "PENDING", submissionVersion: 1, approverMemberId: approver(memberId), submittedByMemberId: memberId, submittedAt: at(clock, start + 4, 17), decidedByMemberId: status === "APPROVED" ? approver(memberId) : null, decidedAt: status === "APPROVED" ? at(clock, start + 7, 10) : null } });
        totals.timesheets += 1;
      }

      // Annual leave: a balance, a week taken in summer, one request waiting.
      const year = clock.now.getUTCFullYear();
      await prisma.leaveBalance.upsert({ where: { employeeProfileId_leaveType_year: { employeeProfileId: profile.id, leaveType: "ANNUAL", year } }, update: {}, create: { companyId, employeeProfileId: profile.id, companyMemberId: memberId, leaveType: "ANNUAL", year, entitledDays: dec(20), usedDays: dec(7) } });
      await prisma.leaveRequest.create({ data: { companyId, employeeProfileId: profile.id, companyMemberId: memberId, leaveType: "ANNUAL", startDate: businessDay(clock, -110), endDate: businessDay(clock, -104), days: dec(5), reason: "Summer holiday", status: "APPROVED", submittedAt: at(clock, -140), approvedAt: at(clock, -138), approvedByMemberId: approver(memberId), createdByMemberId: memberId } });
      if (rand.chance(0.5)) await prisma.leaveRequest.create({ data: { companyId, employeeProfileId: profile.id, companyMemberId: memberId, leaveType: "ANNUAL", startDate: businessDay(clock, 40), endDate: businessDay(clock, 44), days: dec(4), reason: "Christmas and New Year", status: "PENDING", submittedAt: at(clock, -2), createdByMemberId: memberId } });
      totals.leave += 1;

      // The last two weeks in the office or on site.
      const records: Prisma.AttendanceRecordCreateManyInput[] = [];
      for (let day = -13; day <= -1; day += 1) {
        const date = businessDay(clock, day);
        if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
        records.push({ companyId, employeeProfileId: profile.id, companyMemberId: memberId, date, status: rand.chance(0.05) ? "ABSENT" : "PRESENT", checkIn: at(clock, day, 8), checkOut: at(clock, day, 17), workedMinutes: 480, source: "SELF", createdByMemberId: memberId });
      }
      await prisma.attendanceRecord.createMany({ data: records, skipDuplicates: true });
      totals.attendance += records.length;
    }
  }

  /* Site workforce --------------------------------------------------------------- */
  const workerRand = random("workers");
  const usedNames = new Set<string>();
  for (const projectId of WORKFORCE_PROJECTS) {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { companyId: true, code: true, name: true, address: true, city: true } });
    const companyId = project.companyId!;
    const cast = await castOf(prisma, companyId);
    const trades = new Map<string, string>();
    for (const [index, name] of TRADES.entries()) {
      const trade = await prisma.workforceTrade.upsert({ where: { companyId_name: { companyId, name } }, update: {}, create: { companyId, name, code: name.slice(0, 3).toUpperCase(), sortOrder: index + 1, createdByMemberId: cast.member("hr") }, select: { id: true } });
      trades.set(name, trade.id);
    }
    const site = await prisma.projectSite.create({ data: { companyId, projectId, name: `${project.name} — main site`, code: project.code, address: project.address, city: project.city, status: "ACTIVE", createdByMemberId: cast.member("pm") }, select: { id: true } });
    const existing = await prisma.employeeProfile.count({ where: { companyId } });
    // Two crews of workers on every building site.
    for (const [crewIndex, tradeName] of (["Formwork carpenters", "Steel fixers"] as const).entries()) {
      const crew = await prisma.workforceCrew.create({ data: { companyId, name: `${tradeName} — ${project.code} crew ${crewIndex + 1}`, projectId, siteId: site.id, tradeId: trades.get(tradeName)!, status: "ACTIVE", createdByMemberId: cast.member("pm") }, select: { id: true } });
      totals.crews += 1;
      for (let index = 0; index < 6; index += 1) {
        let name = "";
        do name = `${workerRand.pick(WORKER_FIRST)} ${workerRand.pick(WORKER_LAST)}`;
        while (usedNames.has(name));
        usedNames.add(name);
        const [firstName, lastName] = name.split(" ") as [string, string];
        const person = await prisma.personProfile.create({ data: { parentGroupId: SHOWCASE_GROUP.id, firstName, lastName, jobTitle: index === 0 ? "Foreman" : tradeName.replace(/s$/, ""), workPhone: `+355 69 000 ${String(7000 + totals.workers).padStart(4, "0")}`, lifecycleStatus: "EMPLOYEE", city: project.city } , select: { id: true } });
        const employee = await prisma.employeeProfile.create({
          data: { companyId, personProfileId: person.id, employeeNumber: `EMP-${String(existing + 200 + totals.workers).padStart(3, "0")}`, employmentStatus: "ACTIVE", employmentType: index > 3 ? "TEMPORARY" : "FULL_TIME", startDate: businessDay(clock, -workerRand.int(60, 400)), managerMemberId: cast.member("pm"), workLocation: project.name, workLocationType: "SITE", weeklyHours: 48, jobTitle: index === 0 ? "Foreman" : tradeName.replace(/s$/, ""), tradeId: trades.get(tradeName)!, workerCategory: index === 0 ? "SUPERVISOR" : "CONSTRUCTION_WORKER", onboardingStatus: "COMPLETED", createdByMemberId: cast.member("hr") },
          select: { id: true },
        });
        if (index === 0) await prisma.workforceCrew.update({ where: { id: crew.id }, data: { supervisorEmployeeId: employee.id } });
        await prisma.workforceCrewMember.create({ data: { companyId, crewId: crew.id, employeeProfileId: employee.id, role: index === 0 ? "Foreman" : null, startDate: businessDay(clock, -60) } });
        await prisma.employeeProjectAssignment.create({ data: { companyId, employeeProfileId: employee.id, projectId, siteId: site.id, tradeId: trades.get(tradeName)!, role: index === 0 ? "Foreman" : "Worker", isPrimary: true, startDate: businessDay(clock, -60) } });
        const records: Prisma.AttendanceRecordCreateManyInput[] = [];
        for (let day = -13; day <= -1; day += 1) {
          const date = businessDay(clock, day);
          if (date.getUTCDay() === 0) continue;
          const absent = workerRand.chance(0.06);
          records.push({ companyId, employeeProfileId: employee.id, date, status: absent ? "ABSENT" : "PRESENT", checkIn: absent ? null : at(clock, day, 7), checkOut: absent ? null : at(clock, day, 16), workedMinutes: absent ? 0 : 510, source: "SITE", createdByMemberId: cast.member("pm"), crewId: crew.id, projectId, siteId: site.id });
        }
        await prisma.attendanceRecord.createMany({ data: records });
        totals.attendance += records.length;
        totals.workers += 1;
      }
    }
  }
  return totals;

  /** A cost booked against a project, approved, and paid once its terms are up. */
  async function expense(cast: Cast, projectId: string | null, day: number, category: FinanceCostCategory, description: string, payee: string, net: number, paidOn: number) {
    if (day > -1) return;
    const number = await numbers.take({ companyId: cast.companyId, table: "expenses", column: "expenseNumber", prefix: "EXP", year: at(clock, day).getUTCFullYear() });
    const total = round2(net * (1 + VAT));
    const record = await prisma.expense.create({ data: { companyId: cast.companyId, expenseNumber: number, projectId, expenseDate: businessDay(clock, day), category, description, payeeName: payee, currency: EUR, netAmount: dec(net), taxAmount: dec(total - net), totalAmount: dec(total), status: day > -6 ? "PENDING_APPROVAL" : "APPROVED", createdByMemberId: cast.member("finance"), createdAt: at(clock, day) }, select: { id: true } });
    totals.expenses += 1;
    if (paidOn > -1 || day > -6) return;
    const payment = await prisma.payment.create({ data: { companyId: cast.companyId, direction: "DISBURSEMENT", amount: dec(total), currency: EUR, paymentDate: businessDay(clock, paidOn), method: "BANK_TRANSFER", reference: `OUT-${number}`, status: "RECORDED", projectId, notes: payee, createdByMemberId: cast.member("finance"), createdAt: at(clock, paidOn) }, select: { id: true } });
    await prisma.paymentAllocation.create({ data: { companyId: cast.companyId, paymentId: payment.id, expenseId: record.id, amount: dec(total), createdByMemberId: cast.member("finance"), createdAt: at(clock, paidOn) } });
    totals.disbursements += 1;
  }
}
