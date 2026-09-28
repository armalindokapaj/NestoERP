import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { cleanupSessions, loginAs, loginAsPlatformAdmin, PROJECT, prisma } from "../helpers";
import { actAs } from "./harness/actor";
import { signedInAs } from "./harness/platform-session";
import { callRoute, discoverApiRoutes, fillPattern, HTTP_METHODS, loadRouteModule, type ApiRoute } from "./harness/routes";

vi.mock("@/lib/context/resolve-user-context", () => import("./harness/actor"));
vi.mock("@/lib/auth", () => import("./harness/platform-session"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn }));

/**
 * The platform's own surface, against tenant sessions (AUD-06 §6, RP-13;
 * E-06 §19, §116).
 *
 * The earlier boundary test covered /api/platform/3d. This one covers every
 * route file under app/api/platform and app/api/platform-admin — found on
 * disk, every exported method called — and every page under
 * app/admin, including the Experience Editor's route group, through
 * the guard those pages run (requirePlatformContext) and through the page
 * itself. The tenant attackers are the strongest a company has: its Owner, who
 * holds every tenant permission, and Group IT, who administers accounts and
 * settings. Both must be refused before any lookup — 403 from the API with the
 * plain envelope, a redirect to their own dashboard from a page — with real
 * ids in the path, and nothing in the database may change. The positive
 * control is the Platform Admin, whose session reaches every one of them.
 */

const PLATFORM_API = /^\/api\/platform(-admin)?\//;
const DASHBOARD = "/dashboard";

let owner: UserContext;
let groupIt: UserContext;
let admin: Awaited<ReturnType<typeof loginAsPlatformAdmin>>;
let realIds: Record<string, string>;

beforeAll(async () => {
  owner = await loginAs("OWNER");
  groupIt = await loginAs("GROUP_IT");
  admin = await loginAsPlatformAdmin();
  const department = await prisma.groupDepartment.findFirst({ where: { parentGroupId: owner.parentGroupId! }, select: { id: true } });
  const companyDepartment = await prisma.department.findFirst({ where: { companyId: owner.companyId }, select: { id: true } });
  // Real ids of the tenant's own group and records: a refusal must not depend on the id being wrong.
  realIds = {
    groupId: owner.parentGroupId!,
    projectId: PROJECT.a,
    companyId: owner.companyId,
    departmentId: department?.id ?? "department_missing",
    companyDepartmentId: companyDepartment?.id ?? "company_department_missing",
  };
}, 60_000);

afterAll(async () => {
  actAs(null);
  signedInAs(null);
  await cleanupSessions();
  await prisma.$disconnect();
});

/** A company session, as both resolvers would see it from the cookie. */
function asTenant(context: UserContext) {
  actAs(context);
  signedInAs({ userId: context.userId, sessionId: context.sessionId });
}

/** The Platform Admin's session: no company, so the business resolver declines it. */
function asPlatformAdmin() {
  actAs(null);
  signedInAs({ userId: admin.userId, sessionId: admin.sessionId });
}

/** Every table but the session rows each login writes: a digest the tenant sweep must leave untouched. */
async function databaseDigest(): Promise<Map<string, string>> {
  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('sessions', '_prisma_migrations') ORDER BY tablename`);
  const digest = new Map<string, string>();
  for (const { tablename } of tables) {
    const [row] = await prisma.$queryRawUnsafe<{ d: string }[]>(`SELECT count(*)::text || ':' || md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS d FROM "${tablename}" t`);
    digest.set(tablename, row.d);
  }
  return digest;
}

const differences = (before: Map<string, string>, after: Map<string, string>) => [...before.keys()].filter((key) => before.get(key) !== after.get(key));

function platformRoutes(): ApiRoute[] {
  return discoverApiRoutes().filter((route) => PLATFORM_API.test(route.pattern));
}

describe("every platform API route refuses a tenant session (RP-13)", () => {
  it("finds every platform route file on disk", () => {
    const onDisk = ["app/api/platform", "app/api/platform-admin"].flatMap((root) => (readdirSync(root, { recursive: true }) as string[]).filter((entry) => entry.endsWith("route.ts")).map((entry) => join(root, entry)));
    expect(platformRoutes().map((route) => route.file).sort()).toEqual(onDisk.sort());
    expect(onDisk.length).toBeGreaterThan(30);
  });

  it("answers the Owner and Group IT 403 on every method, with real ids, and changes nothing", async () => {
    const before = await databaseDigest();
    const answered: string[] = [];
    let calls = 0;
    for (const attacker of [owner, groupIt]) {
      for (const route of platformRoutes()) {
        const handlers = await loadRouteModule(route);
        const params = Object.fromEntries(route.params.map((name) => [name, realIds[name] ?? `aud06-${name}`]));
        for (const method of HTTP_METHODS) {
          const handler = handlers[method];
          if (!handler) continue;
          asTenant(attacker);
          const outcome = await callRoute(handler, method, fillPattern(route.pattern, params), params, { name: "AUD-06 forged", reason: "AUD-06 forged platform write", status: "ACTIVE" });
          calls += 1;
          const error = (outcome.body as { error?: Record<string, unknown> } | null)?.error;
          const envelope = error ? Object.keys(error).sort().join(",") : "";
          if (outcome.thrown || outcome.status !== 403 || error?.code !== "FORBIDDEN" || envelope !== "code,message,requestId") {
            answered.push(`${attacker.role} ${method} ${route.pattern} → ${outcome.status} ${outcome.thrown ?? JSON.stringify(outcome.body).slice(0, 160)}`);
          }
        }
      }
    }
    const changed = differences(before, await databaseDigest());
    expect(calls).toBeGreaterThan(90);
    expect(answered).toEqual([]);
    expect(changed).toEqual([]);
  }, 300_000);

  it("lets the Platform Admin through every one of them (positive control)", async () => {
    const refused: string[] = [];
    let reads = 0;
    for (const route of platformRoutes()) {
      const handlers = await loadRouteModule(route);
      for (const method of HTTP_METHODS) {
        const handler = handlers[method];
        if (!handler) continue;
        asPlatformAdmin();
        // Reads use real ids; writes use ids that exist nowhere and an empty body, so they pass the guard and stop at validation or lookup.
        const params = Object.fromEntries(route.params.map((name) => [name, method === "GET" ? (realIds[name] ?? `aud06-${name}`) : `aud06-missing-${name}`]));
        const outcome = await callRoute(handler, method, fillPattern(route.pattern, params), params, {});
        if (outcome.thrown || outcome.status === 401 || outcome.status === 403 || outcome.status >= 500) refused.push(`${method} ${route.pattern} → ${outcome.status} ${outcome.thrown ?? JSON.stringify(outcome.body).slice(0, 160)}`);
        if (method === "GET" && route.params.length === 0) {
          reads += 1;
          if (outcome.status !== 200) refused.push(`GET ${route.pattern} → ${outcome.status}`);
        }
      }
    }
    expect(reads).toBeGreaterThan(4);
    expect(refused).toEqual([]);
  }, 300_000);
});

/* -------------------------------------------------------------------------- */
/* Pages                                                                       */
/* -------------------------------------------------------------------------- */

const PAGE_ROOTS = ["app/admin", "app/(experience-editor)/admin"];

function platformFiles(name: "page.tsx" | "layout.tsx"): string[] {
  return PAGE_ROOTS.flatMap((root) => (readdirSync(root, { recursive: true }) as string[]).filter((entry) => entry.split("/").pop() === name).map((entry) => join(root, entry))).sort();
}

/** The URL a page file serves, route groups removed. */
const urlOf = (file: string) => `/${dirname(file).replace(/^app\//, "").replace(/\([^)]+\)\//g, "")}`.replace(/\/$/, "");

/** The layouts that wrap a page, nearest last, inside the platform tree. */
function layoutsOf(page: string): string[] {
  const layouts = new Set(platformFiles("layout.tsx"));
  const chain: string[] = [];
  for (let dir = dirname(page); dir.startsWith("app/") || dir === "app"; dir = dirname(dir)) {
    if (layouts.has(join(dir, "layout.tsx"))) chain.unshift(join(dir, "layout.tsx"));
    if (dir === "app") break;
  }
  return chain;
}

const guards = (file: string) => /await requirePlatformContext\(\)/.test(readFileSync(file, "utf8"));
const paramsFor = (file: string) => Object.fromEntries([...file.matchAll(/\[([^\]]+)\]/g)].map((match) => [match[1], realIds[match[1]] ?? `aud06-${match[1]}`]));

type Rendered = { redirectedTo?: string; notFound?: boolean; thrown?: string; rendered?: boolean };

async function render(file: string): Promise<Rendered> {
  const page = (await import(/* @vite-ignore */ `@/${file}`)) as { default: (props: unknown) => unknown };
  const params = paramsFor(file);
  try {
    await page.default({ params: Promise.resolve(params), searchParams: Promise.resolve({}), children: null });
    return { rendered: true };
  } catch (error) {
    const digest = error && typeof error === "object" && "digest" in error ? String((error as { digest: unknown }).digest) : "";
    if (digest.startsWith("NEXT_REDIRECT")) return { redirectedTo: digest.split(";")[2] };
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return { notFound: true };
    return { thrown: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

describe("every platform page refuses a tenant session (RP-13)", () => {
  it("has a platform guard on every page or on a layout above it", () => {
    const pages = platformFiles("page.tsx");
    expect(pages.length).toBeGreaterThan(35);
    const unguarded = pages.filter((page) => !guards(page) && !layoutsOf(page).some(guards));
    expect(unguarded).toEqual([]);
    // The platform tree's own root layout guards everything under app/admin.
    expect(guards("app/admin/layout.tsx")).toBe(true);
  });

  it("sends a tenant back to their dashboard from the guard itself, and admits the Platform Admin", async () => {
    for (const attacker of [owner, groupIt]) {
      asTenant(attacker);
      const outcome = await requirePlatformContext().then(() => ({ redirectedTo: "none" }), (error: { digest?: string }) => ({ redirectedTo: String(error.digest ?? "").split(";")[2] }));
      expect(outcome.redirectedTo).toBe(DASHBOARD);
    }
    asPlatformAdmin();
    await expect(requirePlatformContext()).resolves.toMatchObject({ userId: admin.userId, sessionId: admin.sessionId });
  });

  it("redirects a tenant away from every page and layout before rendering anything", async () => {
    const pages = platformFiles("page.tsx");
    const guardedUrls = new Set(pages.filter(guards).map(urlOf));
    const leaked: string[] = [];
    for (const attacker of [owner, groupIt]) {
      for (const file of [...platformFiles("layout.tsx"), ...pages]) {
        asTenant(attacker);
        const outcome = await render(file);
        // A page that only forwards to another platform page is fine when that page is itself guarded.
        const forwarded = outcome.redirectedTo && !guards(file) && guardedUrls.has(outcome.redirectedTo);
        if (outcome.redirectedTo !== DASHBOARD && !forwarded) leaked.push(`${attacker.role} ${file} → ${JSON.stringify(outcome)}`);
      }
    }
    expect(leaked).toEqual([]);
  }, 300_000);

  it("admits the Platform Admin to every page and layout (positive control)", async () => {
    const refused: string[] = [];
    let rendered = 0;
    for (const file of [...platformFiles("layout.tsx"), ...platformFiles("page.tsx")]) {
      asPlatformAdmin();
      const outcome = await render(file);
      if (outcome.rendered) rendered += 1;
      // Past the guard is the point: a forwarding page redirects inside the
      // platform, and a project with no 3D configuration fails at its own
      // lookup (the demo seeds none) — neither is a refusal. Only being sent
      // out of the platform area is.
      if (outcome.redirectedTo !== undefined && !outcome.redirectedTo.startsWith("/admin")) refused.push(`${file} → ${JSON.stringify(outcome)}`);
    }
    expect(refused).toEqual([]);
    expect(rendered).toBeGreaterThan(30);
  }, 300_000);
});
