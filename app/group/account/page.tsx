import type { Metadata } from "next";

import { PasswordForm } from "@/components/settings/password-form";
import { changeGroupPasswordAction } from "@/lib/actions/group-account";
import { requireGroupContext } from "@/lib/context/group-context";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminAccess");
  return { title: t("account.metaTitle") };
}

/** A group-only person's own password (Admin PRD #9); sessions and recovery stay with the company account pages. */
export default async function GroupAccountPage() {
  const t = await getTranslations("adminAccess");
  const context = await requireGroupContext();
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-page font-semibold text-fg">{t("account.title")}</h1>
        <p className="mt-1 text-body text-fg-muted">{context.fullName} · <span className="font-mono text-meta">{context.username}</span></p>
      </div>
      <section className="nesto-card p-6" aria-labelledby="password-title">
        <h2 id="password-title" className="text-card font-semibold text-fg">{t("account.passwordHeading")}</h2>
        <p className="mt-1 text-table text-fg-muted">{t("account.passwordNote")}</p>
        <div className="mt-4"><PasswordForm action={changeGroupPasswordAction} /></div>
      </section>
    </div>
  );
}
