import { redirect } from "next/navigation";

import { ASSIGNED_ROLE_VALUE } from "@/lib/modules/projects/project.portfolio-url";
import { legacyProjectsHref } from "../legacy-routes";

/**
 * My Projects became a filter on the Projects page: every project the person is
 * assigned to or manages (E-05A §4, §18.2).
 */
export default async function MyProjectsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(legacyProjectsHref(await searchParams, { role: ASSIGNED_ROLE_VALUE }));
}
