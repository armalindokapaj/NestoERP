import { redirect } from "next/navigation";

import { legacyProjectsHref } from "../legacy-routes";

/**
 * My Projects became the Projects page (E-05A §4). It was a filter there until
 * the Workspace Grid PRD removed the role filter: the projects a person can
 * open are already the ones their access and assignments give them (§136, §137).
 */
export default async function MyProjectsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(legacyProjectsHref(await searchParams));
}
