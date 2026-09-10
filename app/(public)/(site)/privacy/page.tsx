import type { Metadata } from "next";

import { LegalDocumentPage } from "@/components/marketing/legal-document";
import { privacyDocument } from "@/config/marketing";

export const metadata: Metadata = {
  title: "Privacy",
  description: privacyDocument.lead,
};

export default function PrivacyPage() {
  return <LegalDocumentPage document={privacyDocument} />;
}
