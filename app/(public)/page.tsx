import Link from "next/link";
import {
  ArrowRight,
  Building2,
  FileText,
  FolderKanban,
  ShoppingCart,
  Users,
  Wallet,
} from "lucide-react";

import { NestoLogo } from "@/components/layout/nesto-logo";
import { PublicNav } from "@/components/layout/public-nav";
import { Button } from "@/components/ui/button";

/**
 * Public NESTO home page (spec §6; design spec §81, §82).
 * Deliberately small: introduce the platform and provide access to it. This is
 * not a marketing site — few words, large type, generous whitespace.
 */

const platform = [
  { icon: FolderKanban, title: "Projects", copy: "Plan, track and deliver work in one connected place." },
  { icon: Users, title: "People", copy: "Teams, roles and responsibilities across the company." },
  { icon: Building2, title: "Clients", copy: "Every client, contact and relationship in one record." },
  { icon: ShoppingCart, title: "Operations", copy: "Procurement, inventory, quality and safety." },
  { icon: Wallet, title: "Finance", copy: "Revenue, costs, invoicing and budgets." },
  { icon: FileText, title: "Documents", copy: "Company and project documentation, together." },
];

const teams = [
  "Management",
  "Project Teams",
  "Finance",
  "HR",
  "Sales",
  "Operations",
];

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="NESTO home">
            <NestoLogo />
          </Link>
          <PublicNav />
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="border-b border-line">
          <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
            <p className="text-micro font-semibold uppercase tracking-[0.18em] text-fg-subtle">
              NESTO
            </p>
            <h1 className="mt-5 max-w-3xl font-serif text-display text-fg sm:text-hero">
              One platform to run your company.
            </h1>
            <p className="mt-6 max-w-2xl text-body leading-relaxed text-fg-muted sm:text-card">
              Projects, clients, teams, operations and company management inside one
              connected workspace.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/login">
                  Login to NESTO
                  <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <a href="#about">Request access</a>
              </Button>
            </div>
          </div>
        </section>

        {/* Platform */}
        <section id="platform" className="border-b border-line bg-surface">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <h2 className="text-page font-semibold text-fg">The platform</h2>
            <p className="mt-2.5 max-w-2xl text-body text-fg-muted">
              Every part of the company works from the same structure, so nothing
              lives in a separate system.
            </p>

            <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
              {platform.map((item) => (
                <div key={item.title} className="bg-surface p-6">
                  <item.icon className="size-5 text-fg-subtle" />
                  <h3 className="mt-4 text-card font-semibold text-fg">{item.title}</h3>
                  <p className="mt-1.5 text-table leading-relaxed text-fg-muted">{item.copy}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Built for teams */}
        <section id="teams" className="border-b border-line">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <h2 className="text-page font-semibold text-fg">Built for teams</h2>
            <p className="mt-2.5 max-w-2xl text-body text-fg-muted">
              Each role signs in to a workspace shaped around the work they
              actually do.
            </p>

            <ul className="mt-8 flex flex-wrap gap-2">
              {teams.map((team) => (
                <li
                  key={team}
                  className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-table font-medium text-fg-muted"
                >
                  {team}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* About / access */}
        <section id="about" className="border-b border-line bg-surface">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="max-w-2xl">
              <h2 className="text-page font-semibold text-fg">About NESTO</h2>
              <p className="mt-3 text-body leading-relaxed text-fg-muted">
                NESTO is a single connected workspace for running a company —
                projects, people, clients, operations and finance in one system
                rather than a stack of disconnected tools.
              </p>
              <p className="mt-3 text-body leading-relaxed text-fg-muted">
                Access is provided by your company administrator. If you already
                have an account, sign in to continue.
              </p>
              <Button asChild variant="secondary" size="md" className="mt-6">
                <Link href="/login">Login to NESTO</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-8 sm:px-6">
          <NestoLogo />
          <nav className="flex items-center gap-5">
            <span className="text-table text-fg-subtle">Privacy</span>
            <span className="text-table text-fg-subtle">Terms</span>
            <a href="#about" className="text-table text-fg-muted transition-colors hover:text-fg">
              Contact
            </a>
          </nav>
          <p className="ml-auto text-table text-fg-subtle">
            © {new Date().getFullYear()} NESTO
          </p>
        </div>
      </footer>
    </div>
  );
}
