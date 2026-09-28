"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { logout } from "@/lib/auth/client-lifecycle";
import { unsaved } from "@/lib/unsaved/coordinator";

/** Sign out from a page that has no application shell around it. */
export function SignOutButton({ className }: { className?: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      className={className}
      disabled={isPending}
      onClick={() =>
        // Unsaved work first, before the session ends (AUD-03 §7).
        void unsaved.requestDeparture({ kind: "identity", action: "sign-out" }).then((approval) => {
          if (!approval || !approval.run(() => undefined)) return;
          startTransition(async () => { await logout(); });
        })
      }
    >
      <LogOut aria-hidden="true" />
      {isPending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
