import { redirect } from "next/navigation";

import { legacyProjectsHref } from "../legacy-routes";

/**
 * All Projects became the Projects page (E-05A §4). A bookmark keeps working:
 * its search and status carry over, in the words E-05A renamed them to.
 */
export default async function AllProjectsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(legacyProjectsHref(await searchParams));
}
