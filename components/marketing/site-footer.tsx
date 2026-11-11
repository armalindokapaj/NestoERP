import Link from "next/link";

import { NestoLogo } from "@/components/layout/nesto-logo";
import { brand } from "@/config/brand";
import { footerNav } from "@/config/marketing";
import { getSiteCopy } from "@/lib/i18n/server";

/**
 * Public site footer (design spec §82; UI-05 §2.4).
 *
 * The sitemap in full — a visitor should never have to guess whether a page
 * exists — closed by the drawing's title block: who, what, which revision.
 */
export async function SiteFooter() {
  const copy = await getSiteCopy();
  const block = [`© ${new Date().getFullYear()} ${brand.name}`, copy.category, brand.signoff.join(" · "), brand.version];

  return (
    <footer className="border-t-2 border-fg bg-canvas">
      <div className="mx-auto w-full max-w-[1280px] px-[clamp(16px,4vw,48px)] pb-10 pt-14 sm:pt-16">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.85fr)]">
          <div className="max-w-sm">
            <NestoLogo size="md" />
            <p className="mt-5 text-body leading-relaxed text-fg-muted">{copy.summary}</p>
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

        <ul className="site-tb mt-14 grid-cols-2 border-r-0 border-b-0 sm:grid-cols-4">
          {block.map((cell) => (
            <li key={cell} className="site-tb-cell">
              <span className="font-mono text-[10.5px] max-md:text-meta uppercase tracking-[0.12em] text-fg-muted">{cell}</span>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
