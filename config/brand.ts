/**
 * Brand voice (design spec §4, §7).
 *
 * NESTO sets a handful of small capitalised lines around the interface: under
 * the wordmark, at the foot of the navigation, beside the dashboard date. They
 * live here rather than inside components so the wording stays consistent and
 * one edit moves every instance.
 */
export const brand = {
  name: "NESTO",
  /** Under the wordmark wherever the lockup has room to breathe. */
  tagline: "People · Projects · Progress",
  /** One-line descriptor for the desktop sidebar header. */
  descriptor: "ERP for a brighter tomorrow",
  /** Foot of the navigation, stacked one word per line. */
  signoff: ["Build", "Manage", "Grow together"],
  version: "v0.1.0",
  /** Beside the dashboard date, stacked. */
  motto: ["Discipline builds", "extraordinary companies"],
  /** The dark card that closes an executive dashboard. */
  feature: {
    eyebrow: "A stronger tomorrow",
    headline: ["People.", "Projects.", "Lasting impact."],
    aside: ["Better operations", "brighter possibilities"],
  },
} as const;
