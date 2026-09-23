/**
 * Marks the build as App-Router-only for Vercel's Next.js builder.
 *
 * Next 15 does not write `appType` into `routes-manifest.json`, and the builder
 * reads its absence as "has a Pages Router". With middleware present it then
 * emits a `/_next/data/<build>/…json` rewrite for every dynamic route — ~790
 * routes nobody requests, which pushes the deployment past Vercel's 2048-route
 * limit. This app has no `pages/` directory, so the manifest is told so.
 *
 * Only Next's built-in pages (_app, _document, _error) may be present; any real
 * page leaves the manifest untouched.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const distDir = process.env.NEXT_DIST_DIR ?? ".next";
const builtIns = new Set(["/_app", "/_document", "/_error", "/404", "/500"]);

const pages = JSON.parse(readFileSync(join(distDir, "server", "pages-manifest.json"), "utf8"));
const realPages = Object.keys(pages).filter((page) => !builtIns.has(page));
if (realPages.length > 0) {
  console.log(`vercel-app-type: Pages Router in use (${realPages.join(", ")}); manifest left as is`);
  process.exit(0);
}

const manifestPath = join(distDir, "routes-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.appType) process.exit(0);
manifest.appType = "app";
writeFileSync(manifestPath, JSON.stringify(manifest));
console.log("vercel-app-type: routes-manifest marked appType=app");
