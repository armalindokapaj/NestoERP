import type * as React from "react";
import { ArrowRight } from "lucide-react";

import Link from "@/components/navigation/nav-link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { modules, type ModuleKey } from "@/config/modules";
import { HELP_VERSION, type HelpAction, type ModuleHelp } from "@/lib/help/help-content";
import { helpHref } from "@/lib/help/help-routes";
import { getTranslations } from "@/lib/i18n/server";

/**
 * Help pages (AUD-05 §7, UX-16): plain, checked-in text in the page flow — one
 * heading, then Purpose, Where things are, Key terms, What you can do and Who
 * can do what, each a real section heading so a screen reader can jump
 * between them. No tour, no overlay, nothing that follows the person around.
 *
 * Only actions the reader holds are listed (the route filters them), and each
 * one names the page's own button, so the words here are the words there.
 */
export async function ModuleHelpPage({
  moduleKey,
  help,
  sections,
  actions,
}: {
  moduleKey: ModuleKey;
  help: ModuleHelp;
  sections: string[];
  actions: HelpAction[];
}) {
  const t = await getTranslations("modules");
  const m = await getTranslations("misc");
  const label = t(`${moduleKey}.label`);

  return (
    <article className="mx-auto max-w-3xl space-y-8" data-testid="module-help" data-help-version={HELP_VERSION}>
      <PageHeader
        title={m("help.moduleTitle", { module: label })}
        description={help.purpose}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href={modules[moduleKey].route}>
              {m("help.open", { module: label })}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        }
      />

      {sections.length > 1 ? (
        <HelpSection title={m("help.whereThings")}>
          <p className="text-body text-fg-muted">{m("help.sectionsList", { module: label, sections: sections.join(", ") })}</p>
        </HelpSection>
      ) : null}

      {help.terms.length > 0 ? (
        <HelpSection title={m("help.keyTerms")}>
          <dl className="divide-y divide-line">
            {help.terms.map((term) => (
              <div key={term.term} className="grid gap-1 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-body font-medium text-fg">{term.term}</dt>
                <dd className="text-body text-fg-muted">{term.meaning}</dd>
              </div>
            ))}
          </dl>
        </HelpSection>
      ) : null}

      <HelpSection title={m("help.whatYouCanDo")}>
        {actions.length > 0 ? (
          <ul className="divide-y divide-line">
            {actions.map((action) => (
              <li key={`${action.label}:${action.permission}`} className="py-3">
                <p className="text-body font-medium text-fg">
                  {action.href ? (
                    <Link href={action.href} className="text-accent-strong underline-offset-4 hover:underline">
                      {action.label}
                    </Link>
                  ) : (
                    action.label
                  )}
                </p>
                <p className="mt-0.5 text-body text-fg-muted">{action.description}</p>
              </li>
            ))}
          </ul>
        ) : (
          // Read-only here: say how records arrive, never tell a viewer to create one (UX-15).
          <p className="text-body text-fg-muted">
            {m("help.readOnly", { module: label })}
          </p>
        )}
      </HelpSection>

      <HelpSection title={m("help.whoCanDo")}>
        <p className="text-body text-fg-muted">{help.permissions}</p>
      </HelpSection>

      <p className="text-meta text-fg-subtle">
        <Link href="/help" className="underline-offset-4 hover:underline">
          {m("help.otherModules")}
        </Link>
      </p>
    </article>
  );
}

/** `embedded`: inside Support's Help tab, under Support's own heading, so the page keeps one h1. */
export async function HelpIndex({ modules: keys, embedded = false }: { modules: ModuleKey[]; embedded?: boolean }) {
  const t = await getTranslations("modules");
  const m = await getTranslations("misc");
  return (
    <div className={embedded ? "max-w-3xl space-y-4" : "mx-auto max-w-3xl space-y-6"} data-testid="help-index" data-help-version={HELP_VERSION}>
      {embedded ? (
        <p className="text-body text-fg-muted">{m("help.description")}</p>
      ) : (
        <PageHeader title={m("help.title")} description={m("help.description")} />
      )}
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {keys.map((key) => (
          <li key={key}>
            <Link href={helpHref(key)} className="flex items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent touch:min-h-11">
              <span className="min-w-0">
                <span className="block text-body font-medium text-fg">{t(`${key}.label`)}</span>
                <span className="block text-table text-fg-muted">{t(`${key}.description`)}</span>
              </span>
              <ArrowRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-fg-subtle" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-section font-semibold text-fg">{title}</h2>
      {children}
    </section>
  );
}
