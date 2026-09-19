"use client";

import { useState, useTransition, type ReactNode } from "react";
import { ChevronDown, LogIn, TriangleAlert } from "lucide-react";

import { signInAsDemoAccountAction } from "@/lib/actions/demo";
import type { DemoAccountOption, DemoRosterOption } from "@/lib/auth/demo-tenants";
import { cn } from "@/lib/utils/cn";

/**
 * Development-only account picker (spec §65, §66).
 *
 * One click signs in as that persona — no typing — so the demo personas
 * (E-06 §48) can be walked through quickly: each demo tenant's people first,
 * its busiest company open and the others folded, then the curated five-company
 * demo, folded. The password lives on the server: the button sends only a
 * username to signInAsDemoAccountAction, which accepts nothing but a curated
 * persona or a demo tenant's login. Once inside, the top bar's demo user
 * switcher offers the same roster (C-01 §41).
 *
 * The login page renders this solely when the app is built in development.
 */
export function DemoAccounts({ rosters, password }: { rosters: DemoRosterOption[]; password: string }) {
  const [open, setOpen] = useState(true);
  const [unfolded, setUnfolded] = useState<string[]>([]);
  const [pendingUsername, setPendingUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const signInAs = (username: string) => {
    setError(null);
    setPendingUsername(username);
    startTransition(async () => {
      // A successful sign-in redirects, so anything returned is a failure.
      const result = await signInAsDemoAccountAction(username);
      if (result?.error) {
        setError(result.error);
        setPendingUsername(null);
      }
    });
  };

  const fold = (key: string, name: string, summary: string, children: ReactNode) => {
    const isOpen = unfolded.includes(key);
    return (
      <section key={key} aria-label={name} className="rounded-md border border-line bg-surface-muted">
        <button
          type="button"
          onClick={() => setUnfolded((keys) => (isOpen ? keys.filter((other) => other !== key) : [...keys, key]))}
          aria-expanded={isOpen}
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        >
          <span className="min-w-0">
            <span className="block truncate text-table font-medium text-fg">{name}</span>
            <span className="block truncate text-meta text-fg-muted">{summary}</span>
          </span>
          <ChevronDown className={cn("size-4 shrink-0 text-fg-subtle transition-transform", isOpen && "rotate-180")} />
        </button>
        {isOpen ? <div className="space-y-3 border-t border-line p-2.5">{children}</div> : null}
      </section>
    );
  };

  const accountList = (accounts: DemoAccountOption[]) => (
    <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {accounts.map((account) => {
        const busy = pendingUsername === account.username;
        return (
          <li key={account.username}>
            <button
              type="button"
              onClick={() => signInAs(account.username)}
              disabled={isPending}
              aria-label={`Sign in as ${account.assignment} (${account.username})`}
              title={account.assignment}
              className={cn(
                "group flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                "disabled:cursor-not-allowed",
                busy
                  ? "border-accent bg-accent-soft"
                  : "border-transparent bg-surface hover:border-line-strong hover:bg-hover disabled:opacity-50",
              )}
            >
              <span className="w-5 shrink-0 text-micro tabular-nums text-fg-subtle">
                {account.code}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-table font-medium text-fg">
                  {account.assignment}
                </span>
                <span className="block truncate font-mono text-micro text-fg-subtle">
                  {account.username}
                </span>
              </span>
              <LogIn
                className={cn(
                  "size-3.5 shrink-0 transition-opacity",
                  busy
                    ? "text-accent opacity-100"
                    : "text-fg-subtle opacity-0 group-hover:opacity-100",
                )}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );

  const sectionsOf = (roster: DemoRosterOption) =>
    roster.sections.map((section) =>
      section.folded ? (
        fold(
          `section:${roster.name}/${section.name}`,
          section.name,
          section.accounts.length === 1 ? "1 person" : `${section.accounts.length} people`,
          accountList(section.accounts),
        )
      ) : (
        <section key={section.name} aria-label={section.name}>
          <h3 className="mb-1.5 px-0.5 text-micro font-medium uppercase tracking-wide text-fg-subtle">{section.name}</h3>
          {accountList(section.accounts)}
        </section>
      ),
    );

  return (
    <div className="mt-8 rounded-lg border border-line bg-surface-muted">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-table font-medium text-fg">
            Demo accounts
            <span className="ml-2 text-micro font-normal text-fg-subtle">
              development only
            </span>
          </span>
          <span className="mt-0.5 block text-meta text-fg-muted">
            One click signs you in as that person.
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-fg-subtle transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="border-t border-line p-3">
          {error ? (
            <div
              role="alert"
              className="mb-3 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-meta text-danger-strong"
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="space-y-3">
            {rosters.map((roster) =>
              roster.folded ? (
                fold(`roster:${roster.name}`, roster.name, roster.summary, sectionsOf(roster))
              ) : (
                <div key={roster.name} className="space-y-3">
                  {sectionsOf(roster)}
                </div>
              ),
            )}
          </div>

          <p className="mt-3 px-0.5 text-meta text-fg-muted">
            To test the form itself, every account uses the password{" "}
            <code className="rounded bg-hover px-1.5 py-0.5 font-mono text-micro text-fg">
              {password}
            </code>{" "}
            — unless its demo tenant was seeded with one of its own.
          </p>
        </div>
      ) : null}
    </div>
  );
}
