"use client";

import { useRef, useState } from "react";

import { logout } from "@/lib/auth/client-lifecycle";
import { unsaved } from "@/lib/unsaved/coordinator";

/**
 * The one sign-out (Profile Menu PRD; MOB-02 §39, §40). The account menu and
 * the phone's More sheet both call this, so unsaved work is asked about before
 * the session ends and the session, client state and history are cleared the
 * same way. `onStay` runs when the person chooses to stay on the page.
 */
export function useSignOut(onStay?: () => void) {
  const [signingOut, setSigningOut] = useState(false);
  const leaving = useRef(false);

  async function signOut() {
    if (leaving.current) return;
    // A save offered here runs as this person, before anything changes (AUD-03 §7).
    const approval = await unsaved.requestDeparture({ kind: "identity", action: "sign-out" });
    if (!approval || !approval.run(() => undefined)) {
      onStay?.();
      return;
    }
    leaving.current = true;
    setSigningOut(true);
    await logout();
  }

  return { signOut, signingOut };
}
