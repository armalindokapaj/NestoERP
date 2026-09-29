import { prisma } from "@/lib/database/prisma";
import { fullName } from "@/lib/utils/format";

/**
 * Who did it, for a record's "by" line (user, 2026-09-29).
 *
 * Names are resolved inside one company only, so an id that belongs elsewhere
 * resolves to nothing rather than to a stranger's name.
 */
export type ActorDTO = { memberId: string; name: string };

export async function memberNames(companyId: string, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return new Map();
  const rows = await prisma.companyMember.findMany({ where: { companyId, id: { in: wanted } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } });
  return new Map(rows.map((row) => [row.id, fullName(row.user.firstName, row.user.lastName)]));
}

/** The actor for one id, or null when there is none or it is not this company's. */
export function actorOf(names: Map<string, string>, memberId: string | null | undefined): ActorDTO | null {
  if (!memberId) return null;
  const name = names.get(memberId);
  return name ? { memberId, name } : null;
}
