import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { isDevMode } from "@/lib/auth/dev-mode";
import { readThemeChoice, THEME_COOKIE } from "@/lib/layout/theme-state";

import { ButtonEntry, IconButtonEntry } from "./_catalog/buttons";
import { CardEntry, MetricStripEntry } from "./_catalog/cards";
import { FieldEntry } from "./_catalog/fields";
import { BadgeEntry, TagEntry } from "./_catalog/status";
import { TableEntry } from "./_catalog/tables";
import { CatalogToolbar } from "./_catalog/toolbar";

export const metadata: Metadata = { title: "Component catalog", robots: { index: false, follow: false } };

/* Reads the preference cookies, and must never be prerendered into a build. */
export const dynamic = "force-dynamic";

const ENTRIES = [
  ["buttons", "Button"],
  ["icon-buttons", "IconButton"],
  ["badges", "Badge"],
  ["tags", "Tag"],
  ["cards", "Card"],
  ["metrics", "MetricStrip"],
  ["tables", "Table"],
  ["fields", "Inputs"],
] as const;

/**
 * The component catalog: the shared primitives of components/ui, each in
 * every state it has, in Day or Night as the switch at the top chooses. The
 * specimens are the real
 * components — nothing here is a picture of one — so what this page shows is
 * what the product renders.
 *
 * A developer's page, in English like the other development tools. It exists
 * only where development conveniences do — a developer's machine, and a
 * hosted demo that turns them on (APP_ENV=demo or NESTO_DEMO_MODE; lib/auth/
 * dev-mode.ts) — and is a 404 everywhere else, before anything is read (held
 * by `pnpm verify:production-guards`). It
 * sits outside the application shells on purpose — a primitive is shown on the
 * page ground, with no module's layout around it — and behind the session gate
 * like every route that is not public (lib/permissions/route-access.ts).
 */
export default async function ComponentCatalogPage() {
  if (!isDevMode) notFound();

  const theme = readThemeChoice((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <div className="min-h-dvh bg-canvas" data-testid="component-catalog">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas">
        <div className="mx-auto flex min-h-(--nesto-shell-header-h) max-w-[1280px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-(--nesto-space-page-x) py-2">
          <div className="min-w-0">
            <h1 className="text-card font-semibold text-fg">Component catalog</h1>
            <p className="text-meta text-fg-muted">Shared primitives · Nesto theme · development only</p>
          </div>
          <CatalogToolbar theme={theme} />
        </div>
        <nav aria-label="Catalog entries" className="mx-auto max-w-[1280px] overflow-x-auto px-(--nesto-space-page-x)">
          {/* 39px and the header's 1px border: the breadcrumb bar's 40. */}
          <ul className="flex min-h-[39px] items-center gap-1 text-table">
            {ENTRIES.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="inline-flex min-h-8 items-center whitespace-nowrap rounded-md px-2 text-fg-muted transition-colors hover:bg-hover hover:text-fg touch:min-h-11">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main id="nesto-main" tabIndex={-1} className="mx-auto max-w-[1280px] px-(--nesto-space-page-x) py-8 focus:outline-none">
          <ButtonEntry />
          <IconButtonEntry />
          <BadgeEntry />
          <TagEntry />
          <CardEntry />
          <MetricStripEntry />
          <TableEntry />
          <FieldEntry />
      </main>
    </div>
  );
}
