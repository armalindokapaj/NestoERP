import type { PrismaClient } from "@prisma/client";

/**
 * The workforce's own integrity (E-04 §197, §198, §275): the checks a schema
 * cannot make across tables. Composite keys already stop a crew, a site, an
 * assignment or an induction naming another company's rows; these catch what
 * is left.
 *
 *   - an employment's login is a membership of its own company, and the login
 *     belongs to the same person;
 *   - the person is of the company's own group;
 *   - nobody is still in a crew or on a project after their employment ended;
 *   - leave and attendance carry the login their employment has, or none;
 *   - every document filed under an employee names an employment of its company.
 *
 * Read-only. Run after seeding and after the suites, beside verify:employment.
 */
export type WorkforceFinding = { level: "error" | "warning"; code: string; id: string; message: string };

type Row = { id: string; detail: string | null };

export async function findWorkforceFindings(prisma: PrismaClient): Promise<WorkforceFinding[]> {
  const findings: WorkforceFinding[] = [];
  const add = (code: string, message: (row: Row) => string) => (rows: Row[]) => {
    for (const row of rows) findings.push({ level: "error", code, id: row.id, message: message(row) });
  };

  add("LOGIN_OTHER_COMPANY", (row) => `Employment ${row.id} is linked to a membership of another company (${row.detail}).`)(
    await prisma.$queryRaw<Row[]>`
      SELECT e."id", m."companyId" AS "detail"
      FROM "employee_profiles" e JOIN "company_members" m ON m."id" = e."companyMemberId"
      WHERE m."companyId" <> e."companyId"`,
  );
  add("LOGIN_OTHER_PERSON", (row) => `Employment ${row.id} is linked to a login that belongs to another person (${row.detail}).`)(
    await prisma.$queryRaw<Row[]>`
      SELECT e."id", u."personProfileId" AS "detail"
      FROM "employee_profiles" e
      JOIN "company_members" m ON m."id" = e."companyMemberId"
      JOIN "users" u ON u."id" = m."userId"
      WHERE u."personProfileId" IS NOT NULL AND u."personProfileId" <> e."personProfileId"`,
  );
  add("PERSON_OTHER_GROUP", (row) => `Employment ${row.id} is of a person from another group (${row.detail}).`)(
    await prisma.$queryRaw<Row[]>`
      SELECT e."id", p."parentGroupId" AS "detail"
      FROM "employee_profiles" e
      JOIN "person_profiles" p ON p."id" = e."personProfileId"
      JOIN "companies" c ON c."id" = e."companyId"
      WHERE p."parentGroupId" IS DISTINCT FROM c."parentGroupId"`,
  );
  add("CREW_AFTER_END", (row) => `Crew membership ${row.id} runs past the end of its employment (${row.detail}).`)(
    await prisma.$queryRaw<Row[]>`
      SELECT w."id", e."id" AS "detail"
      FROM "workforce_crew_members" w JOIN "employee_profiles" e ON e."id" = w."employeeProfileId"
      WHERE e."employmentStatus" = 'ENDED' AND e."endDate" IS NOT NULL
        AND (w."endDate" IS NULL OR w."endDate" > (e."endDate" AT TIME ZONE 'UTC')::date)`,
  );
  add("ASSIGNMENT_AFTER_END", (row) => `Project assignment ${row.id} runs past the end of its employment (${row.detail}).`)(
    await prisma.$queryRaw<Row[]>`
      SELECT a."id", e."id" AS "detail"
      FROM "employee_project_assignments" a JOIN "employee_profiles" e ON e."id" = a."employeeProfileId"
      WHERE e."employmentStatus" = 'ENDED' AND e."endDate" IS NOT NULL
        AND (a."endDate" IS NULL OR a."endDate" > (e."endDate" AT TIME ZONE 'UTC')::date)`,
  );
  for (const [table, code, what] of [
    ["attendance_records", "ATTENDANCE_OTHER_LOGIN", "Attendance"],
    ["leave_requests", "LEAVE_OTHER_LOGIN", "Leave request"],
    ["leave_balances", "BALANCE_OTHER_LOGIN", "Leave balance"],
  ] as const) {
    add(code, (row) => `${what} ${row.id} carries a login its employment does not have (${row.detail}).`)(
      await prisma.$queryRawUnsafe<Row[]>(
        `SELECT r."id", r."companyMemberId" AS "detail"
         FROM "${table}" r JOIN "employee_profiles" e ON e."id" = r."employeeProfileId"
         WHERE r."companyMemberId" IS NOT NULL AND r."companyMemberId" IS DISTINCT FROM e."companyMemberId"`,
      ),
    );
  }
  add("DOCUMENT_ORPHAN", (row) => `Document ${row.id} is filed under an employee who is not an employment of its company (${row.detail}).`)(
    await prisma.$queryRaw<Row[]>`
      SELECT d."id", d."entityId" AS "detail"
      FROM "documents" d
      WHERE d."entityType" = 'employee'
        AND NOT EXISTS (SELECT 1 FROM "employee_profiles" e WHERE e."id" = d."entityId" AND e."companyId" = d."companyId")`,
  );
  return findings;
}
