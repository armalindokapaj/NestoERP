import { notFound, redirect } from "next/navigation";

import { AccessError } from "@/lib/access/guards";
import { listPageRedirect, pageHref as listPageHref } from "@/lib/modules/shared/list-query";

/**
 * Page-side translation of service refusals (PRD #46 §247): a record outside
 * the reader's reach is a 404, a missing grant the access-denied page — the
 * same answers the API gives.
 */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    if (error instanceof AccessError && error.code === "FORBIDDEN") redirect("/access-denied");
    throw error;
  }
}

export const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The query a register page passes to its list schema: first value of each param. */
export function flat(params: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).flatMap(([key, value]) => (one(value) ? [[key, one(value)!]] : [])));
}

/** The URL of `page` of a register, every other query key kept (AUD-08 §3, §4). */
export function pageHref(base: string, params: Record<string, string | string[] | undefined>, page: number, pageParam = "page"): string {
  return listPageHref(base, params, page, pageParam);
}

/** A register answer as `Pagination` reads it: total matching records, never loaded rows (AUD-08 §4). */
export function registerMeta(result: { total: number; page: number; pageSize: number }) {
  return { page: result.page, limit: result.pageSize, total: result.total, totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)) };
}

/**
 * A register page asked for past its end — after a void, an archive or a
 * narrower filter — moves once to the last real page (page 1 when nothing
 * matches), every other query key kept (AUD-08 §4, DT-05). The service clamps
 * `result.page`, so the target is always in range and there is no loop.
 */
export function keepPageInRange(base: string, params: Record<string, string | string[] | undefined>, requested: number, result: { page: number }, pageParam = "page"): void {
  if (result.page !== requested) redirect(listPageRedirect(base, params, result.page, pageParam));
}

/** "1 project", "2 projects" — the noun that follows a count. */
export const counted = (count: number, noun: string) => (count === 1 ? noun : `${noun}s`);
