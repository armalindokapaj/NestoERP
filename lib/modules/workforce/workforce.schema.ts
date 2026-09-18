import { z } from "zod";

import { day } from "@/lib/modules/hr/employment/employment.schema";
import { ACCOUNT_STATUSES } from "@/lib/modules/hr/hr.person";
import { EMPLOYMENT_STATUSES, WORKER_CATEGORIES } from "@/lib/modules/hr/hr.schema";
import { firstValue, paginationSchema } from "@/lib/modules/shared/list-query";
import { SHEET_STATUSES, TRADE_NAME_MAX } from "./workforce.types";

/**
 * Workforce validation (E-04 §167-§175).
 *
 * `companyId`, the actor and every `ended…`/`created…` field are absent: they
 * are the server's. Every id here is only a claim — the services check it
 * names a row of this company that this reader may use, and answer like any
 * other invalid field when it does not (§171-§174).
 */

const id = z.string().trim().min(1).max(64);
const optionalId = z
  .union([id, z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === "" ? null : value));
const note = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((value) => (value === "" ? null : value));
const name = (label: string, max = 120) => z.string().trim().min(1, `Give the ${label} a name.`).max(max, `Keep the name under ${max} characters.`);

/* Trades (§11) --------------------------------------------------------------- */

export const createTradeSchema = z.object({ name: name("trade", TRADE_NAME_MAX), code: note(20) });
export const updateTradeSchema = z
  .object({ name: name("trade", TRADE_NAME_MAX).optional(), code: note(20), isActive: z.boolean().optional() })
  .refine((value) => value.name !== undefined || value.code !== undefined || value.isActive !== undefined, { message: "Nothing to change" });
export const reorderTradesSchema = z.object({ ids: z.array(id).min(1).max(300) });

export type CreateTradeInput = z.infer<typeof createTradeSchema>;
export type UpdateTradeInput = z.infer<typeof updateTradeSchema>;

/* Sites (§38) ---------------------------------------------------------------- */

export const createSiteSchema = z.object({
  name: name("site"),
  code: note(20),
  address: note(300),
  city: note(120),
  notes: note(2000),
});
export const updateSiteSchema = z
  .object({
    name: name("site").optional(),
    code: note(20),
    address: note(300),
    city: note(120),
    notes: note(2000),
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), { message: "Nothing to change" });

export type CreateSiteInput = z.infer<typeof createSiteSchema>;
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>;

/* Crews (§28-§32) ------------------------------------------------------------ */

export const createCrewSchema = z.object({
  name: name("crew"),
  projectId: optionalId,
  siteId: optionalId,
  tradeId: optionalId,
  supervisorEmployeeId: optionalId,
  notes: note(2000),
});
export const updateCrewSchema = z
  .object({
    name: name("crew").optional(),
    projectId: optionalId,
    siteId: optionalId,
    tradeId: optionalId,
    supervisorEmployeeId: optionalId,
    notes: note(2000),
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), { message: "Nothing to change" });

export type CreateCrewInput = z.infer<typeof createCrewSchema>;
export type UpdateCrewInput = z.infer<typeof updateCrewSchema>;

/**
 * Putting somebody in a crew from a day (§29, §114). Somebody already in
 * another crew is moved only when `transfer` says so: their old membership
 * closes the day before, and the history keeps both (§30, §110).
 */
export const crewAssignmentSchema = z.object({
  crewId: id,
  startDate: day,
  role: note(80),
  transfer: z.boolean().optional().default(false),
});
export type CrewAssignmentInput = z.infer<typeof crewAssignmentSchema>;

/** Ending a crew membership or a project assignment: the last day, inclusive (§41). */
export const endAssignmentSchema = z.object({ endDate: day, reason: note(300) });
export type EndAssignmentInput = z.infer<typeof endAssignmentSchema>;

/* Project assignments (§33-§42) ---------------------------------------------- */

export const projectAssignmentSchema = z.object({
  projectId: id,
  siteId: optionalId,
  tradeId: optionalId,
  role: note(80),
  isPrimary: z.boolean().optional().default(false),
  startDate: day,
  /** Moving from this assignment: it closes the day before this one starts (§42). */
  transferFromId: optionalId,
});
export type ProjectAssignmentInput = z.infer<typeof projectAssignmentSchema>;

/* The worker directory (§18, §19, §136) --------------------------------------- */

export const WORKER_SORT_KEYS = ["name-asc", "name-desc", "number-asc", "trade-asc"] as const;

export type WorkerListQuery = {
  search?: string;
  status?: Array<(typeof EMPLOYMENT_STATUSES)[number]>;
  workerCategory?: Array<(typeof WORKER_CATEGORIES)[number]>;
  accountStatus?: Array<(typeof ACCOUNT_STATUSES)[number]>;
  tradeId?: string;
  crewId?: string;
  projectId?: string;
  siteId?: string;
  sort: (typeof WORKER_SORT_KEYS)[number];
  page: number;
  limit: number;
};

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: RawParams, key: string): string | undefined {
  const value = params instanceof URLSearchParams ? (params.get(key) ?? undefined) : firstValue(params[key]);
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function list<T extends string>(value: string | undefined, allowed: readonly T[]): T[] | undefined {
  if (!value) return undefined;
  const values = value
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry): entry is T => (allowed as readonly string[]).includes(entry));
  return values.length > 0 ? values : undefined;
}

/** Shared by the page and the API; an unknown value is dropped, not refused, so a stale link still lists. */
export function parseWorkerQuery(params: RawParams): WorkerListQuery {
  const sort = read(params, "sort");
  const page = paginationSchema.parse({ page: read(params, "page"), limit: read(params, "limit") });
  return {
    search: read(params, "search")?.slice(0, 120),
    status: list(read(params, "status"), EMPLOYMENT_STATUSES),
    workerCategory: list(read(params, "workerCategory"), WORKER_CATEGORIES),
    accountStatus: list(read(params, "accountStatus"), ACCOUNT_STATUSES),
    tradeId: read(params, "tradeId"),
    crewId: read(params, "crewId"),
    projectId: read(params, "projectId"),
    siteId: read(params, "siteId"),
    sort: (WORKER_SORT_KEYS as readonly string[]).includes(sort ?? "") ? (sort as WorkerListQuery["sort"]) : "name-asc",
    ...page,
  };
}

/* Site attendance (§123, §124) ------------------------------------------------ */

const time = z
  .union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time as HH:MM."), z.literal(""), z.null()])
  .optional()
  .transform((value) => (value ? value : undefined));

export const sheetScopeSchema = z
  .object({ date: day, projectId: optionalId, siteId: optionalId, crewId: optionalId })
  .refine((value) => Boolean(value.projectId || value.crewId), { message: "Choose a project or a crew.", path: ["projectId"] })
  .refine((value) => !value.siteId || Boolean(value.projectId), { message: "A site belongs to a project: choose the project too.", path: ["siteId"] });
export type SheetScope = z.infer<typeof sheetScopeSchema>;

export const saveSheetSchema = z.object({
  date: day,
  projectId: optionalId,
  siteId: optionalId,
  crewId: optionalId,
  rows: z
    .array(
      z.object({
        employeeId: id,
        status: z.enum(SHEET_STATUSES),
        checkIn: time,
        checkOut: time,
        notes: note(500),
      }),
    )
    .min(1, "Mark at least one worker.")
    .max(500),
});
export type SaveSheetInput = z.infer<typeof saveSheetSchema>;
