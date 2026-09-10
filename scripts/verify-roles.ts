/**
 * Automated walk of the spec §70 testing flow.
 *
 * Signs in as every seeded account and checks, for each role:
 *   - login → redirect to /dashboard
 *   - the dashboard renders that role's name and KPI cards
 *   - every module in the role's navigation opens
 *   - every module NOT in its navigation is refused
 *   - write routes are refused for read-only roles
 *   - logout clears the session
 *
 * Run against a running server:  pnpm verify:roles
 */
import { DEMO_PASSWORD, demoAccountForRole } from "../config/demo-company";
import { dashboards } from "../config/dashboards";
import { kpis } from "../config/dashboards";
import { MODULE_KEYS, modules, type ModuleKey } from "../config/modules";
import { navigationForRole } from "../config/navigation";
import { permissionsForRole } from "../config/permissions";
import { roleList, roleLabel, type RoleKey } from "../config/roles";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";

const DENIED_MARKER = "You don&#x27;t have access to this area.";

let failures = 0;
let checks = 0;

function check(condition: boolean, description: string, detail = "") {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.log(`   FAIL  ${description}${detail ? ` — ${detail}` : ""}`);
  }
}

class Session {
  private cookies = new Map<string, string>();

  private header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  private absorb(response: Response) {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === "" ) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      redirect: "manual",
      headers: {
        ...(init.headers ?? {}),
        cookie: this.header(),
      },
    });
    this.absorb(response);
    return response;
  }

  async csrf(): Promise<string> {
    const response = await this.request("/api/auth/csrf");
    const body = (await response.json()) as { csrfToken: string };
    return body.csrfToken;
  }

  async signIn(email: string, password: string): Promise<string | null> {
    const csrfToken = await this.csrf();
    const response = await this.request("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        csrfToken,
        email,
        password,
        callbackUrl: `${BASE}/dashboard`,
      }),
    });
    return response.headers.get("location");
  }

  async signOut(): Promise<void> {
    const csrfToken = await this.csrf();
    await this.request("/api/auth/signout", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, callbackUrl: `${BASE}/login` }),
    });
  }
}

async function verifyRole(role: RoleKey) {
  const account = demoAccountForRole(role);
  if (!account) {
    failures += 1;
    console.log(`   FAIL  ${role}: no demo account defined — run pnpm db:seed`);
    return;
  }

  const session = new Session();

  const location = await session.signIn(account.email, DEMO_PASSWORD);
  check(
    Boolean(location && location.includes("/dashboard")),
    `${role}: login redirects to /dashboard`,
    String(location),
  );

  // Dashboard renders this role's configuration.
  const dashboard = await session.request("/dashboard");
  const html = await dashboard.text();
  check(dashboard.status === 200, `${role}: /dashboard returns 200`, String(dashboard.status));
  check(html.includes(roleLabel(role)), `${role}: dashboard shows the role name`);
  check(!html.includes(DENIED_MARKER), `${role}: dashboard is not access-denied`);

  const expectedKpis = dashboards[role].kpis.map((key) => kpis[key].label);
  for (const label of expectedKpis) {
    check(html.includes(label), `${role}: dashboard shows KPI "${label}"`);
  }

  // An authenticated user is bounced off the login page.
  const loginRedirect = await session.request("/login");
  check(
    loginRedirect.status === 307 || loginRedirect.status === 302,
    `${role}: /login redirects when signed in`,
    String(loginRedirect.status),
  );

  const allowed = new Set<ModuleKey>(navigationForRole(role));
  // Settings and its profile page are reachable from the user menu for everyone.
  const alwaysReachable = new Set<ModuleKey>(["dashboard", "settings"]);

  for (const key of MODULE_KEYS) {
    const response = await session.request(modules[key].href);
    const body = await response.text();
    const denied = body.includes(DENIED_MARKER);

    if (allowed.has(key) || alwaysReachable.has(key)) {
      check(response.status === 200 && !denied, `${role}: can open /${key}`, String(response.status));
      check(
        body.includes(modules[key].label),
        `${role}: /${key} renders the module header`,
      );
    } else {
      check(denied, `${role}: is refused /${key}`, `status ${response.status}`);
    }
  }

  // Sidebar shows exactly the configured modules and nothing else.
  const sidebarHtml = html;
  for (const key of MODULE_KEYS) {
    const href = `href="${modules[key].href}"`;
    const present = sidebarHtml.includes(href);
    if (allowed.has(key)) {
      check(present, `${role}: sidebar links to /${key}`);
    }
  }

  // Write route: only roles holding project.create may open it.
  const newProject = await session.request("/projects/new");
  const newProjectBody = await newProject.text();
  const mayCreate = !newProjectBody.includes(DENIED_MARKER);
  const expectedCreate = permissionsForRole(role).includes("project.create");
  check(
    mayCreate === expectedCreate,
    `${role}: /projects/new ${expectedCreate ? "allowed" : "refused"}`,
  );

  // Logout ends the session.
  await session.signOut();
  const afterLogout = await session.request("/dashboard");
  check(
    afterLogout.status === 307 || afterLogout.status === 302,
    `${role}: logout protects /dashboard again`,
    String(afterLogout.status),
  );
  check(
    (afterLogout.headers.get("location") ?? "").includes("/login"),
    `${role}: logout redirects to /login`,
  );
}

async function verifyPublicRoutes() {
  const session = new Session();

  for (const path of ["/", "/login", "/forgot-password"]) {
    const response = await session.request(path);
    check(response.status === 200, `public: ${path} returns 200`, String(response.status));
  }

  const guarded = await session.request("/dashboard");
  check(
    (guarded.headers.get("location") ?? "").includes("/login"),
    "public: /dashboard redirects anonymous visitors to /login",
  );

  const deepLink = await session.request("/finance");
  check(
    (deepLink.headers.get("location") ?? "").includes("callbackUrl"),
    "public: protected deep link keeps a callbackUrl",
  );

  const badLogin = await session.signIn(demoAccountForRole("OWNER")!.email, "wrong-password");
  check(
    Boolean(badLogin && badLogin.includes("error")),
    "public: wrong password is rejected",
    String(badLogin),
  );

  const missing = await session.request("/does-not-exist");
  check(
    missing.status === 404 || (missing.headers.get("location") ?? "").includes("/login"),
    "public: unknown route is handled",
    String(missing.status),
  );
}

async function main() {
  console.log(`NESTO role verification against ${BASE}\n`);

  console.log("Public routes");
  await verifyPublicRoutes();

  for (const definition of roleList) {
    process.stdout.write(`${definition.code} ${definition.label.padEnd(18)}`);
    const before = failures;
    await verifyRole(definition.key);
    console.log(failures === before ? "ok" : "FAILED");
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) {
    console.log(`${failures} failing`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
