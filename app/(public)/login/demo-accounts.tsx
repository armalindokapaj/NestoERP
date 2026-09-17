"use client";

import { useState, useTransition } from "react";
import { ChevronDown, LogIn, TriangleAlert } from "lucide-react";

import { signInAsDemoRoleAction } from "@/lib/actions/demo";
import { cn } from "@/lib/utils/cn";

export type DemoAccountOption = {
  role: string;
  code: string;
  label: string;
  username: string;
};

/**
 * Development-only account picker (spec §65, §66).
 *
 * One click signs in as that role — no typing — so all 18 role experiences can
 * be walked through quickly. The password lives on the server: the button sends
 * only a role key to signInAsDemoRoleAction.
 *
 * The login page renders this solely when the app is built in development.
 */
export function DemoAccounts({
  accounts,
  password,
}: {
  accounts: DemoAccountOption[];
  password: string;
}) {
  const [open, setOpen] = useState(true);
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const signInAs = (role: string) => {
    setError(null);
    setPendingRole(role);
    startTransition(async () => {
      // A successful sign-in redirects, so anything returned is a failure.
      const result = await signInAsDemoRoleAction(role);
      if (result?.error) {
        setError(result.error);
        setPendingRole(null);
      }
    });
  };

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
            One click signs you in as that role.
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

          <ul className="grid gap-1.5 sm:grid-cols-2">
            {accounts.map((account) => {
              const busy = pendingRole === account.role;
              return (
                <li key={account.role}>
                  <button
                    type="button"
                    onClick={() => signInAs(account.role)}
                    disabled={isPending}
                    aria-label={`Sign in as ${account.label}`}
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
                        {account.label}
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

          <p className="mt-3 px-0.5 text-meta text-fg-muted">
            To test the form itself, every account uses the password{" "}
            <code className="rounded bg-hover px-1.5 py-0.5 font-mono text-micro text-fg">
              {password}
            </code>
          </p>
        </div>
      ) : null}
    </div>
  );
}
