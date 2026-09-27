import { notFound } from "next/navigation";
import type { Crumb } from "@/components/ui/breadcrumbs";

import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as leave from "@/lib/modules/hr/leave/leave.service";
import type { LeaveRequestDTO } from "@/lib/modules/hr/hr.types";
import { hrLabel } from "@/components/hr/hr-labels";
import { getTranslations } from "@/lib/i18n/server";
import type { Translate } from "@/lib/i18n/translator";

/**
 * Loads a leave request for every page under /hr/leave/[leaveId].
 *
 * A request outside the caller's scope is a 404, not a 403 (PRD #16 §202).
 */
export async function loadLeave(
  leaveId: string,
): Promise<{ context: UserContext; request: LeaveRequestDTO }> {
  const context = await requireModule("hr");

  try {
    return { context, request: await leave.getLeave(context, leaveId) };
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export function leaveLabel(t: Translate<"hr">, request: LeaveRequestDTO): string {
  return `${hrLabel(t, "leaveType", request.leaveType)} — ${request.employee.fullName}`;
}

export async function leaveBreadcrumbs(request: LeaveRequestDTO, trailing?: string): Promise<Crumb[]> {
  const t = await getTranslations("hr");
  const crumbs: Crumb[] = [
    { label: t("meta.hr"), href: "/hr" },
    { label: t("meta.leave"), href: "/hr/leave" },
    trailing
      ? { label: leaveLabel(t, request), href: `/hr/leave/${request.id}` }
      : { label: leaveLabel(t, request) },
  ];
  if (trailing) crumbs.push({ label: trailing });
  return crumbs;
}
