/**
 * The site's own origin.
 *
 * Needed by metadata, the sitemap and robots.txt, none of which can resolve a
 * relative URL. Set NEXT_PUBLIC_SITE_URL in production; the localhost fallback
 * keeps development and CI working without configuration.
 */
const configured = process.env.NEXT_PUBLIC_SITE_URL;

export const siteUrl =
  typeof configured === "string" && configured.length > 0
    ? configured.replace(/\/+$/, "")
    : "http://localhost:3000";
