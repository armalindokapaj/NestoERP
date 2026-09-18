import { notFound, redirect } from "next/navigation";

import { requireModule } from "@/lib/context/current-user";
import { myPersonId } from "@/lib/modules/people/people.service";

/** Your own profile (E-01 §10): the person behind the signed-in account. */
export default async function MyProfilePage() {
  const context = await requireModule("people");
  const personId = await myPersonId(context);
  if (!personId) notFound();
  redirect(`/people/${personId}`);
}
