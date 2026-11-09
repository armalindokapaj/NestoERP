import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sticky breadcrumb bar, as the server draws it, for each shape of tenant.
 * The workspace's own levels (group, company) are named only where they tell
 * the reader something the sidebar header does not (workspaceCrumbs).
 */
const state = vi.hoisted(() => ({
  pathname: "/dashboard",
  registered: null as { label: string; href?: string }[] | null,
  groupEntry: { status: "pending" } as { status: "pending" } | { status: "ready"; canEnter: boolean } | { status: "failed" },
  companies: [] as { id: string; name: string }[],
  workspace: null as unknown,
}));

vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslations: (namespace: string) => (key: string, values?: { label?: string }) => {
    if (namespace === "modules") return key.split(".")[0].replace(/^./, (letter) => letter.toUpperCase());
    return values?.label ? `${key}:${values.label}` : key;
  },
}));
vi.mock("@/components/layout/shell-slots", () => ({
  useGroupEntry: () => state.groupEntry,
  useWorkspaceOptions: () => ({ state: { status: "ready", workspaces: { companies: state.companies }, total: state.companies.length } }),
}));
vi.mock("@/components/workspace/workspace-switch-provider", () => ({ useOptionalWorkspaceSwitch: () => ({ switchTo: () => undefined }) }));
vi.mock("@/components/navigation/record-navigation-provider", () => ({
  useRecordNavigation: () => ({ workspace: state.workspace, canGoBack: false, canGoForward: false, navigate: () => undefined }),
}));
vi.mock("@/components/navigation/breadcrumb-registry", () => ({
  useRegisterBreadcrumbs: () => undefined,
  useRegisteredBreadcrumbs: () => state.registered,
}));
vi.mock("@/components/navigation/nav-link", () => ({
  default: ({ href, title, children }: { href: string; title?: string; children?: unknown }) => h("a", { href, title }, children as never),
}));

import { BreadcrumbBar } from "@/components/ui/breadcrumbs";

function render() {
  const markup = renderToStaticMarkup(h(BreadcrumbBar));
  const trail = markup.slice(markup.indexOf("<nav"), markup.indexOf("</nav>"));
  const back = /<button[^>]*aria-label="([^"]+)"[^>]*>/.exec(markup)!;
  return { trail, backLabel: back[1], backDisabled: / disabled=""/.test(back[0]) };
}

const count = (text: string, part: string) => text.split(part).length - 1;

function workspace(input: { scopeType: "GROUP" | "COMPANY"; group: string; company: string | null; standalone: boolean }) {
  state.workspace = {
    key: "k",
    scopeType: input.scopeType,
    companyId: input.company ? "c1" : null,
    group: { name: input.group, standalone: input.standalone },
    company: input.company ? { id: "c1", name: input.company } : null,
  };
}

beforeEach(() => {
  state.pathname = "/dashboard";
  state.registered = null;
  state.groupEntry = { status: "pending" };
  state.companies = [];
});

describe("a tenant of one company", () => {
  beforeEach(() => {
    workspace({ scopeType: "COMPANY", group: "EL&EL Construction", company: "EL&EL Construction", standalone: true });
    state.companies = [{ id: "c1", name: "EL&EL Construction" }];
    state.groupEntry = { status: "ready", canEnter: false };
  });

  it("names neither group nor company: the Dashboard is just Dashboard, and Back has nowhere to go", () => {
    const { trail, backDisabled } = render();
    expect(trail).toContain("Dashboard");
    expect(trail).not.toContain("EL&amp;EL Construction");
    expect(backDisabled).toBe(true);
  });

  it("starts a record's trail at the module", () => {
    state.pathname = "/projects/p1";
    state.registered = [{ label: "Projects", href: "/projects" }, { label: "Tailor of Tirana" }];
    const { trail, backLabel } = render();
    expect(trail).toContain('href="/projects"');
    expect(trail).toContain("Tailor of Tirana");
    expect(trail).not.toContain("EL&amp;EL Construction");
    expect(backLabel).toBe("backTo:Projects");
  });

  it("still goes Back to the company's Dashboard from a deep-linked module page", () => {
    state.pathname = "/projects";
    const { trail, backLabel, backDisabled } = render();
    expect(trail).not.toContain("EL&amp;EL Construction");
    expect(backDisabled).toBe(false);
    expect(backLabel).toBe("backTo:EL&amp;EL Construction");
  });

  it("names the company when the page names nothing at all", () => {
    state.pathname = "/somewhere-unregistered";
    const { trail } = render();
    expect(trail).toContain('aria-current="page"');
    expect(count(trail, "EL&amp;EL Construction")).toBeGreaterThan(0);
  });
});

describe("a company of a larger group", () => {
  beforeEach(() => {
    workspace({ scopeType: "COMPANY", group: "ARVELA Group", company: "EOT Construction", standalone: false });
    state.companies = [{ id: "c1", name: "EOT Construction" }, { id: "c2", name: "Other" }];
    state.pathname = "/projects";
  });

  it("names the company, with its switcher, and not a group the person cannot open", () => {
    state.groupEntry = { status: "ready", canEnter: false };
    const { trail } = render();
    expect(trail).toContain("EOT Construction");
    expect(trail).toContain('aria-label="switchTo:company"');
    expect(trail).not.toContain("ARVELA Group");
  });

  it("does not name the group while it is unknown whether it opens", () => {
    expect(render().trail).not.toContain("ARVELA Group");
    state.groupEntry = { status: "failed" };
    expect(render().trail).not.toContain("ARVELA Group");
  });

  it("names the group as a link once it opens", () => {
    state.groupEntry = { status: "ready", canEnter: true };
    const { trail } = render();
    expect(trail).toContain('title="ARVELA Group"');
    expect(trail).toMatch(/<a href="\/dashboard" title="ARVELA Group"/);
    expect(trail).toContain("EOT Construction");
  });

  it("names a group that bears the company's own name once, as the company", () => {
    workspace({ scopeType: "COMPANY", group: "EOT Construction", company: "EOT Construction", standalone: false });
    state.groupEntry = { status: "ready", canEnter: true };
    const { trail } = render();
    expect(count(trail, 'title="EOT Construction"')).toBe(1);
    expect(trail).toContain('aria-label="switchTo:company"');
  });
});

describe("the Group view", () => {
  it("names the group alone", () => {
    workspace({ scopeType: "GROUP", group: "ARVELA Group", company: null, standalone: false });
    state.groupEntry = { status: "ready", canEnter: true };
    state.pathname = "/projects";
    const { trail } = render();
    expect(trail).toContain("ARVELA Group");
    expect(trail).not.toContain("switchTo:company");
  });
});
