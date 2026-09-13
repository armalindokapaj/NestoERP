import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Languages } from "lucide-react";

import { getIcon } from "@/components/layout/nav-icon";
import { LanguagePreference } from "@/components/settings/language-preference";
import { visibleSettingsSections } from "@/lib/access/settings-sections";
import { requireUserContext } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

/**
 * Settings landing page (PRD #5 §39).
 * Sections the role cannot open are absent, not disabled.
 *
 * Language sits here, above the sections, rather than inside one of them:
 * every role reaches this page, and somebody who cannot read the language on
 * screen should not have to guess which card hides the way out of it.
 */
export default async function SettingsPage() {
  const context = await requireUserContext();
  const sections = visibleSettingsSections(context);
  const t = await getTranslations("settings");

  // Only a language whose translation is still partial says so; English is
  // the source and leaves the note empty.
  const partialNote = t("language.partial");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-page font-semibold text-fg">{t("title")}</h1>
        <p className="mt-1 text-body text-fg-muted">{t("description")}</p>
      </div>

      <section className="nesto-card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-hover text-fg-muted">
            <Languages aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-card font-semibold text-fg">{t("language.title")}</h2>
            <p className="mt-1 text-table text-fg-muted">{t("language.description")}</p>
            {partialNote ? (
              <p className="mt-1 text-meta text-fg-subtle">{partialNote}</p>
            ) : null}
          </div>
        </div>
        <LanguagePreference />
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => {
          const Icon = getIcon(section.icon);
          return (
            <Link
              key={section.slug}
              href={`/settings/${section.slug}`}
              className="nesto-card group flex items-start gap-3 p-5 transition-colors hover:border-line-strong hover:bg-surface-muted"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-hover text-fg-muted">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-card font-semibold text-fg">
                    {t(`sections.${section.slug}.label`)}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="mt-1 block text-table text-fg-muted">
                  {t(`sections.${section.slug}.description`)}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
