import type { Metadata } from "next";

import { LegalDocumentPage } from "@/components/marketing/legal-document";
import { getSiteCopy } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { privacy } = (await getSiteCopy()).legal;
  return { title: privacy.eyebrow, description: privacy.lead };
}

export default async function PrivacyPage() {
  const { privacy } = (await getSiteCopy()).legal;
  return <LegalDocumentPage document={privacy} />;
}
