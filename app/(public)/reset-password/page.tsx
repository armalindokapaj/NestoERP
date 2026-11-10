import type { Metadata } from "next";
import Link from "next/link";

import { FocusedFormPage, FocusedHeading } from "@/components/layout/focused-page";
import { Button } from "@/components/ui/button";
import { checkResetToken } from "@/lib/auth/password-recovery";
import { getTranslations } from "@/lib/i18n/server";
import { ResetPasswordForm } from "./reset-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  // The token is in the address: never hand it to another origin.
  return { title: t("reset.metaTitle"), referrer: "no-referrer" };
}

type Props = { searchParams: Promise<{ token?: string }> };

/** Choose a new password from a recovery link (ADM-01). Opening the page spends nothing. */
export default async function ResetPasswordPage({ searchParams }: Props) {
  const [t, tShell] = await Promise.all([getTranslations("auth"), getTranslations("shell")]);
  const { token } = await searchParams;
  const state = token && token.length <= 200 ? await checkResetToken(token) : "INVALID";

  // The same focused layout as sign-in. A link that cannot be used says only that, whatever the reason, and offers
  // the way to a new one.
  return (
    <FocusedFormPage homeLabel={tShell("homeLink")}>
      {state === "VALID" && token ? (
        <>
          <FocusedHeading title={t("reset.title")} description={t("reset.description")} />
          <ResetPasswordForm token={token} revealPassword />
        </>
      ) : (
        <>
          <FocusedHeading title={t("reset.invalidTitle")} description={t("reset.invalidDescription")} />
          <Button asChild variant="secondary">
            <Link href="/forgot-password">{t("reset.requestNewLink")}</Link>
          </Button>
        </>
      )}
    </FocusedFormPage>
  );
}
