import { notFound, redirect } from "next/navigation";

import { requireModule } from "@/lib/context/current-user";
import { personIdFor } from "@/lib/modules/people/person.refs";

type Props = { params: Promise<{ userId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The profile of the person behind a login (E-08 §69): the one route a
 * `<PersonLink>` that has only that id leads through, to the canonical
 * `/people/[personId]`. Another group's id, or a made-up one, is not found.
 */
export default async function PersonByUserPage({ params, searchParams }: Props) {
  const { userId } = await params;
  const context = await requireModule("people");
  const personId = await personIdFor(context, "user", userId);
  if (!personId) notFound();
  const tab = (await searchParams).tab;
  redirect(typeof tab === "string" ? `/people/${personId}?tab=${encodeURIComponent(tab)}` : `/people/${personId}`);
}
