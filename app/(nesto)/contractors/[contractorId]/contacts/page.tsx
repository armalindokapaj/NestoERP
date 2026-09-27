import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ContactsPanel } from "@/components/contractors/contractor-panels";
import { orNotFound } from "@/components/engineering/page-helpers";
import { requireModule } from "@/lib/context/current-user";
import { listContacts } from "@/lib/modules/contractors/contractor.contacts";
import { getContractor } from "@/lib/modules/contractors/contractor.service";

type Params = { params: Promise<{ contractorId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("contractors"))("meta.contacts") };
}

/** The contractor's people — contact records, never logins (PRD #46 §20-§23). */
export default async function ContractorContactsPage({ params }: Params) {
  const { contractorId } = await params;
  const context = await requireModule("contractors");
  const contractor = await orNotFound(getContractor(context, contractorId));
  if (!contractor.capabilities.canViewContacts) redirect("/access-denied");
  const contacts = await listContacts(context, contractor.id);
  return <ContactsPanel contractorId={contractor.id} contacts={contacts} canManage={contractor.capabilities.canManageContacts} />;
}
