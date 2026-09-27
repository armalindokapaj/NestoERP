import { firstValue } from "@/lib/modules/shared/list-query";
import { FILE_TYPE_GROUPS } from "./document.files";
import {
  DOCUMENT_CONTEXT_FILTERS,
  DOCUMENT_DATE_PRESETS,
  DOCUMENT_SORT_KEYS,
  documentListQuerySchema,
  type DocumentDatePreset,
  type DocumentListQuery,
  type DocumentSortKey,
} from "./document.schema";

/**
 * Turns URL search parameters into a validated list query (PRD #13 §137).
 *
 * Shared by the pages and the API, so `/documents/all?fileType=pdf` and
 * `GET /api/documents?fileType=pdf` behave identically.
 */
type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: RawParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  return firstValue(params[key]);
}

const FILE_GROUPS = Object.keys(FILE_TYPE_GROUPS);

function list(value: string | undefined, allowed: readonly string[]): string[] | undefined {
  if (!value) return undefined;
  const values = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => allowed.includes(entry));
  return values.length > 0 ? values : undefined;
}

export type DocumentQueryDefaults = Partial<
  Pick<DocumentListQuery, "archived" | "mine" | "sort">
>;

export function parseDocumentListQuery(
  params: RawParams,
  defaults: DocumentQueryDefaults = {},
): DocumentListQuery {
  const sortValue = read(params, "sort");
  const sort: DocumentSortKey = (DOCUMENT_SORT_KEYS as readonly string[]).includes(sortValue ?? "")
    ? (sortValue as DocumentSortKey)
    : (defaults.sort ?? "updated-desc");

  const page = Number.parseInt(read(params, "page") ?? "1", 10);
  const limit = Number.parseInt(read(params, "limit") ?? "25", 10);

  const preset = read(params, "date");

  return documentListQuerySchema.parse({
    search: read(params, "search") || undefined,
    fileType: list(read(params, "fileType"), FILE_GROUPS),
    context: list(read(params, "context"), DOCUMENT_CONTEXT_FILTERS),
    moduleKey: read(params, "module") || undefined,
    projectId: read(params, "projectId") || undefined,
    clientId: read(params, "clientId") || undefined,
    uploadedByMemberId: read(params, "uploadedBy") || undefined,
    companyId: read(params, "company") || undefined,
    // A preset is resolved by the repository against the company's calendar
    // day; it replaces an explicit `dateFrom` as it always has (AUD-08 §3).
    datePreset: (DOCUMENT_DATE_PRESETS as readonly string[]).includes(preset ?? "") ? (preset as DocumentDatePreset) : undefined,
    dateFrom: (DOCUMENT_DATE_PRESETS as readonly string[]).includes(preset ?? "") ? undefined : read(params, "dateFrom") || undefined,
    dateTo: read(params, "dateTo") || undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 25,
    sort,
    archived: defaults.archived ?? read(params, "archived") === "true",
    mine: defaults.mine ?? read(params, "mine") === "true",
  });
}
