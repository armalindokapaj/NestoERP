import type { Metadata } from "next";
import Link from "next/link";

import { FocusedFormPage, FocusedHeading } from "@/components/layout/focused-page";
import { Button } from "@/components/ui/button";
import { checkResetToken } from "@/lib/auth/password-recovery";
import { getTranslations } from "@/lib/i18n/server";
import { getDesignState } from "@/lib/layout/design-server";
import { ResetPasswordForm } from "./reset-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  // The token is in the address: never hand it to another origin.
  return { title: t("reset.metaTitle"), referrer: "no-referrer" };
}

type Props = { searchParams: Promise<{ token?: string }> };

/** Choose a new password from a recovery link (ADM-01). Opening the page spends nothing. */
export default async function ResetPasswordPage({ searchParams }: Props) {
  const [t, tShell, { version }] = await Promise.all([getTranslations("auth"), getTranslations("shell"), getDesignState()]);
  const { token } = await searchParams;
  const state = token && token.length <= 200 ? await checkResetToken(token) : "INVALID";

  // Version 2: the same focused layout as sign-in (UI-02 §7.5). A link that cannot be used says only that, whatever
  // the reason, and offers the way to a new one.
  if (version === "2") {
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

  return (
    <div className="mx-auto w-full max-w-md space-y-6 px-4 py-16">
      {state === "VALID" && token ? (
        <>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">{t("reset.title")}</h1>
            <p className="text-muted-foreground text-sm">{t("reset.description")}</p>
          </div>
          <ResetPasswordForm token={token} />
        </>
      ) : (
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t("reset.invalidTitle")}</h1>
          <p className="text-muted-foreground text-sm">{t("reset.invalidDescription")}</p>
          <Link href="/forgot-password" className="text-primary text-sm font-medium underline-offset-4 hover:underline">
            {t("reset.requestNewLink")}
          </Link>
        </div>
      )}
    </div>
  );
}
