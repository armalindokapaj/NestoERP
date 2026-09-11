"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { acceptInviteAsCurrentUserAction } from "@/lib/actions/team";

/**
 * Acceptance for somebody who already has a NESTO account and is signed in
 * (PRD #14 §75).
 *
 * No password is asked for: the account is already proven by the session, and
 * the server checks it matches the invited address.
 */
export function JoinButton({ token, companyName }: { token: string; companyName: string }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function join() {
    setError(null);
    startTransition(async () => {
      const result = await acceptInviteAsCurrentUserAction(token);
      if (result.ok) router.push("/dashboard");
      else setError(result.error);
    });
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-table text-danger-strong"
        >
          {error}
        </p>
      ) : null}

      <Button className="w-full" onClick={join} disabled={pending}>
        {pending ? "Joining…" : `Join ${companyName}`}
      </Button>
    </div>
  );
}
