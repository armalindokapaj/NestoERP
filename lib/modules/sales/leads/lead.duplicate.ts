import { prisma } from "@/lib/database/prisma";
import { can, isModuleEnabled } from "@/lib/access/can";
import { buildClientScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { buildLeadScopeWhere } from "../sales.scope";
import type { LeadDuplicateMatch } from "../sales.types";

/**
 * Soft duplicate detection for leads (PRD #17 §44, §158).
 *
 * A warning, never a block. Two salespeople chasing the same building company
 * is a real situation and the product's job is to say so, not to decide which
 * of them is wrong (PRD #17 §44).
 *
 * Matching is exact on normalised values — no fuzzy matching and no AI — and
 * only ever returns records the reader could already discover, so the check
 * cannot become a way to enumerate the company (PRD #17 §221).
 */

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Digits only, so `+355 69 000 0000` and `0069 0000 000` compare equal. */
function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

export type LeadDuplicateInput = {
  email?: string;
  phone?: string;
  name?: string;
  companyName?: string;
  /** Excluded when editing, so a lead never matches itself. */
  excludeLeadId?: string;
};

function canSeeClients(context: UserContext): boolean {
  return isModuleEnabled(context, "clients") && can(context, "client.view");
}

export async function findLeadDuplicates(
  context: UserContext,
  input: LeadDuplicateInput,
): Promise<LeadDuplicateMatch[]> {
  const email = input.email ? normalizeEmail(input.email) : "";
  const phone = input.phone ? normalizePhone(input.phone) : "";
  const clientName = (input.companyName ?? input.name ?? "").trim();

  if (!email && !phone && !clientName) return [];

  const [leads, clients] = await Promise.all([
    email || phone
      ? prisma.lead.findMany({
          where: {
            AND: [
              buildLeadScopeWhere(context),
              input.excludeLeadId ? { id: { not: input.excludeLeadId } } : {},
              { status: { not: "ARCHIVED" } },
              {
                OR: [
                  ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : []),
                  ...(phone ? [{ phone: { not: null } }] : []),
                ],
              },
            ],
          },
          select: { id: true, name: true, companyName: true, email: true, phone: true },
          take: 20,
        })
      : Promise.resolve([]),
    // Clients are matched through the Clients scope, so the warning cannot
    // reveal a customer this reader may not otherwise see (PRD #17 §218) —
    // and only for a reader who may see clients at all, with the module on:
    // a scope clause without `client.view` still describes the company's
    // customers (PRD #47 §70).
    (email || clientName) && canSeeClients(context)
      ? prisma.client.findMany({
          where: {
            AND: [
              buildClientScopeWhere(context),
              { archivedAt: null },
              {
                OR: [
                  ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : []),
                  ...(clientName
                    ? [{ name: { equals: clientName, mode: "insensitive" as const } }]
                    : []),
                ],
              },
            ],
          },
          select: { id: true, name: true, email: true },
          take: 10,
        })
      : Promise.resolve([]),
  ]);

  const matches: LeadDuplicateMatch[] = [];

  for (const lead of leads) {
    // The phone comparison happens here rather than in SQL: two numbers match
    // when their digits match, and the database stores whatever was typed.
    const sameEmail = Boolean(email) && normalizeEmail(lead.email ?? "") === email;
    const samePhone = Boolean(phone) && normalizePhone(lead.phone ?? "") === phone;
    if (!sameEmail && !samePhone) continue;

    matches.push({
      kind: "LEAD",
      id: lead.id,
      label: lead.companyName ? `${lead.name} — ${lead.companyName}` : lead.name,
      reason: sameEmail ? "Same email address" : "Same phone number",
    });
  }

  for (const client of clients) {
    const sameEmail = Boolean(email) && normalizeEmail(client.email ?? "") === email;
    matches.push({
      kind: "CLIENT",
      id: client.id,
      label: client.name,
      reason: sameEmail ? "A client uses this email address" : "A client already has this name",
    });
  }

  return matches;
}
