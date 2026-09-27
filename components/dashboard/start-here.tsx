import { identityKeys } from "@/lib/context/identity-key";
import type { UserContext } from "@/lib/context/types";
import { START_HERE_VERSION } from "@/lib/modules/dashboard/dashboard.start-here";
import { loadStartHere } from "@/lib/modules/dashboard/dashboard.start-here.load";
import { StartHereCard } from "./start-here-card";

/**
 * The dashboard's "Start here" (AUD-05 §7, UX-15): streamed after the header,
 * so the dashboard never waits for it, and absent unless the reader's view is
 * genuinely empty. A read that fails leaves it out — guidance is never worth
 * an error on the dashboard.
 */
export async function StartHere({ context }: { context: UserContext }) {
  const guidance = await loadStartHere(context).catch(() => null);
  if (!guidance || guidance.kind === "none") return null;
  return (
    <StartHereCard
      guidance={guidance}
      dismissKey={`nesto.guidance.start-here:${identityKeys(context).user}:v${START_HERE_VERSION}`}
    />
  );
}
