import type { Metadata } from "next";

import { LegalDocumentPage } from "@/components/marketing/legal-document";
import { termsDocument } from "@/config/marketing";

export const metadata: Metadata = {
  title: "Terms",
  description: termsDocument.lead,
};

export default function TermsPage() {
  return <LegalDocumentPage document={termsDocument} />;
}
