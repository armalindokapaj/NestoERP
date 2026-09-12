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
    /*
     * PRD #30 §108: the CSP carries a per-request nonce, which means it has to
     * come from middleware. A static `script-src 'self'` blocks Next's own
     * bootstrap scripts and the application never hydrates — a failure that
     * only appears in a production build, which is exactly why it is a guard.
     */
    name: "the CSP is set by middleware with a per-request nonce",
    run: () => {
      const middleware = readFileSync("middleware.ts", "utf8");
      if (!/Content-Security-Policy/.test(middleware)) {
        return "middleware does not set a Content-Security-Policy";
      }
      if (!/newCspNonce/.test(middleware)) return "middleware does not mint a nonce";

      const policy = readFileSync("lib/core/security/csp.ts", "utf8");
      if (!/nonce-\$\{options\.nonce\}/.test(policy)) {
        return "the production policy carries no nonce";
      }
      /*
       * `unsafe-inline` on the production script-src would hand back the whole
       * protection, so the line that carries the nonce must not also carry it.
       * Checked line by line rather than across the ternary, because the
       * development branch legitimately allows it for fast refresh.
       */
      const nonceLine = policy
        .split("\n")
        .find((line) => line.includes("nonce-${options.nonce}"));
      if (nonceLine === undefined) return "the production policy carries no nonce";
      if (nonceLine.includes("unsafe-inline") || nonceLine.includes("unsafe-eval")) {
        return "the production script-src allows unsafe inline script";
      }
      return null;
    },
  },
  {
    /*
     * PRD #29 §186: a signed URL must never be issued over plain HTTP in
     * production. The factory refuses to build an S3 provider against an
     * `http://` endpoint, and this asserts the refusal is still there.
     */
    name: "object storage requires HTTPS in production",
    run: () => {
      const path = "lib/core/storage/storage-provider.factory.ts";
      if (!existsSync(path)) return "the storage provider factory is missing";
      const source = readFileSync(path, "utf8");
      return /reached over HTTPS in production/.test(source)
        ? null
        : "the storage factory does not require HTTPS in production";
    },
  },
  {
    /*
     * PRD #29 §113: storage credentials come from the environment. A company
     * setting holding an access key would put a bucket credential behind an
     * ordinary admin permission.
     */
    name: "storage credentials are not company settings",
    run: () => {
      const source = readFileSync("prisma/schema.prisma", "utf8");
      const settingsModel = source.slice(
        source.indexOf("model CompanySettings {"),
        source.indexOf("model CompanySettings {") + 4000,
      );
      const offenders = ["accessKey", "secretKey", "storageEndpoint", "bucketName"].filter(
        (field) => settingsModel.includes(field),
      );
      return offenders.length > 0
        ? `CompanySettings holds storage credentials: ${offenders.join(", ")}`
        : null;
    },
  },
  {
    /*
     * PRD #29 §8, §110: the object endpoint authorises on the signature alone,
     * which is only safe because that signature binds the key, the method and
     * the expiry. If the verification ever went missing the route would serve
     * any object to anyone.
     */
    name: "the storage object route verifies its signature",
    run: () => {
      const path = "app/api/storage/objects/[...key]/route.ts";
      if (!existsSync(path)) return null;
      const source = readFileSync(path, "utf8");
      if (!/verifyClaims/.test(source)) return `${path} does not verify signed claims`;
      if (!/isWellFormedKey/.test(source)) return `${path} does not validate the key`;
      return null;
    },
  },
  {
    /*
     * PRD #29 §36, §33, §34: the allowlist is the upload boundary. A format
     * silently reappearing in it is the kind of change that should break a
     * build rather than a customer.
     */
    name: "dangerous file types stay off the allowlist",
    run: () => {
      const source = readFileSync("lib/core/storage/file-type.registry.ts", "utf8");
      const extensions = [...source.matchAll(/extensions:\s*\[([^\]]*)\]/g)]
        .flatMap((match) => match[1].split(","))
        .map((value) => value.trim().replace(/['"]/g, ""))
        .filter(Boolean);

      const forbidden = ["exe", "dll", "bat", "sh", "ps1", "js", "html", "svg", "zip", "rar", "docm", "xlsm"];
      const present = forbidden.filter((extension) => extensions.includes(extension));
      return present.length > 0
        ? `the allowlist accepts: ${present.join(", ")}`
        : null;
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
