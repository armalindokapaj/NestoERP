import { AccessError } from "@/lib/access/guards";
import { parseAppUserAgent } from "./app-version";
import { effectivePolicyForUser } from "./mobile-policy.service";

/**
 * Enforcing the export policy where the file leaves the server (MOB-11 §93-§97).
 *
 * "View in NESTO" and "Make Available Offline" are not exports; a download is.
 * Record authorization and document permission have already run — this adds the
 * organization's rule, for requests from the installed app only (the browser has
 * its own controls, and this is the *mobile* policy). The app identifies itself in
 * its user agent; a modified app could omit that, so the limit is stated honestly
 * in `docs/security/secure-files.md` rather than called a guarantee.
 */
export async function assertMobileExportAllowed(userId: string, headers: Pick<Headers, "get">): Promise<void> {
  if (!parseAppUserAgent(headers.get("user-agent"))) return;
  const policy = await effectivePolicyForUser(userId);
  if (!policy.documentExportAllowed) throw new AccessError("FORBIDDEN", "Downloading files from the NESTO app is turned off by your organization's security policy. You can still view them in NESTO.");
}
