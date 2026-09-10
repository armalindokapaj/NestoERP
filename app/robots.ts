import type { MetadataRoute } from "next";

import { MODULE_KEYS, modules } from "@/config/modules";
import { siteUrl } from "@/lib/marketing/site-url";

/**
 * Crawlers are welcome on the public site and nowhere else.
 *
 * The disallow list is derived from the module registry rather than copied out
 * of it. A module added in a later version is behind a session the moment it
 * exists, but it would stay absent from a hand-kept list here until somebody
 * remembered — and a crawlable product route is not the kind of thing anyone
 * notices.
 */
export default function robots(): MetadataRoute.Robots {
  const moduleRoutes = MODULE_KEYS.map((key) => modules[key].href);

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...moduleRoutes, "/access-denied", "/api/"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
