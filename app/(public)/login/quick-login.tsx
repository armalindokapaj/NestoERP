"use client";

import { useState, useTransition } from "react";
import { LogIn, TriangleAlert } from "@/components/icons";

import { quickLoginAction } from "@/lib/actions/quick-login";
import type { QuickLoginSection } from "@/lib/auth/quick-login";
import { cn } from "@/lib/utils/cn";

/** UI/UX test branch only: one click signs in as that person; sign out returns here for the next one. */
export function QuickLogin({ sections }: { sections: QuickLoginSection[] }) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const signInAs = (username: string) => {
    setError(null);
    setPending(username);
    startTransition(async () => {
      // A successful sign-in redirects, so anything returned is a failure.
      const result = await quickLoginAction(username);
      if (result?.error) {
        setError(result.error);
        setPending(null);
      }
    });
  };

  // No seeded demo people in this database: nothing to offer.
  if (sections.length === 0) return null;

  return (
    <div className="mt-8 rounded-lg border border-line bg-surface-muted p-3">
      <p className="mb-3 px-0.5 text-table font-medium text-fg">
        Quick login <span className="ml-2 text-micro font-normal text-fg-subtle">UI/UX test · development only</span>
      </p>
      {error ? (
        <div role="alert" className="mb-3 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-meta text-danger-strong">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      <div className="space-y-3">
        {sections.map((section) => (
          <section key={section.name} aria-label={section.name}>
            <h3 className="mb-1.5 px-0.5 text-micro font-medium uppercase tracking-wide text-fg-subtle">{section.name}</h3>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {section.people.map((person) => (
                <li key={person.username}>
                  <button
                    type="button"
                    onClick={() => signInAs(person.username)}
                    disabled={isPending}
                    title={`${person.title} · ${person.role}`}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed",
                      pending === person.username ? "border-accent bg-accent-soft" : "border-transparent bg-surface hover:border-line-strong hover:bg-hover disabled:opacity-50",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-table font-medium text-fg">{person.name}</span>
                      <span className="block truncate text-micro text-fg-subtle">
                        {person.title} · <span className="font-mono">{person.username}</span>
                      </span>
                    </span>
                    <LogIn className="size-3.5 shrink-0 text-fg-subtle" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
