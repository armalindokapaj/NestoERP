import { Prisma } from "@prisma/client";

import { prisma } from "../../helpers";

/**
 * What a company owns, read straight from the schema (PRD #47 §15, §209).
 *
 * The model list comes from Prisma's own DMMF rather than a hand-kept table, so
 * a model added next month is covered by every isolation check the day it
 * lands.
 */
export type OwnedModel = {
  name: string;
  table: string;
  columns: Set<string>;
};

let cached: OwnedModel[] | null = null;

export function companyOwnedModels(): OwnedModel[] {
  if (cached) return cached;
  cached = Prisma.dmmf.datamodel.models
    .map((model) => ({
      name: model.name,
      table: model.dbName ?? model.name,
      columns: new Set(model.fields.filter((field) => field.kind === "scalar").map((field) => field.dbName ?? field.name)),
    }))
    .filter((model) => model.columns.has("companyId"));
  return cached;
}

export function ownedModel(name: string): OwnedModel {
  const model = companyOwnedModels().find((candidate) => candidate.name === name);
  if (!model) throw new Error(`${name} is not a company-owned model`);
  return model;
}

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

/**
 * Every identifier a company's records carry — the fingerprint a leak leaves.
 *
 * A response to somebody in another company that contains any of these has
 * shown them something of this company's, whatever the field was called.
 */
export async function companyIdentifiers(companyId: string): Promise<Set<string>> {
  const ids = new Set<string>([companyId]);
  for (const model of companyOwnedModels()) {
    if (!model.columns.has("id")) continue;
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM ${quote(model.table)} WHERE "companyId" = $1`,
      companyId,
    );
    for (const row of rows) ids.add(row.id);
  }
  return ids;
}

/**
 * A digest of every row a company owns, table by table (PRD #47 §209: "0 mutations").
 *
 * Taken before and after an attack, a difference in any table means the
 * attacker changed, added or removed something that was never theirs.
 */
export async function companySnapshot(companyId: string): Promise<Map<string, string>> {
  const digests = new Map<string, string>();
  for (const model of companyOwnedModels()) {
    const [row] = await prisma.$queryRawUnsafe<{ digest: string | null; count: bigint }[]>(
      `SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS digest, count(*) AS count
         FROM ${quote(model.table)} t WHERE t."companyId" = $1`,
      companyId,
    );
    digests.set(model.name, `${row.count}:${row.digest}`);
  }
  return digests;
}

export function snapshotDifferences(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...before.keys()].filter((key) => before.get(key) !== after.get(key));
}

/**
 * Columns that name a member: `memberId`, and every `…MemberId`.
 *
 * A record raised by, owned by or assigned to somebody is reachable by that
 * somebody through the SELF door every scope builder keeps open, whichever
 * project it belongs to. Project isolation is about other people's project
 * work, so those rows are not targets — see `ownedRows(…, exceptMemberId)`.
 */
function memberColumns(model: OwnedModel): string[] {
  return [...model.columns].filter((column) => column === "memberId" || column.endsWith("MemberId"));
}

/** Rows of one model in one company, optionally filtered by extra column equalities. */
export async function ownedRows(
  modelName: string,
  companyId: string,
  where: Record<string, string | string[]> = {},
  limit = 5,
  exceptMemberId?: string,
): Promise<Record<string, unknown>[]> {
  const model = ownedModel(modelName);
  const clauses = [`"companyId" = $1`];
  const values: unknown[] = [companyId];
  for (const [column, value] of Object.entries(where)) {
    if (!model.columns.has(column)) return [];
    values.push(value);
    clauses.push(Array.isArray(value) ? `${quote(column)} = ANY($${values.length}::text[])` : `${quote(column)} = $${values.length}`);
  }
  if (exceptMemberId) {
    values.push(exceptMemberId);
    // coalesce, because `NULL <> 'x'` is NULL and would drop every unassigned row.
    for (const column of memberColumns(model)) clauses.push(`coalesce(${quote(column)}, '') <> $${values.length}`);
  }
  const order = model.columns.has("id") ? `ORDER BY "id"` : "";
  return prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM ${quote(model.table)} WHERE ${clauses.join(" AND ")} ${order} LIMIT ${limit}`,
    ...values,
  );
}

/**
 * Strings in a response that belong to the other company.
 *
 * Walks every string value, and every path segment or query value inside one,
 * so an id reaches the check whether it arrives as a field, inside an href, or
 * as `type:id` in a link. Ids the attacker supplied themselves are excluded:
 * echoing a request back is not disclosure.
 */
export function foreignIdentifiersIn(
  payload: unknown,
  foreign: Set<string>,
  supplied: ReadonlySet<string>,
): string[] {
  const found = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      for (const token of [value, ...value.split(/[/?&=:#,\s]+/)]) {
        if (token && foreign.has(token) && !supplied.has(token)) found.add(token);
      }
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        visit(key);
        visit(inner);
      }
    }
  };
  visit(payload);
  return [...found];
}

/**
 * Identifiers and a digest of everything that belongs to a set of projects
 * (PRD #47 §139, §210): the projects themselves and every company-owned row
 * whose `projectId` names one of them.
 */
export async function projectFootprint(
  companyId: string,
  projectIds: string[],
  exceptMemberId?: string,
): Promise<{ ids: Set<string>; digest: Map<string, string> }> {
  const ids = new Set<string>(projectIds);
  const digest = new Map<string, string>();
  for (const model of companyOwnedModels()) {
    const column = model.name === "Project" ? "id" : model.columns.has("projectId") ? "projectId" : null;
    if (!column) continue;
    // A row of theirs on somebody else's project is theirs to see and change,
    // so it belongs to neither the leak set nor the change digest.
    const mine = exceptMemberId ? memberColumns(model).map((name) => ` AND coalesce(t.${quote(name)}, '') <> $3`).join("") : "";
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT t.* FROM ${quote(model.table)} t WHERE t."companyId" = $1 AND t.${quote(column)} = ANY($2::text[])${mine} ORDER BY t::text`,
      ...[companyId, projectIds, ...(exceptMemberId ? [exceptMemberId] : [])],
    );
    if (model.columns.has("id")) for (const row of rows) ids.add(String(row.id));
    digest.set(model.name, `${rows.length}:${JSON.stringify(rows, (_, value) => (typeof value === "bigint" ? value.toString() : value))}`);
  }
  return { ids, digest };
}
