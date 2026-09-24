/**
 * Production guard checks (PRD #34 §52, §53, §225, PRD #30 §261, §264).
 *
 * A CI gate rather than a convention: the demo user switcher, the demo sign-in
 * and the demo seed must be *impossible* in production, not merely hidden
 * (PRD #30 §261, C-01 §12, §59). This asserts the guards exist in source, so
 * removing one breaks the build rather than quietly shipping.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

import ts from "typescript";

type Check = { name: string; run: () => string | null };

const checks: Check[] = [
  {
    // C-01 §12, §73: only ever rendered behind isDevMode.
    name: "the demo user switcher is rendered in development only",
    run: () => {
      if (!/switchDemoUserAction/.test(readFileSync("components/layout/dev-user-switcher-dialog.tsx", "utf8"))) {
        return "components/layout/dev-user-switcher-dialog.tsx does not go through the guarded server action";
      }
      const renderers: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const path = `${dir}/${name}`;
          if (statSync(path).isDirectory()) walk(path);
          else if (/\.tsx?$/.test(path) && /<DevUserSwitcher\s*\/>/.test(readFileSync(path, "utf8"))) renderers.push(path);
        }
      };
      ["app", "components"].forEach(walk);
      // Each rendering sits in the branch of an isDevMode test, a Suspense
      // boundary at most between them. The branch is parenthesised or not, as
      // the formatter left it.
      const unguarded = renderers.filter((path) => {
        const source = readFileSync(path, "utf8");
        const renderings = source.match(/<DevUserSwitcher\s*\/>/g)?.length ?? 0;
        const guarded = source.match(/isDevMode \? \(?\s*(?:<Suspense[^>]*>\s*)?<DevUserSwitcher\s*\/>/g)?.length ?? 0;
        return guarded < renderings;
      });
      if (renderers.length === 0) return "nothing renders the demo user switcher";
      return unguarded.length > 0 ? `rendered without isDevMode: ${unguarded.join(", ")}` : null;
    },
  },
  {
    // C-01 §59: every demo action refuses before it does anything, outside development.
    name: "the demo sign-in and user switch actions are guarded",
    run: () => {
      const path = "lib/actions/demo.ts";
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      const actions = source.statements.filter(
        (statement): statement is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(statement) && Boolean(statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)),
      );
      if (actions.length === 0) return `${path} exports no action`;
      const unguarded = actions.filter((action) => !/^if \(!isDevMode\)/.test(action.body?.statements[0]?.getText(source) ?? ""));
      return unguarded.length > 0 ? `does not begin with an isDevMode refusal: ${unguarded.map((action) => action.name?.text).join(", ")}` : null;
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
      const source = readFileSync("lib/auth/dev-mode.ts", "utf8");
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
    // PRD #38 §10, §12: a production deployment on a mail sink would silently
    // swallow every invitation and reset link.
    name: "production refuses a mail sink",
    run: () => {
      const service = readFileSync("lib/mail/mail.service.ts", "utf8");
      const env = readFileSync("lib/config/env.ts", "utf8");
      if (!/environment === "production"[\s\S]{0,200}UnconfiguredMailProvider/.test(service)) {
        return "lib/mail/mail.service.ts no longer refuses memory/console in production";
      }
      if (!/MAIL_PROVIDER must be a real transactional provider in production/.test(env)) {
        return "lib/config/env.ts no longer requires a real mail provider in production";
      }
      return null;
    },
  },
  {
    // PRD #38 §17: every account flow is throttled through the shared store.
    name: "account flows are throttled",
    run: () => {
      const expectations: Array<[string, RegExp]> = [
        ["lib/auth/credentials.ts", /peekThrottle\("AUTH_LOGIN"/],
        // The reset-request and reset-submit flows are gone: V0.1 has no
        // self-service password reset, so there is nothing there to throttle
        // (PRD #50 §3, §268). Recovery is an administrator action, which is
        // held by `team.member.password.reset` instead of by a rate limit.
        ["lib/modules/account/account.service.ts", /peekThrottle\("PASSWORD_CHANGE"/],
        ["lib/modules/team/invitations/invite.service.ts", /hitThrottle\("INVITE_RESEND"/],
        ["lib/actions/team.ts", /hitThrottle\("INVITE_ACCEPT"/],
      ];
      const missing = expectations
        .filter(([path, pattern]) => !pattern.test(readFileSync(path, "utf8")))
        .map(([path, pattern]) => `${path} ${pattern.source}`);
      return missing.length > 0 ? `unthrottled: ${missing.join("; ")}` : null;
    },
  },
  {
    // PRD #38 §99, §100: a named scanner must be a real one, and it must fail closed.
    name: "the malware scanner is real and fails closed",
    run: () => {
      const env = readFileSync("lib/config/env.ts", "utf8");
      const scanner = readFileSync("lib/core/storage/scanner.ts", "utf8");
      const clamav = readFileSync("lib/core/storage/clamav-scanner.ts", "utf8");
      if (!/STORAGE_SCANNER=eicar is a test scanner and cannot run in production/.test(env)) {
        return "lib/config/env.ts no longer refuses the EICAR test scanner in production";
      }
      if (!/registerFileScanner\("clamav"/.test(clamav) || !/new UnavailableFileScanner\(configured\)/.test(scanner)) {
        return "STORAGE_SCANNER=clamav no longer selects the ClamAV scanner, or an unloaded engine no longer fails closed";
      }
      if (!/import "@\/lib\/core\/storage\/clamav-scanner"/.test(readFileSync("lib/modules/documents/storage/scan.service.ts", "utf8"))) {
        return "the scan service no longer loads the ClamAV engine";
      }
      if (!/verdict: "ERROR", detail: "CLAMAV_HOST is not configured"/.test(clamav)) {
        return "an unconfigured ClamAV scanner no longer fails closed";
      }
      return null;
    },
  },
  {
    // PRD #38 §94, §95: scheduled work belongs to the worker, never to web instances.
    name: "background jobs run only in the worker",
    run: () => {
      const offenders = ["instrumentation.ts", "middleware.ts", "app/layout.tsx"]
        .filter((path) => existsSync(path))
        .filter((path) => /setInterval|runDueJobs|dispatchNotifications|reconcileAttention/.test(readFileSync(path, "utf8")));
      return offenders.length > 0 ? `scheduled work started from ${offenders.join(", ")}` : null;
    },
  },
  {
    // PRD #38 §102: the build must not need the internet to fetch typefaces.
    name: "fonts are self-hosted",
    run: () => {
      const roots = ["app", "components", "lib"];
      const offenders: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const path = `${dir}/${name}`;
          if (statSync(path).isDirectory()) walk(path);
          else if (/\.(ts|tsx)$/.test(path) && readFileSync(path, "utf8").includes("next/font/google")) offenders.push(path);
        }
      };
      roots.forEach(walk);
      return offenders.length > 0 ? `next/font/google still imported by ${offenders.join(", ")}` : null;
    },
  },
  {
    // NAV-02 §16: the shell-slot delay hook exists for the browser tests only.
    name: "the shell-slot test hook answers only to its own variable, which no deployment sets",
    run: () => {
      const source = readFileSync("lib/workspace/shell-slots.ts", "utf8");
      const hook = source.slice(source.indexOf("async function testDelay"));
      if (!/^\s*if \(process\.env\.NESTO_TEST_SHELL_DELAYS !== "1"\) return;/m.test(hook.split("\n").slice(1, 3).join("\n"))) {
        return "testDelay in lib/workspace/shell-slots.ts no longer returns first unless NESTO_TEST_SHELL_DELAYS is 1";
      }
      const configured = ["vercel.json", ".env.example", ".env.production"].filter((path) => existsSync(path) && readFileSync(path, "utf8").includes("NESTO_TEST_SHELL_DELAYS"));
      return configured.length > 0 ? `NESTO_TEST_SHELL_DELAYS appears in ${configured.join(", ")}` : null;
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
