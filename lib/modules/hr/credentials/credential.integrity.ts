import type { PrismaClient } from "@prisma/client";

import { CATEGORY_RULES } from "@/lib/modules/hr/documents/employee-document.types";

/**
 * The employee file's own integrity (E-02 §11, §59, §74, §91, §171-§175): what
 * composite keys cannot say across tables. The keys already hold a link to its
 * company's employment and document, a qualification to its person's group and
 * its evidence to the recording company; these catch the rest.
 *
 *   - a filed document is the employment's own file, not somebody else's;
 *   - nobody is recorded as having checked their own evidence;
 *   - a verified or expired one names who checked it, and when;
 *   - a superseded one is no longer current;
 *   - an amendment amends a contract;
 *   - a visibility is one its category allows;
 *   - a qualification's evidence is filed on one of that person's employments.
 *
 * Read-only. Run by verify:employee-integrity after seeding and the suites.
 */
export type CredentialFinding = { level: "error"; code: string; id: string; message: string };

type Row = { id: string; detail: string | null };

export async function findCredentialFindings(prisma: PrismaClient): Promise<CredentialFinding[]> {
  const findings: CredentialFinding[] = [];
  const add = (code: string, message: (row: Row) => string) => (rows: Row[]) => {
    for (const row of rows) findings.push({ level: "error", code, id: row.id, message: message(row) });
  };

  add("FILE_ELSEWHERE", (row) => `Employee document ${row.id} files a document that belongs to another record (${row.detail}).`)(
    await prisma.$queryRaw<Row[]>`
      SELECT l."id", COALESCE(d."entityType", '-') || ':' || COALESCE(d."entityId", '-') AS "detail"
      FROM "employee_document_links" l JOIN "documents" d ON d."id" = l."documentId"
      WHERE d."entityType" IS DISTINCT FROM 'employee' OR d."entityId" IS DISTINCT FROM l."employeeProfileId"`,
  );
  add("FILE_SELF_VERIFIED", (row) => `Employee document ${row.id} was checked by its own employee (${row.detail}).`)(
    await prisma.$queryRaw<Row[]>`
      SELECT l."id", l."verifiedByMemberId" AS "detail"
      FROM "employee_document_links" l
      JOIN "employee_profiles" e ON e."id" = l."employeeProfileId"
      JOIN "company_members" m ON m."id" = l."verifiedByMemberId"
      JOIN "users" u ON u."id" = m."userId"
      WHERE l."verifiedByMemberId" = e."companyMemberId" OR u."personProfileId" = e."personProfileId"`,
  );
  add("FILE_UNCHECKED_VERIFICATION", (row) => `Employee document ${row.id} is ${row.detail} but names nobody who checked it.`)(
    await prisma.$queryRaw<Row[]>`
      SELECT "id", "verificationStatus"::text AS "detail" FROM "employee_document_links"
      WHERE "verificationStatus" IN ('VERIFIED', 'EXPIRED') AND ("verifiedByMemberId" IS NULL OR "verifiedAt" IS NULL)`,
  );
  add("FILE_SUPERSEDED_CURRENT", (row) => `Employee document ${row.id} is superseded but still marked current.`)(
    await prisma.$queryRaw<Row[]>`
      SELECT "id", NULL AS "detail" FROM "employee_document_links"
      WHERE "isCurrent" AND ("verificationStatus" = 'SUPERSEDED' OR "supersededById" IS NOT NULL)`,
  );
  add("AMENDMENT_OF_NON_CONTRACT", (row) => `Employee document ${row.id} amends something that is not a contract, or is not an amendment (${row.detail}).`)(
    await prisma.$queryRaw<Row[]>`
      SELECT l."id", l."category"::text || ' → ' || a."category"::text AS "detail"
      FROM "employee_document_links" l JOIN "employee_document_links" a ON a."id" = l."amendsId"
      WHERE l."category" <> 'CONTRACT_AMENDMENT' OR a."category" <> 'EMPLOYMENT_CONTRACT'`,
  );

  // A visibility its category never allows: an identity paper shown to colleagues, a salary document to the group (§42).
  const visibilities = await prisma.employeeDocumentLink.findMany({ select: { id: true, category: true, visibility: true } });
  for (const row of visibilities) {
    if (!CATEGORY_RULES[row.category].visibilities.includes(row.visibility)) {
      findings.push({ level: "error", code: "FILE_VISIBILITY_NOT_ALLOWED", id: row.id, message: `Employee document ${row.id} is ${row.visibility}, which a ${CATEGORY_RULES[row.category].label} may not be.` });
    }
  }

  add("QUALIFICATION_SELF_VERIFIED", (row) => `Qualification ${row.id} was checked by its own holder (${row.detail}).`)(
    await prisma.$queryRaw<Row[]>`
      SELECT q."id", q."verifiedByMemberId" AS "detail"
      FROM "person_qualifications" q
      JOIN "company_members" m ON m."id" = q."verifiedByMemberId"
      JOIN "users" u ON u."id" = m."userId"
      WHERE u."personProfileId" = q."personProfileId"`,
  );
  add("QUALIFICATION_UNCHECKED_VERIFICATION", (row) => `Qualification ${row.id} is ${row.detail} but names nobody who checked it.`)(
    await prisma.$queryRaw<Row[]>`
      SELECT "id", "verificationStatus"::text AS "detail" FROM "person_qualifications"
      WHERE "verificationStatus" IN ('VERIFIED', 'EXPIRED') AND ("verifiedByMemberId" IS NULL OR "verifiedAt" IS NULL)`,
  );
  add("QUALIFICATION_SUPERSEDED_CURRENT", (row) => `Qualification ${row.id} is superseded but still marked current.`)(
    await prisma.$queryRaw<Row[]>`
      SELECT "id", NULL AS "detail" FROM "person_qualifications"
      WHERE "isCurrent" AND ("verificationStatus" = 'SUPERSEDED' OR "supersededById" IS NOT NULL)`,
  );
  add("EVIDENCE_OF_ANOTHER_PERSON", (row) => `Qualification ${row.id} rests on a file that is not on any of its holder's employments (${row.detail}).`)(
    await prisma.$queryRaw<Row[]>`
      SELECT q."id", d."id" AS "detail"
      FROM "person_qualifications" q JOIN "documents" d ON d."id" = q."supportingDocumentId"
      WHERE NOT EXISTS (
        SELECT 1 FROM "employee_profiles" e
        WHERE d."entityType" = 'employee' AND e."id" = d."entityId" AND e."personProfileId" = q."personProfileId"
      )`,
  );

  return findings;
}
