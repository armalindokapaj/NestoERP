import type { Prisma } from "@prisma/client";

import { buildClientScopeWhere } from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";

/**
 * Soft duplicate detection (PRD #12 §51–§55, §150).
 *
 * Two different rules, deliberately:
 *
 *   hard  — `companyId + code` is a database constraint. A clash is refused.
 *   soft  — an identical normalised name, legal name, email or phone raises a
 *           warning the user may accept, because "ACME Development" and
 *           "ACME Developments" might genuinely be two companies and only a
 *           person can say (PRD #12 §52).
 *
 * No fuzzy matching and no AI: exact matches on normalised values only.
 */

/**
 * Normalisation used for comparison, never for display: the stored name keeps
 * whatever the user typed (PRD #12 §55).
 */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,''"“”&()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Digits only, so `+355 00 000` and `035500000` compare equal. */
function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

export type DuplicateMatch = {
  id: string;
  name: string;
  code: string | null;
  status: string;
  /** Which field matched, so the warning can say why (PRD #12 §53). */
  reason: "name" | "legalName" | "email" | "phone";
};

export type DuplicateCheckInput = {
  name?: string;
  legalName?: string;
  email?: string;
  phone?: string;
  /** Excluded when editing, so a client never matches itself. */
  excludeClientId?: string;
};

export async function findPossibleDuplicates(
  context: UserContext,
  input: DuplicateCheckInput,
): Promise<DuplicateMatch[]> {
  const name = input.name ? normalizeName(input.name) : "";
  const legalName = input.legalName ? normalizeName(input.legalName) : "";
  const email = input.email ? normalizeEmail(input.email) : "";
  const phone = input.phone ? normalizePhone(input.phone) : "";

  const candidates: Prisma.ClientWhereInput[] = [];
  if (name) candidates.push({ normalizedName: name });
  if (legalName) candidates.push({ normalizedName: legalName });
  if (email) candidates.push({ email: { equals: email, mode: "insensitive" } });
  if (candidates.length === 0 && !phone) return [];

  // Only clients this user could already discover are ever returned, so the
  // duplicate check cannot become a way to enumerate the company (PRD #12 §126).
  const rows = await prisma.client.findMany({
    where: {
      AND: [
        buildClientScopeWhere(context),
        ...(input.excludeClientId ? [{ id: { not: input.excludeClientId } }] : []),
        // A phone match needs digit normalisation, which SQL cannot do here, so
        // phone candidates are filtered in a second pass below.
        ...(candidates.length > 0 ? [{ OR: candidates }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      legalName: true,
      email: true,
      phone: true,
      normalizedName: true,
    },
    take: 5,
  });

  const phoneRows = phone
    ? await prisma.client.findMany({
        where: {
          AND: [
            buildClientScopeWhere(context),
            ...(input.excludeClientId ? [{ id: { not: input.excludeClientId } }] : []),
            { phone: { not: null } },
          ],
        },
        select: {
          id: true,
          name: true,
          code: true,
          status: true,
          legalName: true,
          email: true,
          phone: true,
          normalizedName: true,
        },
        take: 200,
      })
    : [];

  const matches = new Map<string, DuplicateMatch>();

  for (const row of rows) {
    const reason: DuplicateMatch["reason"] | null =
      name && row.normalizedName === name
        ? "name"
        : legalName && row.normalizedName === legalName
          ? "legalName"
          : email && row.email && normalizeEmail(row.email) === email
            ? "email"
            : null;
    if (reason) {
      matches.set(row.id, { id: row.id, name: row.name, code: row.code, status: row.status, reason });
    }
  }

  for (const row of phoneRows) {
    if (matches.has(row.id)) continue;
    if (row.phone && normalizePhone(row.phone) === phone) {
      matches.set(row.id, {
        id: row.id,
        name: row.name,
        code: row.code,
        status: row.status,
        reason: "phone",
      });
    }
  }

  return [...matches.values()].slice(0, 5);
}

export const duplicateReasonLabels: Record<DuplicateMatch["reason"], string> = {
  name: "Same name",
  legalName: "Same legal name",
  email: "Same email address",
  phone: "Same phone number",
};
