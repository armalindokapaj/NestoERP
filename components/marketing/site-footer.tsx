import Link from "next/link";

import { BlueprintSurvey } from "@/components/marketing/blueprint";
import { NestoLogo } from "@/components/layout/nesto-logo";
import { brand } from "@/config/brand";
import { footerNav } from "@/config/marketing";
import { getSiteCopy } from "@/lib/i18n/server";

/**
 * Public site footer (design spec §82).
 *
 * The sitemap in full — a visitor should never have to guess whether a page
 * exists. The survey line above it is the same drawing language as the rest of
 * the site, closing the page the way the hero opened it.
 */
export async function SiteFooter() {
  const copy = await getSiteCopy();

  return (
    <footer className="relative border-t border-line bg-surface">
      <BlueprintSurvey className="absolute inset-x-0 top-0 h-12 w-full text-line-strong opacity-60" />

      <div className="relative mx-auto w-full max-w-6xl px-5 pb-10 pt-16 sm:px-8 sm:pt-20">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.85fr)]">
          <div className="max-w-sm">
            <NestoLogo size="md" />
            <p className="mt-5 text-body leading-relaxed text-fg-muted">{copy.summary}</p>
            <p className="nesto-eyebrow mt-6 text-fg-subtle">{copy.category}</p>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {footerNav.map((column) => (
              <nav key={column.key} aria-label={copy.footer.columns[column.key]}>
                <h2 className="nesto-eyebrow text-fg-subtle">{copy.footer.columns[column.key]}</h2>
                <ul className="mt-4 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.key}>
                      <Link
                        href={link.href}
                        className="text-table text-fg-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
                      >
                        {copy.footer.links[link.key]}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-6">
          <p className="text-meta text-fg-subtle">
            © {new Date().getFullYear()} {brand.name}
          </p>
          <p className="nesto-eyebrow text-fg-subtle">{brand.signoff.join(" · ")}</p>
          <p className="ml-auto text-meta text-fg-subtle">{brand.version}</p>
        </div>
      </div>
    </footer>
  );
}
