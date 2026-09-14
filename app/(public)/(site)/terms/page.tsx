import type { Metadata } from "next";

import { LegalDocumentPage } from "@/components/marketing/legal-document";
import { getSiteCopy } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { terms } = (await getSiteCopy()).legal;
  return { title: terms.eyebrow, description: terms.lead };
}

export default async function TermsPage() {
  const { terms } = (await getSiteCopy()).legal;
  return <LegalDocumentPage document={terms} />;
}
