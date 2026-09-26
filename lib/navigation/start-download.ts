import { unsaved } from "@/lib/unsaved/coordinator";

/**
 * Starts a download grant's forced-attachment file (AUD-03 §8).
 *
 * `location.href = url` is a navigation, and the browser asks `beforeunload`
 * before it knows the answer is an attachment: a person with unsaved work
 * elsewhere on the page would be warned about leaving it, though the page
 * stays. The unload guard stands aside for this one request. Grants are
 * always attachments (PRD #29 §43), so the page is never replaced.
 */
export function startDownload(url: string): void {
  unsaved.expectDownload();
  window.location.href = url;
}
