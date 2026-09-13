import { isRoleKey } from "@/config/roles";
import { prisma } from "@/lib/database/prisma";
import { assembleContext, resolveEnabledModules } from "./build-context";
import type { UserContext } from "./types";

/**
 * The context of a member who is not the one making the request
 * (PRD #38 §31, §62, §76, §82).
 *
 * Collaboration keeps asking questions about other people: may this person be
 * mentioned on this record, may they review this document, may they be told
 * about this incident? Each is "could they read this record if they opened it
 * now?", and that question already has an answer — the scope builders every
 * module uses for the signed-in reader. This builds exactly the context those
 * builders take, for anybody, through the same `assembleContext` the session
 * resolver uses. A second, simpler rule for "other people" is how a mention
 * would come to tell somebody about a record they cannot see.
 *
 * Only an active member of an active company, with an active account, gets a
 * context. Everybody else is null: a suspended member is not a candidate for
 * anything. `sessionId` is empty — there is no session, and nothing that needs
 * one (signing out, auditing a request) may be done with this context.
 */

const MEMBER_INCLUDE = {
  user: true,
  role: true,
  company: true,
  department: true,
} as const;

export async function buildMemberContexts(
  companyId: string,
  memberIds: readonly string[],
): Promise<Map<string, UserContext>> {
  const unique = [...new Set(memberIds)].filter(Boolean);
  const contexts = new Map<string, UserContext>();
  if (unique.length === 0) return contexts;

  const [members, enabledModules] = await Promise.all([
    prisma.companyMember.findMany({
      where: {
        id: { in: unique },
        companyId,
        status: "ACTIVE",
        user: { status: "ACTIVE" },
        company: { status: "ACTIVE" },
      },
      include: MEMBER_INCLUDE,
    }),
    resolveEnabledModules(companyId),
  ]);

  for (const member of members) {
    // A role the application does not know is a configuration fault, not a grant.
    if (!isRoleKey(member.role.key)) continue;
    contexts.set(
      member.id,
      assembleContext({
        user: member.user,
        membership: member,
        sessionId: "",
        role: member.role.key,
        actualRole: member.role.key,
        enabledModules,
      }),
    );
  }

  return contexts;
}

export async function buildMemberContext(companyId: string, memberId: string): Promise<UserContext | null> {
  return (await buildMemberContexts(companyId, [memberId])).get(memberId) ?? null;
}
