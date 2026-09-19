import { notFound, redirect } from "next/navigation";

import { requireModule } from "@/lib/context/current-user";
import { personIdFor } from "@/lib/modules/people/person.refs";

type Props = { params: Promise<{ employeeId: string }> };

/**
 * The profile of the person behind an employment (E-08 §69): the one route a
 * `<PersonLink>` that has only that id leads through, to the canonical
 * `/people/[personId]`. Another group's id, or a made-up one, is not found.
 */
export default async function PersonByEmployeePage({ params }: Props) {
  const { employeeId } = await params;
  const context = await requireModule("people");
  const personId = await personIdFor(context, "employee", employeeId);
  if (!personId) notFound();
  redirect(`/people/${personId}`);
}
