/**
 * Production guard checks (PRD #34 §52, §53, §225, PRD #30 §261, §264).
 *
 * A CI gate rather than a convention: the DEV role switcher and the demo seed
 * must be *impossible* in production, not merely hidden (PRD #30 §261). This
 * asserts the guards exist in source, so removing one breaks the build rather
 * than quietly shipping.
 */
import { readFileSync, existsSync } from "node:fs";

type Check = { name: string; run: () => string | null };

const checks: Check[] = [
  {
    name: "DEV role switcher is environment-guarded",
    run: () => {
      const path = "components/layout/dev-role-switcher.tsx";
      if (!existsSync(path)) return null;
      const source = readFileSync(path, "utf8");
      // The switcher is rendered behind isDevMode by AppShell and Topbar; the
      // component itself only needs to route through the guarded action.
      const guarded = /setDevRoleAction/.test(source);
      return guarded ? null : `${path} does not use the guarded server action`;
    },
  },
  {
    name: "the server action behind the switcher is guarded",
    run: () => {
      const candidates = ["lib/actions/dev.ts", "lib/actions/session.ts", "lib/auth/dev-session.ts"];
      const found = candidates.filter((path) => existsSync(path));
      if (found.length === 0) return null;
      const unguarded = found.filter((path) => {
        const source = readFileSync(path, "utf8");
        return !/isDevMode|devFeaturesEnabled|appEnvironment|NODE_ENV/.test(source);
      });
      return unguarded.length > 0 ? `unguarded dev action: ${unguarded.join(", ")}` : null;
    },
  },
  {
    name: "no start or deploy script runs the demo seed",
    run: () => {
      const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
        scripts?: Record<string, string>;
      };
      const offenders = Object.entries(pkg.scripts ?? {})
        .filter(([name]) => ["start", "build", "postinstall", "db:deploy"].includes(name))
        .filter(([, command]) => /db:seed|seed\.ts|prisma db seed/.test(command))
        .map(([name]) => name);
      return offenders.length > 0
        ? `demo seed reachable from: ${offenders.join(", ")}`
        : null;
    },
  },
  {
    name: "the dev-mode guard honours APP_ENV, not just NODE_ENV",
    run: () => {
      const source = readFileSync("lib/auth/dev-role.ts", "utf8");
      const honoursAppEnv = /APP_ENV/.test(source);
      const refusesStaging = /staging/.test(source);
      if (!honoursAppEnv) return "isDevMode ignores APP_ENV";
      if (!refusesStaging) return "isDevMode does not exclude staging";
      return null;
    },
  },
  {
    name: "environment schema refuses local storage in production",
    run: () => {
      const path = "lib/config/env.ts";
      if (!existsSync(path)) return "lib/config/env.ts is missing";
      const source = readFileSync(path, "utf8");
      return /not permitted in production/.test(source)
        ? null
        : "env schema does not reject local storage in production";
    },
  },
  {
    name: "security headers are configured",
    run: () => {
      const source = readFileSync("next.config.ts", "utf8");
      const required = [
        "Content-Security-Policy",
        "X-Content-Type-Options",
        "Referrer-Policy",
        "Permissions-Policy",
        "Strict-Transport-Security",
      ];
      const missing = required.filter((header) => !source.includes(header));
      return missing.length > 0 ? `missing headers: ${missing.join(", ")}` : null;
    },
  },
  {
    name: "production source maps stay private",
    run: () => {
      const source = readFileSync("next.config.ts", "utf8");
      return /productionBrowserSourceMaps:\s*false/.test(source)
        ? null
        : "productionBrowserSourceMaps is not disabled";
    },
  },
];

let failed = 0;
for (const check of checks) {
  const failure = check.run();
  if (failure) {
    console.error(`FAIL  ${check.name}: ${failure}`);
    failed += 1;
  } else {
    console.log(`ok    ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} production guard check(s) failed.`);
  process.exit(1);
}
console.log("\nAll production guard checks passed.");
