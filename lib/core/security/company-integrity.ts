import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * Cross-company references, found in the data itself (PRD #47 §20, §21, §187-§189).
 *
 * A foreign key proves the row it points at exists; it cannot prove whose it
 * is. So a service that forgets to check a linked id writes a row of Company A
 * that names a record of Company B, and the database accepts it. This finds
 * every such row, in every table, from the schema rather than a list:
 *
 *   - for a company-owned table, any id-shaped column whose value is the id of
 *     a record another company owns;
 *   - for a child table without its own `companyId` (line items), any row whose
 *     id columns name records of more than one company.
 *
 * It is the check behind `pnpm verify:company-integrity`, run after the seed and
 * after the test suites in CI, so a missing same-company check anywhere in the
 * application fails the build the first time any test exercises it.
 */

export type CompanyIntegrityViolation = {
  table: string;
  column: string;
  rows: number;
  sampleIds: string[];
};

type ModelShape = {
  name: string;
  table: string;
  owned: boolean;
  hasId: boolean;
  idColumns: { column: string; list: boolean }[];
};

/** Columns that end in "Id" but never name a company-owned record. */
const NOT_RECORD_REFERENCES = new Set(["companyId", "id", "correlationId", "requestId", "multipartUploadId", "userId", "sessionId", "membershipId"]);
const REFERENCE_NAMES = new Set(["entityId", "sourceEntityId", "targetEntityId", "parentId", "recordId", "sourceId"]);

function modelShapes(): ModelShape[] {
  return Prisma.dmmf.datamodel.models.map((model) => {
    const scalars = model.fields.filter((field) => field.kind === "scalar");
    const foreignKeys = new Set(model.fields.flatMap((field) => field.relationFromFields ?? []));
    const idColumns = scalars
      .filter((field) => field.type === "String")
      .filter((field) => !NOT_RECORD_REFERENCES.has(field.name))
      .filter((field) => foreignKeys.has(field.name) || /Ids?$/.test(field.name) || REFERENCE_NAMES.has(field.name))
      .map((field) => ({ column: field.dbName ?? field.name, list: field.isList }));
    return {
      name: model.name,
      table: model.dbName ?? model.name,
      owned: scalars.some((field) => field.name === "companyId"),
      hasId: scalars.some((field) => field.name === "id"),
      idColumns,
    };
  });
}

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

export async function findCrossCompanyReferences(prisma: PrismaClient): Promise<CompanyIntegrityViolation[]> {
  const models = modelShapes();
  const violations: CompanyIntegrityViolation[] = [];

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE owned_record_ids (id text PRIMARY KEY, company_id text NOT NULL) ON COMMIT DROP`);
      for (const model of models.filter((candidate) => candidate.owned && candidate.hasId)) {
        await tx.$executeRawUnsafe(
          `INSERT INTO owned_record_ids (id, company_id) SELECT "id", "companyId" FROM ${quote(model.table)} WHERE "companyId" IS NOT NULL ON CONFLICT (id) DO NOTHING`,
        );
      }

      for (const model of models) {
        if (model.idColumns.length === 0) continue;
        const table = quote(model.table);
        const rowKey = model.hasId ? `t."id"` : `t.ctid::text`;

        if (model.owned) {
          for (const { column, list } of model.idColumns) {
            const match = list ? `o.id = ANY(t.${quote(column)})` : `o.id = t.${quote(column)}`;
            const rows = await tx.$queryRawUnsafe<{ count: bigint; sample: string[] | null }[]>(
              `SELECT count(*) AS count, (array_agg(${rowKey}))[1:5] AS sample
                 FROM ${table} t JOIN owned_record_ids o ON ${match}
                WHERE o.company_id <> t."companyId"`,
            );
            const count = Number(rows[0]?.count ?? 0);
            if (count > 0) violations.push({ table: model.name, column, rows: count, sampleIds: rows[0].sample ?? [] });
          }
          continue;
        }

        const scalarColumns = model.idColumns.filter((candidate) => !candidate.list).map((candidate) => `t.${quote(candidate.column)}`);
        if (scalarColumns.length < 2) continue;
        const rows = await tx.$queryRawUnsafe<{ count: bigint; sample: string[] | null }[]>(
          `SELECT count(*) AS count, (array_agg(${rowKey}))[1:5] AS sample FROM ${table} t
            WHERE (SELECT count(DISTINCT o.company_id) FROM owned_record_ids o WHERE o.id IN (${scalarColumns.join(", ")})) > 1`,
        );
        const count = Number(rows[0]?.count ?? 0);
        if (count > 0) violations.push({ table: model.name, column: model.idColumns.map((candidate) => candidate.column).join("+"), rows: count, sampleIds: rows[0].sample ?? [] });
      }
    },
    { timeout: 300_000, maxWait: 30_000 },
  );

  return violations;
}
