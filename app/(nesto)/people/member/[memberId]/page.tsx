import { notFound, redirect } from "next/navigation";

import { requireModule } from "@/lib/context/current-user";
import { personIdFor } from "@/lib/modules/people/person.refs";

type Props = { params: Promise<{ memberId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The profile of the person behind a company membership (E-08 §69): the one route a
 * `<PersonLink>` that has only that id leads through, to the canonical
 * `/people/[personId]`. Another group's id, or a made-up one, is not found.
 */
export default async function PersonByMemberPage({ params, searchParams }: Props) {
  const { memberId } = await params;
  const context = await requireModule("people");
  const personId = await personIdFor(context, "member", memberId);
  if (!personId) notFound();
  const tab = (await searchParams).tab;
  redirect(typeof tab === "string" ? `/people/${personId}?tab=${encodeURIComponent(tab)}` : `/people/${personId}`);
}
