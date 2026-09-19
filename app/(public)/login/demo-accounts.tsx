"use client";

import { useState, useTransition } from "react";
import { ChevronDown, LogIn, TriangleAlert } from "lucide-react";

import { signInAsDemoAccountAction } from "@/lib/actions/demo";
import { cn } from "@/lib/utils/cn";

export type DemoAccountOption = {
  code: string;
  label: string;
  assignment: string;
  username: string;
  /** The level the persona works at: Platform, Group, a company (E-06 §59). */
  section: string;
};

/** One demo tenant's personas: ARMAAR's shown, the five-company demo's folded under its name. */
export type DemoRosterOption = {
  name: string;
  /** What is inside while it is folded. */
  summary: string;
  accounts: DemoAccountOption[];
  folded?: boolean;
};

type Section = { name: string; accounts: DemoAccountOption[] };

// In the order the roster lists them: platform, group, the first company, the others.
function bySection(accounts: DemoAccountOption[]): Section[] {
  return accounts.reduce<Section[]>((groups, account) => {
    const current = groups.find((group) => group.name === account.section);
    if (current) current.accounts.push(account);
    else groups.push({ name: account.section, accounts: [account] });
    return groups;
  }, []);
}

/**
 * Development-only account picker (spec §65, §66).
 *
 * One click signs in as that persona — no typing — so the curated demo
 * personas (E-06 §48) can be walked through quickly: ARMAAR's first (D-01 §87),
 * the five-company demo's folded below. The password lives on the server: the
 * button sends only a username to signInAsDemoAccountAction, which accepts
 * nothing outside the curated lists.
 *
 * The login page renders this solely when the app is built in development.
 */
export function DemoAccounts({
  rosters,
  password,
  armaarHasOwnPassword,
}: {
  rosters: DemoRosterOption[];
  password: string;
  /** ARMAAR_DEMO_PASSWORD is set: ARMAAR's accounts do not use `password`, and theirs is not shown. */
  armaarHasOwnPassword: boolean;
}) {
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

  const renderSection = (group: Section) => (
    <section key={group.name} aria-label={group.name}>
      <h3 className="mb-1.5 px-0.5 text-micro font-medium uppercase tracking-wide text-fg-subtle">{group.name}</h3>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {group.accounts.map((account) => {
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
    </section>
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
                <section key={roster.name} aria-label={roster.name} className="rounded-md border border-line bg-surface-muted">
                  <button
                    type="button"
                    onClick={() =>
                      setUnfolded((names) =>
                        names.includes(roster.name) ? names.filter((name) => name !== roster.name) : [...names, roster.name],
                      )
                    }
                    aria-expanded={unfolded.includes(roster.name)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block text-table font-medium text-fg">{roster.name}</span>
                      <span className="block truncate text-meta text-fg-muted">{roster.summary}</span>
                    </span>
                    <ChevronDown
                      className={cn(
                        "size-4 shrink-0 text-fg-subtle transition-transform",
                        unfolded.includes(roster.name) && "rotate-180",
                      )}
                    />
                  </button>
                  {unfolded.includes(roster.name) ? (
                    <div className="space-y-3 border-t border-line p-2.5">{bySection(roster.accounts).map(renderSection)}</div>
                  ) : null}
                </section>
              ) : (
                <div key={roster.name} className="space-y-3">
                  {bySection(roster.accounts).map(renderSection)}
                </div>
              ),
            )}
          </div>

          <p className="mt-3 px-0.5 text-meta text-fg-muted">
            {armaarHasOwnPassword ? (
              <>
                To test the form itself, ARMAAR&apos;s accounts use the password set in{" "}
                <code className="rounded bg-hover px-1.5 py-0.5 font-mono text-micro text-fg">ARMAAR_DEMO_PASSWORD</code>
                ; the five-company demo&apos;s use{" "}
              </>
            ) : (
              <>To test the form itself, every account uses the password </>
            )}
            <code className="rounded bg-hover px-1.5 py-0.5 font-mono text-micro text-fg">
              {password}
            </code>
          </p>
        </div>
      ) : null}
    </div>
  );
}
