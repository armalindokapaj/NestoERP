/**
 * Whether development conveniences exist in this process (C-01 §12, §38): the
 * demo account picker on the sign-in page, the demo user switcher in the top
 * bar, and the access debugger.
 *
 * Off anywhere that is not a developer's machine. APP_ENV is the authority
 * where it is set, so a staging deployment built with NODE_ENV=development
 * still refuses them — security behaviour is never inferred from a value that
 * happens to be lying around (PRD #34 §11, PRD #30 §261, §349).
 *
 * The rule, fail-closed (AUD-06 §4):
 * - APP_ENV production or staging: off, whatever else is set;
 * - APP_ENV development, test or demo: on (demo is a hosted demo deployment);
 * - any other APP_ENV value — a typo, "preview": off;
 * - APP_ENV unset: on for a development or test Node build; a production Node
 *   build only with the explicit NESTO_DEMO_MODE=true opt-in (a hosted demo
 *   that predates APP_ENV=demo).
 *
 * Computed from process.env directly rather than through the validated env
 * schema, so it stays importable from anywhere the full server environment is
 * not present.
 */
export function devModeFor(env: Record<string, string | undefined>): boolean {
  const app = env.APP_ENV?.trim().toLowerCase();
  if (app === "production" || app === "staging") return false;
  if (app === "development" || app === "test" || app === "demo") return true;
  if (app) return false;
  if (env.NESTO_DEMO_MODE === "true") return true;
  return (env.NODE_ENV ?? "development") !== "production";
}

export const isDevMode = devModeFor(process.env);

/**
 * Whether the platform administrator is offered as a one-click demo account
 * (AUD-06 §4, gap 6). On a developer's machine, yes. On a hosted demo, no:
 * anyone who opens the sign-in page would become the operator of every
 * tenant on it, so there the platform account signs in with its password
 * like any real one. Always a subset of devModeFor.
 */
export function platformOneClickFor(env: Record<string, string | undefined>): boolean {
  if (!devModeFor(env)) return false;
  const app = env.APP_ENV?.trim().toLowerCase();
  if (app) return app === "development" || app === "test";
  return (env.NODE_ENV ?? "development") !== "production";
}

export const allowsPlatformOneClick = platformOneClickFor(process.env);
