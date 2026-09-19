import type { Metadata } from "next";
import Link from "next/link";

import { BrandPanel } from "@/components/layout/brand-panel";
import { NestoLogo } from "@/components/layout/nesto-logo";
import { DEMO_ACCOUNT_SECTIONS, DEMO_PASSWORD, PRIMARY_DEMO_ACCOUNTS, type DemoAccountSection } from "@/config/demo-accounts";
import { roles, type RoleKey } from "@/config/roles";
import { listDemoTenants, type DemoTenant } from "@/lib/auth/demo-tenants";
import { isDevMode } from "@/lib/auth/dev-role";
import { getTranslations } from "@/lib/i18n/server";
import { DemoAccounts, type DemoAccountOption, type DemoRosterOption } from "./demo-accounts";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("login.metaTitle") };
}

/**
 * Why the person was sent back here (PRD #6 §51, §50).
 *
 * "Your session expired" and "sign in to continue" are different messages, and
 * being told the wrong one is how people conclude software is broken.
 */
const SIGN_IN_NOTICES = {
  "session-expired": "login.sessionExpired",
  "account-unavailable": "login.accountUnavailable",
} as const;

function isSignInNotice(reason: string | undefined): reason is keyof typeof SIGN_IN_NOTICES {
  return reason !== undefined && Object.hasOwn(SIGN_IN_NOTICES, reason);
}

function option(role: RoleKey, username: string, assignment: string): DemoAccountOption {
  return { code: roles[role].code, label: roles[role].label, assignment, username };
}

/**
 * The picker's rosters: each demo tenant's people as its data has them, its
 * busiest company open (D-01 §87), then the curated five-company demo, folded.
 */
async function demoRosters(): Promise<DemoRosterOption[]> {
  // The picker is a convenience: a database it cannot read leaves the curated personas.
  const tenants: DemoTenant[] = await listDemoTenants().catch(() => []);
  const sections = new Map<DemoAccountSection, DemoAccountOption[]>();
  for (const account of PRIMARY_DEMO_ACCOUNTS) {
    sections.set(account.section, [...(sections.get(account.section) ?? []), option(account.role, account.username, account.assignment)]);
  }
  return [
    ...tenants.map((tenant) => ({
      name: tenant.name,
      summary: `${tenant.heads.length} group heads, ${tenant.companies.length} companies`,
      sections: [
        { name: tenant.name, accounts: tenant.heads.map((head) => option(head.role, head.username, head.title)) },
        ...tenant.companies.map((company, index) => ({
          name: company.name,
          accounts: company.personas.map((persona) => option(persona.role, persona.username, persona.title)),
          folded: index > 0,
        })),
      ],
    })),
    {
      name: "Five-company demo",
      summary: "Aurelia Construction and four other companies",
      sections: [...sections].map(([section, accounts]) => ({ name: DEMO_ACCOUNT_SECTIONS[section], accounts })),
      folded: tenants.length > 0,
    },
  ];
}

/**
 * Login (spec §7; design spec §83, §84).
 *
 * Split layout on desktop — brand visual beside the form. Below the desktop
 * breakpoint the visual drops away entirely and the form stands alone (§84),
 * because a decorative panel above a login form is just something to scroll
 * past on a phone.
 *
 * Authenticated visitors never reach here — middleware sends them to /dashboard.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; reason?: string }>;
}) {
  const { callbackUrl, reason } = await searchParams;
  const [t, tShell] = await Promise.all([getTranslations("auth"), getTranslations("shell")]);
  const notice = isSignInNotice(reason) ? t(SIGN_IN_NOTICES[reason]) : null;

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,42%)_minmax(0,1fr)]">
      <BrandPanel />

      <div className="flex min-h-dvh flex-col bg-surface lg:min-h-0">
        <header className="flex h-16 shrink-0 items-center px-4 sm:px-8 lg:hidden">
          <Link href="/" aria-label={tShell("homeLink")}>
            <NestoLogo />
          </Link>
        </header>

        <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-8">
          <div className="w-full max-w-lg">
            <h1 className="text-section font-semibold text-fg">{t("login.title")}</h1>
            <p className="mb-6 mt-1.5 text-body text-fg-muted">{t("login.description")}</p>

            {notice ? (
              <p
                role="status"
                className="mb-4 rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted"
              >
                {notice}
              </p>
            ) : null}

            <LoginForm callbackUrl={callbackUrl} />

            <div className="mt-6 text-center">
              <Link
                href="/"
                className="text-table text-fg-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
              >
                {t("backToHome")}
              </Link>
            </div>

            {isDevMode ? (
              <DemoAccounts rosters={await demoRosters()} password={DEMO_PASSWORD} />
            ) : null}
          </div>
        </main>

        <footer className="shrink-0 px-4 py-6 sm:px-8">
          <p className="text-meta text-fg-subtle">© {new Date().getFullYear()} NESTO</p>
        </footer>
      </div>
    </div>
  );
}
