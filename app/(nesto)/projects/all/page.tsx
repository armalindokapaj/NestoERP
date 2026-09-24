import { redirect } from "next/navigation";

import { legacyProjectsHref } from "../legacy-routes";

/**
 * All Projects became the Projects page (E-05A §4). A bookmark keeps working,
 * and its search carries over.
 */
export default async function AllProjectsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(legacyProjectsHref(await searchParams));
}
