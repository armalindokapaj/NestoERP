import { PageHeader } from "@/components/ui/page-header";
import { getTranslations } from "@/lib/i18n/server";

/**
 * Help for the surfaces that have no company modules to document (UI-01 §10.3):
 * how the three universal controls work and where the account lives. Checked-in
 * text; there is no support route configured, so none is shown (§10.3 "no dead
 * support button").
 */
export async function SurfaceHelpPage({ accountHref }: { accountHref: string }) {
  const t = await getTranslations("shell");
  const sections = ["search", "notifications", "account"] as const;
  return (
    <article className="mx-auto max-w-3xl space-y-6" data-testid="surface-help">
      <PageHeader title={t("account.help")} description={t("account.helpIntro")} />
      {sections.map((key) => (
        <section key={key} className="nesto-card space-y-1.5 p-5" aria-labelledby={`help-${key}`}>
          <h2 id={`help-${key}`} className="text-card font-semibold text-fg">{t(`account.helpSections.${key}.title`)}</h2>
          <p className="text-body text-fg-muted">{t(`account.helpSections.${key}.body`)}</p>
        </section>
      ))}
      <p className="text-table text-fg-muted">
        {t("account.helpAccountPrefix")} <a className="font-medium text-accent-strong underline" href={accountHref}>{t("account.settings")}</a>.
      </p>
    </article>
  );
}
