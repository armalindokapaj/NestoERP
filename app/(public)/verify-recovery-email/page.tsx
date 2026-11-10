import type { Metadata } from "next";

import { FocusedFormPage, FocusedHeading } from "@/components/layout/focused-page";
import { getTranslations } from "@/lib/i18n/server";
import { VerifyRecoveryEmail } from "./verify-recovery-email";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("verifyRecovery.metaTitle"), referrer: "no-referrer" };
}

type Props = { searchParams: Promise<{ token?: string }> };

/**
 * Confirms a new recovery email (ADM-01). Confirmation is a button press, not
 * the page load, so a mail scanner that opens links cannot confirm for anyone.
 */
export default async function VerifyRecoveryEmailPage({ searchParams }: Props) {
  const [t, tShell] = await Promise.all([getTranslations("auth"), getTranslations("shell")]);
  const { token } = await searchParams;
  // The same focused layout as sign-in.
  return (
    <FocusedFormPage homeLabel={tShell("homeLink")}>
      <FocusedHeading title={t("verifyRecovery.title")} description={t("verifyRecovery.description")} />
      <VerifyRecoveryEmail token={token ?? ""} />
    </FocusedFormPage>
  );
}
