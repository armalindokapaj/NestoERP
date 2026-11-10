import type { Metadata } from "next";
import Link from "next/link";

import { LocaleSwitch } from "@/components/i18n/locale-switch";
import { NestoLogo } from "@/components/layout/nesto-logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { applicationDepartments } from "@/config/marketing";
import { getLocale, getSiteCopy, getTranslations } from "@/lib/i18n/server";
import { getPublicPricingConfig } from "@/lib/modules/pricing/pricing.service";

import { ApplyForm } from "./apply-form";

export async function generateMetadata(): Promise<Metadata> {
  const { apply } = await getSiteCopy();
  return { title: apply.meta.title, description: apply.meta.description, alternates: { canonical: "/apply" } };
}

/**
 * Apply for a workspace — the public site's "sign up" (UI-05 §6).
 *
 * NESTO workspaces are set up by NESTO with the company, so a visitor applies
 * rather than registers: four short steps beside a drawn permit that fills in
 * as they answer, with a sample monthly estimate read from the live price
 * book. Bare like sign-in — one task, no marketing navigation to wander into.
 */
export default async function ApplyPage() {
  const [locale, site, tModules, pricing] = await Promise.all([
    getLocale(),
    getSiteCopy(),
    getTranslations("modules"),
    getPublicPricingConfig().catch(() => null),
  ]);
  const departments = applicationDepartments.map((key) => ({ key, label: tModules(`${key}.label`) }));

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="border-b-2 border-fg">
        <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center gap-3.5 px-[clamp(16px,4vw,48px)]">
          <Link href="/" aria-label={site.header.home} className="shrink-0 rounded-md">
            <NestoLogo />
          </Link>
          <span aria-hidden="true" className="hidden h-5 w-px bg-line-strong sm:block" />
          <p className="nesto-eyebrow hidden whitespace-nowrap text-fg-subtle sm:block">{site.apply.title}</p>
          <p className="ml-auto text-table text-fg-muted max-md:hidden">
            {site.apply.haveAccount}{" "}
            <Link href="/login" className="font-medium text-fg underline-offset-4 hover:underline">
              {site.apply.signIn}
            </Link>
          </p>
          <Link href="/login" className="ml-auto text-table font-medium text-fg md:hidden">
            {site.apply.signIn}
          </Link>
          <ThemeToggle />
          <LocaleSwitch label={site.header.language} />
        </div>
      </header>
      <main className="flex-1">
        <ApplyForm copy={site.apply} departments={departments} pricing={pricing} locale={locale} />
      </main>
    </div>
  );
}
