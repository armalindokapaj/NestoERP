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
 * Computed from process.env directly rather than through the validated env
 * schema, so it stays importable from anywhere the full server environment is
 * not present.
 */
const ENVIRONMENT = process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";

export const isDevMode = ENVIRONMENT !== "production" && ENVIRONMENT !== "staging";
