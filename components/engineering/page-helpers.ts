import { notFound, redirect } from "next/navigation";

import { AccessError } from "@/lib/access/guards";

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

export function pageHref(base: string, params: Record<string, string | string[] | undefined>, page: number): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (typeof value === "string" && key !== "page") next.set(key, value);
  if (page > 1) next.set("page", String(page));
  return `${base}${next.size ? `?${next}` : ""}`;
}

/** "1 project", "2 projects" — the noun that follows a count. */
export const counted = (count: number, noun: string) => (count === 1 ? noun : `${noun}s`);
