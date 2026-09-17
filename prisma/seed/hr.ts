/**
 * HR fixtures (PRD #16 §327–§336).
 *
 * Every state the HR module has to render, because a screen that has never been
 * seen with data in it has never really been built:
 *
 *   employment    every status and every employment type (§328)
 *   compensation  current pay for six roles, with a historical change (§329)
 *   leave         every type and every status (§330)
 *   balances      plenty left, partly used, and nearly exhausted (§331)
 *   attendance    every status, timed and status-only, plus the rows approved
 *                 leave writes for itself (§332)
 *   onboarding    not started, in progress, completed (§333)
 *   offboarding   in progress and completed (§334)
 *   group         every other demo company's own people employed there, so
 *                 Group HR has five companies' records (E-06 §112)
 *
 * Every employment record is the employment of a person (E-06 §25): the one
 * created with the account, `person_<user>`.
 *
 * Idempotent: everything is addressed by a deterministic id and upserted, so
 * re-running converges rather than duplicating.
 */
import { Prisma, type PrismaClient } from "@prisma/client";

import { countWorkingDays } from "../../lib/modules/hr/hr.calendar";

import { COMPANY_A, DEMO_COMPANY_IDS, FIXTURE_WORKS, daysFromNow, type SeedMembers } from "./constants";
import { COMPANY_USERS } from "./demo/users";

type Members = SeedMembers;

const EUR = "EUR";

export async function seedHrRecords(prisma: PrismaClient, members: Members) {
  const profiles = await seedEmployeeProfiles(prisma, members);
  await seedCompensation(prisma, members, profiles);
  const balances = await seedLeaveBalances(prisma, profiles);
  await seedLeaveRequests(prisma, members, profiles);
  await seedAttendance(prisma, members, profiles);

  return {
    employees: await prisma.employeeProfile.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }),
    compensation: await prisma.compensation.count({ where: { companyId: COMPANY_A } }),
    leave: await prisma.leaveRequest.count({ where: { companyId: COMPANY_A } }),
    balances,
    attendance: await prisma.attendanceRecord.count({ where: { companyId: COMPANY_A } }),
  };
}

/* -------------------------------------------------------------------------- */
/* Employment records (PRD #16 §328)                                           */
/* -------------------------------------------------------------------------- */

type ProfileFixture = {
  user: string;
  /** Aurelia unless given. */
  company?: string;
  number: string;
  status: "PLANNED" | "ACTIVE" | "ON_LEAVE" | "SUSPENDED" | "ENDED";
  type: "FULL_TIME" | "PART_TIME" | "CONTRACTOR" | "INTERN" | "TEMPORARY";
  /** Days from today. Negative is in the past. */
  start: number;
  probation?: number;
  end?: number;
  manager?: string;
  location: string;
  weeklyHours: string;
  onboarding: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "NOT_REQUIRED";
  offboarding: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "NOT_REQUIRED";
};

const PROFILES: ProfileFixture[] = [
  { user: "user_owner", number: "EMP-001", status: "ACTIVE", type: "FULL_TIME", start: -1400, location: "Tiranë HQ", weeklyHours: "40", onboarding: "COMPLETED", offboarding: "NOT_REQUIRED" },
  { user: "user_ceo", number: "EMP-002", status: "ACTIVE", type: "FULL_TIME", start: -1200, manager: "user_owner", location: "Tiranë HQ", weeklyHours: "40", onboarding: "COMPLETED", offboarding: "NOT_REQUIRED" },
  { user: "user_hr", number: "EMP-003", status: "ACTIVE", type: "FULL_TIME", start: -900, manager: "user_ceo", location: "Tiranë HQ", weeklyHours: "40", onboarding: "COMPLETED", offboarding: "NOT_REQUIRED" },
  { user: "user_finance", number: "EMP-004", status: "ACTIVE", type: "FULL_TIME", start: -850, manager: "user_ceo", location: "Tiranë HQ", weeklyHours: "40", onboarding: "COMPLETED", offboarding: "NOT_REQUIRED" },
  { user: "user_pm", number: "EMP-005", status: "ACTIVE", type: "FULL_TIME", start: -700, manager: "user_ceo", location: "Tiranë HQ", weeklyHours: "40", onboarding: "COMPLETED", offboarding: "NOT_REQUIRED" },
  { user: "user_architect", number: "EMP-006", status: "ACTIVE", type: "FULL_TIME", start: -600, manager: "user_pm", location: "Tiranë HQ", weeklyHours: "40", onboarding: "COMPLETED", offboarding: "NOT_REQUIRED" },
  { user: "user_engineer", number: "EMP-007", status: "ACTIVE", type: "FULL_TIME", start: -420, manager: "user_pm", location: "Riverside site", weeklyHours: "40", onboarding: "COMPLETED", offboarding: "NOT_REQUIRED" },
  // On extended leave: employment is running, the person is not in.
  { user: "user_qaqc", number: "EMP-008", status: "ON_LEAVE", type: "FULL_TIME", start: -380, manager: "user_pm", location: "Riverside site", weeklyHours: "40", onboarding: "COMPLETED", offboarding: "NOT_REQUIRED" },
  { user: "user_hse", number: "EMP-009", status: "ACTIVE", type: "FULL_TIME", start: -350, manager: "user_pm", location: "Riverside site", weeklyHours: "40", onboarding: "COMPLETED", offboarding: "NOT_REQUIRED" },
  { user: "user_legal", number: "EMP-010", status: "ACTIVE", type: "PART_TIME", start: -300, manager: "user_ceo", location: "Tiranë HQ", weeklyHours: "20", onboarding: "COMPLETED", offboarding: "NOT_REQUIRED" },
  { user: "user_sales", number: "EMP-011", status: "ACTIVE", type: "FULL_TIME", start: -260, manager: "user_ceo", location: "Tiranë HQ", weeklyHours: "40", onboarding: "COMPLETED", offboarding: "NOT_REQUIRED" },
  { user: "user_procurement", number: "EMP-012", status: "ACTIVE", type: "CONTRACTOR", start: -180, manager: "user_finance", location: "Remote", weeklyHours: "37.50", onboarding: "COMPLETED", offboarding: "NOT_REQUIRED" },
  // Probation still running, so the probation alert has something to show.
  { user: "user_inventory", number: "EMP-013", status: "ACTIVE", type: "FULL_TIME", start: -70, probation: 20, manager: "user_procurement", location: "Central store", weeklyHours: "40", onboarding: "IN_PROGRESS", offboarding: "NOT_REQUIRED" },
  { user: "user_it", number: "EMP-014", status: "ACTIVE", type: "FULL_TIME", start: -500, manager: "user_owner", location: "Tiranë HQ", weeklyHours: "40", onboarding: "COMPLETED", offboarding: "NOT_REQUIRED" },
  // Starts in three weeks: the account is ready, onboarding not begun.
  { user: "user_finance_a", number: "EMP-015", status: "PLANNED", type: "FULL_TIME", start: 21, probation: 111, manager: "user_finance", location: "Tiranë HQ", weeklyHours: "40", onboarding: "NOT_STARTED", offboarding: "NOT_REQUIRED" },
  // The two department heads (E-05D §19, E-05E §39).
  { user: "user_architecture_manager", number: "EMP-019", status: "ACTIVE", type: "FULL_TIME", start: -980, manager: "user_ceo", location: "Tiranë HQ", weeklyHours: "40", onboarding: "COMPLETED", offboarding: "NOT_REQUIRED" },
  { user: "user_sales_manager", number: "EMP-020", status: "ACTIVE", type: "FULL_TIME", start: -640, manager: "user_ceo", location: "Tiranë HQ", weeklyHours: "40", onboarding: "COMPLETED", offboarding: "NOT_REQUIRED" },
  // Leaving next month: offboarding under way.
  { user: "user_viewer", number: "EMP-016", status: "ACTIVE", type: "INTERN", start: -120, end: 24, manager: "user_architect", location: "Tiranë HQ", weeklyHours: "20", onboarding: "COMPLETED", offboarding: "IN_PROGRESS" },
  // Suspended employment, which is not the same as a suspended membership.
  { user: "user_membership_suspended", company: FIXTURE_WORKS, number: "EMP-017", status: "SUSPENDED", type: "FULL_TIME", start: -200, location: "Tiranë HQ", weeklyHours: "40", onboarding: "COMPLETED", offboarding: "NOT_REQUIRED" },
  // Left the company: offboarding done, record kept.
  { user: "user_membership_inactive", company: FIXTURE_WORKS, number: "EMP-018", status: "ENDED", type: "TEMPORARY", start: -400, end: -20, location: "Tiranë HQ", weeklyHours: "40", onboarding: "COMPLETED", offboarding: "COMPLETED" },
];

async function seedEmployeeProfiles(prisma: PrismaClient, members: Members) {
  const byUser = new Map<string, { id: string; memberId: string }>();

  for (const fixture of [...PROFILES, ...groupCompanyProfiles()]) {
    const companyId = fixture.company ?? COMPANY_A;
    const memberId = companyId === FIXTURE_WORKS ? members.get(fixture.user) : members.in(companyId, fixture.user);
    if (!memberId) throw new Error(`Seed: ${fixture.user} has no membership for an employment record.`);

    const managerId = fixture.manager ? members.in(companyId, fixture.manager) : null;
    const prefix = companyId === COMPANY_A || companyId === FIXTURE_WORKS ? "employee" : `employee_${companyId.replace(/^company_demo_/, "")}`;
    const id = `${prefix}_${fixture.number.toLowerCase().replace("-", "_")}`;

    const profile = await prisma.employeeProfile.upsert({
      where: { companyMemberId: memberId },
      update: {},
      create: {
        id,
        companyId,
        personProfileId: `person_${fixture.user.replace(/^user_/, "")}`,
        companyMemberId: memberId,
        employeeNumber: fixture.number,
        employmentStatus: fixture.status,
        employmentType: fixture.type,
        startDate: daysFromNow(fixture.start),
        probationEndDate:
          fixture.probation === undefined ? null : daysFromNow(fixture.probation),
        endDate: fixture.end === undefined ? null : daysFromNow(fixture.end),
        managerMemberId: managerId,
        workLocation: fixture.location,
        weeklyHours: fixture.weeklyHours,
        onboardingStatus: fixture.onboarding,
        offboardingStatus: fixture.offboarding,
        createdByMemberId: companyId === FIXTURE_WORKS ? null : members.in(companyId, "user_hr"),
      },
      select: { id: true, companyMemberId: true },
    });

    if (companyId === COMPANY_A) byUser.set(fixture.user, { id: profile.id, memberId: profile.companyMemberId! });
  }

  return byUser;
}

/**
 * Meridian, Terra, Forma and Nova employ their own people: each CEO reports to
 * the group's Owner, everyone else to their company's CEO (E-06 §49, §112).
 */
function groupCompanyProfiles(): ProfileFixture[] {
  return DEMO_COMPANY_IDS.filter((companyId) => companyId !== COMPANY_A).flatMap((companyId) =>
    COMPANY_USERS.filter((user) => user.companies[0] === companyId).map((user, index): ProfileFixture => ({
      user: user.id,
      company: companyId,
      number: `EMP-${String(index + 1).padStart(3, "0")}`,
      status: "ACTIVE",
      type: "FULL_TIME",
      start: -700 + index * 60,
      manager: user.role === "CEO" ? "user_owner" : COMPANY_USERS.find((other) => other.role === "CEO" && other.companies[0] === companyId)!.id,
      location: "Head office",
      weeklyHours: "40",
      onboarding: "COMPLETED",
      offboarding: "NOT_REQUIRED",
    })),
  );
}

type Profiles = Map<string, { id: string; memberId: string }>;

/* -------------------------------------------------------------------------- */
/* Compensation (PRD #16 §329)                                                 */
/* -------------------------------------------------------------------------- */

type PayFixture = {
  user: string;
  payType: "SALARY" | "HOURLY" | "DAILY";
  amount: string;
  from: number;
  /** A closed earlier record, so the history has something in it. */
  previous?: { amount: string; from: number; to: number };
};

const PAY: PayFixture[] = [
  { user: "user_owner", payType: "SALARY", amount: "9500.00", from: -365 },
  { user: "user_ceo", payType: "SALARY", amount: "8200.00", from: -365 },
  {
    user: "user_hr",
    payType: "SALARY",
    amount: "4100.00",
    from: -90,
    previous: { amount: "3800.00", from: -455, to: -91 },
  },
  { user: "user_finance", payType: "SALARY", amount: "4400.00", from: -365 },
  {
    user: "user_pm",
    payType: "SALARY",
    amount: "5200.00",
    from: -120,
    previous: { amount: "4800.00", from: -485, to: -121 },
  },
  { user: "user_architect", payType: "SALARY", amount: "3900.00", from: -300 },
  { user: "user_engineer", payType: "SALARY", amount: "3400.00", from: -200 },
  { user: "user_procurement", payType: "DAILY", amount: "260.00", from: -180 },
  { user: "user_viewer", payType: "HOURLY", amount: "7.50", from: -120 },
];

async function seedCompensation(
  prisma: PrismaClient,
  members: Members,
  profiles: Profiles,
) {
  const hr = members.get("user_hr")!;
  let index = 0;

  for (const fixture of PAY) {
    const profile = profiles.get(fixture.user);
    if (!profile) continue;

    index += 1;

    if (fixture.previous) {
      await prisma.compensation.upsert({
        where: { id: `compensation_${index}_prev` },
        update: {},
        create: {
          id: `compensation_${index}_prev`,
          companyId: COMPANY_A,
          employeeProfileId: profile.id,
          currency: EUR,
          payType: fixture.payType,
          baseAmount: fixture.previous.amount,
          effectiveFrom: daysFromNow(fixture.previous.from),
          // Closed, so exactly one open record remains — the partial unique
          // index would refuse a second (PRD #16 §189).
          effectiveTo: daysFromNow(fixture.previous.to),
          createdByMemberId: hr,
        },
      });
    }

    await prisma.compensation.upsert({
      where: { id: `compensation_${index}` },
      update: {},
      create: {
        id: `compensation_${index}`,
        companyId: COMPANY_A,
        employeeProfileId: profile.id,
        currency: EUR,
        payType: fixture.payType,
        baseAmount: fixture.amount,
        effectiveFrom: daysFromNow(fixture.from),
        effectiveTo: null,
        notes: fixture.previous ? "Annual review increase." : null,
        createdByMemberId: hr,
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Leave balances (PRD #16 §331)                                               */
/* -------------------------------------------------------------------------- */

/**
 * Entitlements chosen so all three states are reachable: plenty left, partly
 * used, and nearly exhausted. `usedDays` is written to match the approved leave
 * below, so the balance and the requests agree from the first login.
 */
const ENTITLEMENTS: Record<string, { annual: string; sick: string }> = {
  user_owner: { annual: "30", sick: "10" },
  user_ceo: { annual: "28", sick: "10" },
  user_hr: { annual: "25", sick: "10" },
  user_finance: { annual: "25", sick: "10" },
  user_pm: { annual: "25", sick: "10" },
  user_architect: { annual: "25", sick: "10" },
  user_engineer: { annual: "22", sick: "10" },
  user_qaqc: { annual: "22", sick: "10" },
  user_hse: { annual: "22", sick: "10" },
  user_legal: { annual: "12", sick: "5" },
  user_sales: { annual: "25", sick: "10" },
  user_architecture_manager: { annual: "28", sick: "10" },
  user_sales_manager: { annual: "25", sick: "10" },
  user_procurement: { annual: "20", sick: "0" },
  user_inventory: { annual: "20", sick: "10" },
  user_it: { annual: "25", sick: "10" },
  // Nearly exhausted, so "not enough days" is reachable in the demo.
  user_viewer: { annual: "6", sick: "5" },
};

async function seedLeaveBalances(prisma: PrismaClient, profiles: Profiles) {
  const year = new Date().getUTCFullYear();
  let count = 0;

  for (const [user, entitlement] of Object.entries(ENTITLEMENTS)) {
    const profile = profiles.get(user);
    if (!profile) continue;

    for (const [leaveType, days] of [
      ["ANNUAL", entitlement.annual],
      ["SICK", entitlement.sick],
    ] as const) {
      if (days === "0") continue;

      await prisma.leaveBalance.upsert({
        where: {
          employeeProfileId_leaveType_year: {
            employeeProfileId: profile.id,
            leaveType,
            year,
          },
        },
        update: {},
        create: {
          companyId: COMPANY_A,
          employeeProfileId: profile.id,
          companyMemberId: profile.memberId,
          leaveType,
          year,
          entitledDays: days,
          usedDays: "0",
          adjustmentDays: "0",
        },
      });
      count += 1;
    }
  }

  return count;
}

/* -------------------------------------------------------------------------- */
/* Leave requests (PRD #16 §330)                                               */
/* -------------------------------------------------------------------------- */

type LeaveFixture = {
  id: string;
  user: string;
  type: "ANNUAL" | "SICK" | "UNPAID" | "PARENTAL" | "OTHER";
  status: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  /** Days from today, and the number of calendar days the request covers. */
  start: number;
  length: number;
  reason?: string;
  note?: string;
};

const LEAVE: LeaveFixture[] = [
  // Approved and in the past: these are what usedDays is built from.
  { id: "leave_001", user: "user_architect", type: "ANNUAL", status: "APPROVED", start: -60, length: 4 },
  { id: "leave_002", user: "user_engineer", type: "SICK", status: "APPROVED", start: -30, length: 1, reason: "Flu; certificate provided." },
  { id: "leave_003", user: "user_pm", type: "ANNUAL", status: "APPROVED", start: -21, length: 6 },
  { id: "leave_004", user: "user_finance", type: "ANNUAL", status: "APPROVED", start: -14, length: 2 },
  { id: "leave_005", user: "user_viewer", type: "ANNUAL", status: "APPROVED", start: -10, length: 4 },
  // Approved and upcoming, so "on leave today" and the calendar have content.
  { id: "leave_006", user: "user_qaqc", type: "PARENTAL", status: "APPROVED", start: -5, length: 40, reason: "Parental leave." },
  { id: "leave_007", user: "user_sales", type: "ANNUAL", status: "APPROVED", start: 14, length: 6 },
  // Waiting for a decision: the approval queue.
  { id: "leave_008", user: "user_engineer", type: "ANNUAL", status: "PENDING", start: 35, length: 10 },
  { id: "leave_009", user: "user_architect", type: "ANNUAL", status: "PENDING", start: 45, length: 4 },
  { id: "leave_010", user: "user_hse", type: "SICK", status: "PENDING", start: -2, length: 1, reason: "Medical appointment." },
  { id: "leave_011", user: "user_legal", type: "UNPAID", status: "PENDING", start: 60, length: 5, reason: "Personal matter." },
  // Still being written.
  { id: "leave_012", user: "user_inventory", type: "ANNUAL", status: "DRAFT", start: 70, length: 3 },
  { id: "leave_013", user: "user_it", type: "OTHER", status: "DRAFT", start: 80, length: 2, reason: "Study leave." },
  // Turned down, with the reason the approver gave.
  { id: "leave_014", user: "user_hse", type: "ANNUAL", status: "REJECTED", start: 28, length: 5, note: "Clashes with the site audit that week." },
  { id: "leave_015", user: "user_procurement", type: "ANNUAL", status: "REJECTED", start: 21, length: 8, note: "Please split this across two months." },
  // Withdrawn before a decision.
  { id: "leave_016", user: "user_sales", type: "ANNUAL", status: "CANCELLED", start: -40, length: 3 },
  { id: "leave_017", user: "user_finance", type: "UNPAID", status: "CANCELLED", start: -50, length: 2 },
  // A longer approved stretch, further back.
  { id: "leave_018", user: "user_it", type: "ANNUAL", status: "APPROVED", start: -120, length: 9 },
  { id: "leave_019", user: "user_hr", type: "ANNUAL", status: "APPROVED", start: -95, length: 5 },
  { id: "leave_020", user: "user_owner", type: "ANNUAL", status: "APPROVED", start: -160, length: 11 },
  { id: "leave_021", user: "user_legal", type: "SICK", status: "APPROVED", start: -45, length: 2, reason: "Sick day." },
];

async function seedLeaveRequests(
  prisma: PrismaClient,
  members: Members,
  profiles: Profiles,
) {
  const hr = members.get("user_hr")!;
  const usedByBalance = new Map<string, Prisma.Decimal>();

  for (const fixture of LEAVE) {
    const profile = profiles.get(fixture.user);
    if (!profile) continue;

    const startDate = daysFromNow(fixture.start);
    const endDate = daysFromNow(fixture.start + fixture.length - 1);
    const days = countWorkingDays(startDate, endDate);
    if (days === 0) continue;

    const approved = fixture.status === "APPROVED";
    const rejected = fixture.status === "REJECTED";
    const cancelled = fixture.status === "CANCELLED";
    const settled = fixture.status !== "DRAFT";

    await prisma.leaveRequest.upsert({
      where: { id: fixture.id },
      update: {},
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        employeeProfileId: profile.id,
        companyMemberId: profile.memberId,
        leaveType: fixture.type,
        startDate,
        endDate,
        days: new Prisma.Decimal(days),
        reason: fixture.reason ?? null,
        status: fixture.status,
        submittedAt: settled ? daysFromNow(fixture.start - 14) : null,
        approvedByMemberId: approved ? hr : null,
        approvedAt: approved ? daysFromNow(fixture.start - 10) : null,
        rejectedByMemberId: rejected ? hr : null,
        rejectedAt: rejected ? daysFromNow(fixture.start - 10) : null,
        cancelledByMemberId: cancelled ? profile.memberId : null,
        cancelledAt: cancelled ? daysFromNow(fixture.start - 8) : null,
        decisionNote: fixture.note ?? null,
        createdByMemberId: profile.memberId,
      },
    });

    // Approved annual leave is what `usedDays` counts (PRD #16 §80).
    if (approved && fixture.type === "ANNUAL") {
      const key = `${profile.id}:${startDate.getUTCFullYear()}`;
      usedByBalance.set(
        key,
        (usedByBalance.get(key) ?? new Prisma.Decimal(0)).plus(days),
      );
    }
  }

  // Written last, so the balances agree with the requests above rather than
  // being guessed at (PRD #16 §80, §219).
  for (const [key, used] of usedByBalance) {
    const [employeeProfileId, year] = key.split(":");
    await prisma.leaveBalance.updateMany({
      where: {
        employeeProfileId,
        leaveType: "ANNUAL",
        year: Number.parseInt(year, 10),
      },
      data: { usedDays: used },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Attendance (PRD #16 §332)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Two weeks of attendance for the site team, plus the `ON_LEAVE` rows approved
 * leave writes for itself. Deterministic rather than random: a demo that looks
 * different every time it is seeded is not a fixture.
 */
const ATTENDANCE_USERS = [
  "user_engineer",
  "user_architect",
  "user_hse",
  "user_inventory",
] as const;

async function seedAttendance(
  prisma: PrismaClient,
  members: Members,
  profiles: Profiles,
) {
  const hr = members.get("user_hr")!;

  // Days approved leave already covers, so an attendance row is not written
  // twice for the same day.
  const approvedLeave = await prisma.leaveRequest.findMany({
    where: { companyId: COMPANY_A, status: "APPROVED" },
    select: { id: true, companyMemberId: true, employeeProfileId: true, startDate: true, endDate: true },
  });

  const rows: Prisma.AttendanceRecordCreateManyInput[] = [];

  for (const [index, user] of ATTENDANCE_USERS.entries()) {
    const profile = profiles.get(user);
    if (!profile) continue;

    for (let back = 1; back <= 18; back += 1) {
      const date = daysFromNow(-back);
      const weekday = date.getUTCDay();

      // Weekends are days off; V0.1 has no company calendar (PRD #16 §215).
      if (weekday === 0 || weekday === 6) {
        rows.push({
          companyId: COMPANY_A,
          employeeProfileId: profile.id,
          companyMemberId: profile.memberId,
          date,
          status: "OFF",
          source: "SYSTEM",
          createdByMemberId: hr,
        });
        continue;
      }

      // A deterministic spread that still produces every status.
      const slot = (back + index * 3) % 12;
      if (slot === 0) {
        rows.push({
          companyId: COMPANY_A,
          employeeProfileId: profile.id,
          companyMemberId: profile.memberId,
          date,
          status: "ABSENT",
          notes: "No notification received.",
          source: "MANUAL",
          createdByMemberId: hr,
        });
      } else if (slot === 1 || slot === 7) {
        rows.push({
          companyId: COMPANY_A,
          employeeProfileId: profile.id,
          companyMemberId: profile.memberId,
          date,
          status: "REMOTE",
          checkIn: at(date, 9, 0),
          checkOut: at(date, 17, 30),
          workedMinutes: 510,
          source: "SELF",
          createdByMemberId: profile.memberId,
        });
      } else if (slot === 4) {
        // Present with no check-out: the attendance exception (PRD #16 §115).
        rows.push({
          companyId: COMPANY_A,
          employeeProfileId: profile.id,
          companyMemberId: profile.memberId,
          date,
          status: "PRESENT",
          checkIn: at(date, 8, 0),
          checkOut: null,
          workedMinutes: null,
          notes: "Forgot to check out.",
          source: "SELF",
          createdByMemberId: profile.memberId,
        });
      } else if (slot === 9) {
        // A status-only day, for companies that do not record times at all.
        rows.push({
          companyId: COMPANY_A,
          employeeProfileId: profile.id,
          companyMemberId: profile.memberId,
          date,
          status: "PRESENT",
          source: "MANUAL",
          createdByMemberId: hr,
        });
      } else {
        rows.push({
          companyId: COMPANY_A,
          employeeProfileId: profile.id,
          companyMemberId: profile.memberId,
          date,
          status: "PRESENT",
          checkIn: at(date, 8, 0),
          checkOut: at(date, 16, 30),
          workedMinutes: 510,
          source: "MANUAL",
          createdByMemberId: hr,
        });
      }
    }
  }

  // The rows approved leave writes, tagged with the request that created them
  // so cancelling that leave takes exactly these back out (PRD #16 §110).
  for (const leave of approvedLeave) {
    const cursor = new Date(leave.startDate);
    while (cursor.getTime() <= leave.endDate.getTime()) {
      const weekday = cursor.getUTCDay();
      if (weekday >= 1 && weekday <= 5) {
        rows.push({
          companyId: COMPANY_A,
          employeeProfileId: leave.employeeProfileId,
          companyMemberId: leave.companyMemberId,
          date: new Date(cursor),
          status: "ON_LEAVE",
          source: "SYSTEM",
          sourceEntityType: "leave_request",
          sourceEntityId: leave.id,
          createdByMemberId: hr,
        });
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  // A planned company holiday, which is the one thing that may sit in the
  // future (PRD #16 §104).
  for (const user of ATTENDANCE_USERS) {
    const profile = profiles.get(user);
    if (!profile) continue;
    rows.push({
      companyId: COMPANY_A,
      employeeProfileId: profile.id,
      companyMemberId: profile.memberId,
      date: daysFromNow(12),
      status: "HOLIDAY",
      notes: "Company holiday.",
      source: "SYSTEM",
      createdByMemberId: hr,
    });
  }

  // One row per person per day: later duplicates are dropped rather than
  // colliding with the unique constraint (PRD #16 §101).
  const seen = new Set<string>();
  const unique = rows.filter((row) => {
    const key = `${row.companyMemberId}:${(row.date as Date).toISOString()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  await prisma.attendanceRecord.createMany({ data: unique, skipDuplicates: true });
}

function at(date: Date, hours: number, minutes: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours, minutes),
  );
}
