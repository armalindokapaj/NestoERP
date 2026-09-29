import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/marketing/site-url";

/**
 * The public sitemap.
 *
 * Only the marketing pages and sign-in are listed: every other route requires a
 * session, and advertising them to a crawler would be an invitation rather than
 * an index.
 */
const routes = [
  { path: "/", priority: 1 },
  { path: "/full-view", priority: 0.9 },
  { path: "/platform", priority: 0.9 },
  { path: "/pricing", priority: 0.9 },
  { path: "/security", priority: 0.8 },
  { path: "/about", priority: 0.7 },
  { path: "/faq", priority: 0.7 },
  { path: "/contact", priority: 0.8 },
  { path: "/privacy", priority: 0.3 },
  { path: "/terms", priority: 0.3 },
  { path: "/login", priority: 0.4 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return routes.map((route) => ({
    url: `${siteUrl}${route.path}`,
    lastModified,
    changeFrequency: "monthly",
    priority: route.priority,
  }));
}
