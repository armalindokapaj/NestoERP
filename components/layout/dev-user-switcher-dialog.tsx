"use client";

import { clearActivityCache } from "@/lib/activity/client";
import { clearSearchHomeCache } from "@/lib/productivity/client";
import { useMemo, useState, useTransition } from "react";
import { Check, FlaskConical, Loader2, TriangleAlert } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SearchField } from "@/components/ui/search-field";
import { switchDemoUserAction, type DemoUserSwitchResult } from "@/lib/actions/demo";
import type { DemoAccountOption, DemoRosterOption } from "@/lib/auth/demo-tenants";
import { cn } from "@/lib/utils/cn";

/** Case and accents folded, so "cela" finds Çela. */
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * The rosters as the dialog lists them: a demo tenant's own heads under
 * "Group", then each company; every word of the search in the person's name,
 * username, title, role or company (C-01 §43, §44).
 */
function visibleRosters(rosters: DemoRosterOption[], query: string): DemoRosterOption[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const matches = (account: DemoAccountOption, section: string, roster: string) => {
    const text = fold([account.name, account.username, account.assignment, account.label, section, roster].join(" "));
    return words.every((word) => text.includes(word));
  };
  return rosters
    .map((roster) => ({
      ...roster,
      sections: roster.sections
        .map((section) => ({
          name: section.name === roster.name ? "Group" : section.name,
          accounts: section.accounts.filter((account) => matches(account, section.name, roster.name)),
        }))
        .filter((section) => section.accounts.length > 0),
    }))
    .filter((roster) => roster.sections.length > 0);
}

/**
 * The development demo user switcher (C-01 §14-§16, §42-§46).
 *
 * People, not roles: choosing one signs out of this account and in as theirs,
 * through switchDemoUserAction, and the browser then loads their landing page
 * from scratch — their dashboard, navigation, company and data, as if they had
 * signed in on the form. The name and role in the user menu beside it are
 * always the signed-in account's own.
 *
 * Rendered only in development (see DevUserSwitcher), and the action behind it
 * is independently gated, so it cannot reach production.
 */
export function DevUserSwitcherDialog({ rosters, currentUsername }: { rosters: DemoRosterOption[]; currentUsername: string | null }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const shown = useMemo(() => visibleRosters(rosters, query), [rosters, query]);

  const choose = (account: DemoAccountOption) => {
    if (pending) return;
    // Already this person: nothing to replace (§42).
    if (account.username === currentUsername) {
      setOpen(false);
      return;
    }
    setError(null);
    setPending(account.username);
    startTransition(async () => {
      const result: DemoUserSwitchResult = await switchDemoUserAction(account.username).catch(() => ({ ok: false, error: "Could not switch demo user." }));
      if (result.ok && result.landing === null) {
        setPending(null);
        setOpen(false);
        return;
      }
      if (result.landing) {
        // A full load, not a client navigation: nothing of the previous user's
        // pages, cache or state comes along (§47-§49). The row stays busy until
        // it lands. A switch that failed after signing out lands on sign-in (§46).
        clearSearchHomeCache();
        clearActivityCache();
        window.location.assign(result.landing);
        return;
      }
      if (!result.ok) setError(result.error);
      setPending(null);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
      <DialogTrigger
        className="flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2 text-micro font-medium text-fg-muted transition-colors hover:bg-hover"
        title="Development only: sign in as another demo user"
        aria-label="Switch demo user"
        data-testid="dev-user-switcher"
      >
        <FlaskConical aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="hidden truncate lg:inline">Switch user</span>
        <span className="lg:hidden">DEV</span>
      </DialogTrigger>

      <DialogContent className="max-w-xl">
        <DialogTitle>Switch demo user</DialogTitle>
        <DialogDescription>
          Development only. Signs you out and in as the person you choose, with their own dashboard, access and company.
        </DialogDescription>

        <SearchField
          className="mt-4"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, username, role or company"
          aria-label="Search demo users"
          disabled={pending !== null}
          autoFocus
        />

        {error ? (
          <div
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-meta text-danger-strong"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="-mx-2 mt-3 max-h-[55vh] space-y-4 overflow-y-auto px-2 pb-1">
          {shown.length === 0 ? (
            <p className="py-6 text-center text-table text-fg-muted">No demo user matches “{query.trim()}”.</p>
          ) : null}
          {shown.map((roster) => (
            <section key={roster.name} aria-label={roster.name}>
              <h3 className="text-micro font-semibold uppercase tracking-wide text-fg">{roster.name}</h3>
              {roster.sections.map((section) => (
                <div key={section.name} className="mt-2">
                  <h4 className="mb-1 px-0.5 text-micro font-medium uppercase tracking-wide text-fg-subtle">{section.name}</h4>
                  <ul className="space-y-0.5">
                    {section.accounts.map((account) => {
                      const current = account.username === currentUsername;
                      const busy = pending === account.username;
                      const name = account.name || account.username;
                      return (
                        <li key={account.username}>
                          <button
                            type="button"
                            onClick={() => choose(account)}
                            disabled={pending !== null}
                            aria-current={current ? "true" : undefined}
                            aria-label={`${name} — ${account.assignment} (${account.username})${current ? ", signed in" : ""}`}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors disabled:cursor-not-allowed",
                              busy
                                ? "border-accent bg-accent-soft"
                                : current
                                  ? "border-line bg-surface-muted"
                                  : "border-transparent hover:border-line-strong hover:bg-hover disabled:opacity-50",
                            )}
                          >
                            <span className="w-5 shrink-0 text-micro tabular-nums text-fg-subtle">{account.code}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-table text-fg">
                                <span className="font-medium">{name}</span>
                                <span className="text-fg-muted"> — {account.assignment}</span>
                              </span>
                              <span className="block truncate font-mono text-micro text-fg-subtle">{account.username}</span>
                            </span>
                            {busy ? (
                              <span className="flex shrink-0 items-center gap-1 text-micro text-accent">
                                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                                Switching…
                              </span>
                            ) : current ? (
                              <span className="flex shrink-0 items-center gap-1 text-micro text-accent">
                                <Check aria-hidden="true" className="size-3.5" />
                                Signed in
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
