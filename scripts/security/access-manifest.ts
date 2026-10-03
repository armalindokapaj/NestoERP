/**
 * The expected-access manifest (AUD-06 §2 first deliverable, §5, RP-01, RP-24).
 *
 * Writes docs/security/access-manifest.json: every role × position × module
 * cell of the matrix, and every seeded persona — the curated sign-in roster,
 * the demo's other logins and the test fixtures — with each
 * membership's role, position, department, projects, grants and the module
 * access the product's resolver computes for it. Derived, never maintained:
 * see access-manifest.derive.ts for where each fact comes from.
 *
 *   pnpm security:access-manifest          regenerate the document
 *   pnpm security:access-manifest:check    fail if the committed document is stale
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { ACCESS_MANIFEST_PATH, deriveAccessManifest, renderAccessManifest } from "./access-manifest.derive";

const manifest = deriveAccessManifest();
const document = renderAccessManifest(manifest);
const summary = `${manifest.personas.length} personas, ${manifest.personas.reduce((sum, persona) => sum + persona.memberships.length, 0)} memberships, ${Object.keys(manifest.profiles).length} access profiles`;

if (process.argv.includes("--check")) {
  if (!existsSync(ACCESS_MANIFEST_PATH) || readFileSync(ACCESS_MANIFEST_PATH, "utf8") !== document) {
    console.error(`✗ ${ACCESS_MANIFEST_PATH} is stale — run pnpm security:access-manifest and commit the result`);
    process.exitCode = 1;
  } else {
    console.log(`✓ access manifest is current: ${summary}`);
  }
} else {
  writeFileSync(ACCESS_MANIFEST_PATH, document);
  console.log(`wrote ${ACCESS_MANIFEST_PATH}: ${summary}`);
}
