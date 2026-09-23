import { describe, expect, it } from "vitest";

import { permissionsForRole } from "@/config/role-defaults";
import { MEMBERSHIP_ROLE_KEYS, ROLE_KEYS, type RoleKey } from "@/config/roles";
import type { UserContext } from "@/lib/context/types";
import { excerpt, parseBody, parseInline, plainText, safeHref } from "@/lib/modules/announcements/announcement.body";
import { addressableAudiences, audienceWhere, readableAnnouncementWhere } from "@/lib/modules/announcements/announcement.permissions";
import { createAnnouncementSchema, feedQuerySchema } from "@/lib/modules/announcements/announcement.schema";
import { isNavigableType, NAVIGABLE_TYPES } from "@/lib/modules/productivity/navigable.registry";
import { entityRefSchema } from "@/lib/modules/productivity/productivity.schema";

/**
 * Announcement, favorite and recent-work rules that need no database (PRD #45
 * §17-§19, §28-§34, §156, §163, §229-§246, §290).
 */

const has = (role: RoleKey, permission: string) => (permissionsForRole(role) as readonly string[]).includes(permission);
const contextFor = (role: RoleKey, department: string | null = null) =>
  ({
    companyId: "company", membershipId: `member_${role}`, permissions: permissionsForRole(role), department: department ? { id: department, name: department } : null,
    moduleAccess: { announcements: { enabled: true, accessLevel: "VIEW", scope: "COMPANY" }, projects: { enabled: true, accessLevel: "VIEW", scope: "PROJECT" } },
  }) as unknown as UserContext;

describe("announcement grants by role (§229-§246)", () => {
  it("lets everyone read and acknowledge, and only the right people speak to each audience", () => {
    for (const role of MEMBERSHIP_ROLE_KEYS) {
      expect(has(role, "announcement.view"), role).toBe(true);
      expect(has(role, "announcement.acknowledge"), role).toBe(true);
    }
    expect(addressableAudiences(contextFor("OWNER"))).toEqual(["COMPANY", "DEPARTMENT", "PROJECT", "SELECTED_MEMBERS"]);
    expect(addressableAudiences(contextFor("CEO"))).toEqual(["COMPANY", "DEPARTMENT", "SELECTED_MEMBERS"]);
    expect(addressableAudiences(contextFor("HR"))).toEqual(["COMPANY", "DEPARTMENT", "SELECTED_MEMBERS"]);
    expect(addressableAudiences(contextFor("GROUP_IT"))).toEqual(["COMPANY"]);
    expect(addressableAudiences(contextFor("PROJECT_MANAGER"))).toEqual(["PROJECT", "SELECTED_MEMBERS"]);
    for (const role of ["ARCHITECT", "ENGINEER", "FINANCE", "LEGAL", "SALES", "PROCUREMENT", "INVENTORY", "QAQC", "HSE", "VIEWER"] as const) {
      expect(addressableAudiences(contextFor(role)), role).toEqual([]);
      expect(has(role, "announcement.publish"), role).toBe(false);
    }
    // Writing a draft is not publishing it (§34): every role that publishes also writes.
    for (const role of ROLE_KEYS) if (has(role, "announcement.publish")) expect(has(role, "announcement.create"), role).toBe(true);
  });

  it("builds the audience from the member's own department and projects, and nobody else's", () => {
    const engineer = JSON.stringify(audienceWhere(contextFor("ENGINEER", "dept_engineering")));
    expect(engineer).toContain("dept_engineering");
    expect(engineer).toContain("member_ENGINEER");
    expect(engineer).not.toContain('{"audienceType":"DEPARTMENT"}');
    // HR manages department notices, so it reads every department's (§29).
    expect(JSON.stringify(audienceWhere(contextFor("HR", "dept_hr")))).toContain('{"audienceType":"DEPARTMENT"}');
    const closed = { ...contextFor("ENGINEER"), moduleAccess: { announcements: { enabled: false, accessLevel: "VIEW", scope: "COMPANY" } } } as unknown as UserContext;
    expect(readableAnnouncementWhere(closed)).toEqual({ id: { in: [] } });
  });
});

describe("safe rich text (§17)", () => {
  it("parses headings, paragraphs, lists, callouts, bold, italic and links", () => {
    const blocks = parseBody("# Title\n\nFirst **bold** and *italic* line\ncontinues here.\n\n- one\n- two\n\n1. first\n2. second\n\n> Careful\n\nSee [the policy](https://example.com/policy).");
    expect(blocks.map((block) => block.type)).toEqual(["heading", "paragraph", "list", "list", "callout", "paragraph"]);
    expect(blocks[1]).toMatchObject({ type: "paragraph", children: [{ type: "text", text: "First " }, { type: "strong" }, { type: "text", text: " and " }, { type: "em" }, { type: "text", text: " line continues here." }] });
    expect(blocks[2]).toMatchObject({ ordered: false, items: [[{ text: "one" }], [{ text: "two" }]] });
    expect(blocks[3]).toMatchObject({ ordered: true });
    expect(blocks[5]).toMatchObject({ children: [{ type: "text", text: "See " }, { type: "link", href: "https://example.com/policy" }, { type: "text", text: "." }] });
  });

  it("never turns markup into HTML and never links an unsafe target", () => {
    expect(parseInline("<script>alert(1)</script>")).toEqual([{ type: "text", text: "<script>alert(1)</script>" }]);
    expect(parseInline("[click](javascript:alert(1))").some((node) => node.type === "link")).toBe(false);
    expect(parseInline("[click](javascript:void)")).toEqual([{ type: "text", text: "click" }]);
    expect(safeHref("data:text/html,hi")).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("/projects/project_a")).toBe("/projects/project_a");
    expect(safeHref("mailto:hr@nesto.test")).toBe("mailto:hr@nesto.test");
  });

  it("gives search and cards the words without the marks", () => {
    expect(plainText("## Heading\n\n**Bold** [link](https://a.b) and *more*")).toBe("Heading Bold link and more");
    expect(excerpt("word ".repeat(100), 40).endsWith("…")).toBe(true);
    expect(excerpt("Short.", 40)).toBe("Short.");
  });
});

describe("validation (§18, §19, §156, §178, §290)", () => {
  it("limits title and body, requires the audience's target and orders event dates", () => {
    expect(createAnnouncementSchema.safeParse({ title: "x".repeat(181), body: "Body" }).success).toBe(false);
    expect(createAnnouncementSchema.safeParse({ title: "Notice", body: "x".repeat(50_001) }).success).toBe(false);
    expect(createAnnouncementSchema.safeParse({ title: "Notice", body: "Body", audienceType: "PROJECT" }).success).toBe(false);
    expect(createAnnouncementSchema.safeParse({ title: "Notice", body: "Body", audienceType: "SELECTED_MEMBERS", selectedMemberIds: [] }).success).toBe(false);
    expect(createAnnouncementSchema.safeParse({ title: "Notice", body: "Body", eventStartsAt: "2026-10-02T10:00:00Z", eventEndsAt: "2026-10-01T10:00:00Z" }).success).toBe(false);
    expect(createAnnouncementSchema.parse({ title: " Notice ", body: "Body" })).toMatchObject({ title: "Notice", audienceType: "COMPANY", priority: "NORMAL", pinned: false, requiresAcknowledgment: false });
    expect(feedQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(feedQuerySchema.parse({})).toMatchObject({ tab: "for_me", limit: 20 });
  });

  it("accepts only registered record types for favorites and recent work (§163, §317)", () => {
    expect(NAVIGABLE_TYPES).toEqual(["project", "project_milestone", "task", "meeting", "daily_log", "client", "document", "contract", "purchase_order", "invoice", "project_unit", "purchase_request", "rfq", "quality_inspection", "non_conformance_report", "incident"]);
    expect(isNavigableType("employee")).toBe(false);
    expect(entityRefSchema.safeParse({ entityType: "leave_request", entityId: "leave_1" }).success).toBe(false);
    expect(entityRefSchema.safeParse({ entityType: "project", entityId: "../../etc" }).success).toBe(false);
    expect(entityRefSchema.safeParse({ entityType: "project", entityId: "project_a" }).success).toBe(true);
  });
});
