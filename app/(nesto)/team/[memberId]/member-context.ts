import { notFound } from "next/navigation";
import type { Crumb } from "@/components/ui/breadcrumbs";

import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import type { Translate } from "@/lib/i18n/translator";
import * as team from "@/lib/modules/team/team.service";
import type { TeamMemberDetailDTO } from "@/lib/modules/team/team.types";

/**
 * Loads a member for every page under /team/[memberId] (PRD #14 §42).
 *
 * The route key is the membership id, not the user id: the same person may
 * belong to several companies, and this page is about their membership of this
 * one (PRD #14 §350). A member outside the caller's scope is a 404, not a 403,
 * so the page cannot be used to discover that somebody works here
 * (PRD #14 §160).
 */
export async function loadMember(
  memberId: string,
): Promise<{ context: UserContext; member: TeamMemberDetailDTO }> {
  const context = await requireModule("team");

  try {
    return { context, member: await team.getMember(context, memberId) };
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export function memberBreadcrumbs(t: Translate<"team">, member: TeamMemberDetailDTO, trailing?: string): Crumb[] {
  const crumbs: Crumb[] = [
    { label: t("member.crumbTeam"), href: "/team" },
    { label: t("member.crumbPeople"), href: "/team/people" },
    trailing
      ? { label: member.profile.fullName, href: `/team/${member.id}` }
      : { label: member.profile.fullName },
  ];
  if (trailing) crumbs.push({ label: trailing });
  return crumbs;
}
