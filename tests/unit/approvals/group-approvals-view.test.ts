import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }) }));

import { EMPTY_FILTERS } from "@/components/approvals/approval-filters";
import { ApprovalsShell } from "@/components/approvals/approvals-shell";
import { ToastProvider } from "@/components/ui/toast";
import type { ApprovalCompany, ApprovalQueueResult, UnifiedApprovalItem } from "@/lib/modules/approvals/approvals.types";

/**
 * The Approvals Center as the Group workspace draws it (Workspace Context §33,
 * §45, §74): a read view. Every row names its company and opens inside it, the
 * header says how many wait in each, and nothing on the page can decide,
 * return or delegate — those belong to one company's workspace.
 */

const A: ApprovalCompany = { id: "company_a", name: "ARLIS" };
const B: ApprovalCompany = { id: "company_b", name: "IDEAL" };

const item = (id: string, company?: ApprovalCompany): UnifiedApprovalItem => ({
  id: `finance:${id}`,
  providerKey: "finance",
  sourceType: "expense",
  sourceId: `expense_${id}`,
  approvalId: id,
  sourceLabel: "Expense",
  title: `EXP-${id} — Scaffold hire`,
  subtitle: null,
  reference: null,
  status: "PENDING",
  priority: "HIGH",
  amount: { value: "1200", currency: "EUR" },
  project: { id: "project", name: "Riverside", code: null },
  requester: { memberId: "member", name: "Ana Kola" },
  requestedAt: "2026-09-01T00:00:00.000Z",
  dueAt: null,
  decidedAt: null,
  decidedBy: null,
  currentStep: null,
  totalSteps: null,
  stepLabel: null,
  href: `/finance/expenses/expense_${id}`,
  canApprove: true,
  canReject: true,
  canReturn: true,
  requiresStrongConfirmation: false,
  blockedReason: null,
  onBehalfOf: null,
  version: 1,
  dueState: "none",
  urgency: 100,
  sortAt: "2026-09-01T00:00:00.000Z",
  ...(company ? { company } : {}),
});

const base: ApprovalQueueResult = {
  items: [],
  nextCursor: null,
  counts: { waiting: 0, overdue: 0, critical: 0, capped: false, partial: false, unavailable: [] },
  failedProviders: [],
  windowed: false,
  providers: [{ key: "finance", label: "Finance", moduleKey: "finance" }],
  canViewHistory: true,
  canManageDelegation: true,
};

function render(initial: ApprovalQueueResult, group: boolean): string {
  return renderToStaticMarkup(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(ApprovalsShell, {
        initialState: { tab: "waiting", q: "", sort: "urgency", filters: EMPTY_FILTERS, returned: "all" },
        initial,
        initialSelection: null,
        initialDetail: null,
        initialDetailError: null,
        openDelegation: false,
        group,
      }),
    ),
  );
}

describe("the Group workspace's Approvals Center", () => {
  const initial: ApprovalQueueResult = {
    ...base,
    items: [item("1", A), item("2", B)],
    counts: {
      waiting: 2,
      overdue: 0,
      critical: 0,
      capped: false,
      partial: false,
      unavailable: [],
      byCompany: [
        { company: A, waiting: 1, overdue: 0, critical: 0, capped: false, partial: false },
        { company: B, waiting: 1, overdue: 0, critical: 0, capped: false, partial: false },
      ],
    },
    failedProviders: [{ key: "sales", label: "Sales", moduleKey: "sales", company: B }],
    canManageDelegation: false,
    companies: [A, B],
  };

  it("labels each row with its company, opens it inside that company, and says how many wait in each", () => {
    const html = render(initial, true);
    expect(html).toContain('data-testid="approvals-by-company">ARLIS 1 · IDEAL 1<');
    expect(html.match(/data-testid="company-tag"/g)).toHaveLength(2);
    // The row and its "Open record" link both go through the enter-company step, one company each.
    expect(html).toContain('href="/approvals?approval=finance%3A1" data-company-id="company_a"');
    expect(html).toContain('href="/finance/expenses/expense_2" data-company-id="company_b"');
    expect(html).toContain("Sales (IDEAL)");
  });

  it("offers no review, decision, delegation or selectable row", () => {
    const html = render(initial, true);
    expect(html).not.toContain("Delegation");
    expect(html).not.toContain("Approval review");
    expect(html).not.toContain("approval-sheet");
    // A row is a link, not a button that opens a review.
    expect(html.match(/data-testid="approval-row"/g)).toHaveLength(2);
    expect(html).not.toMatch(/<button[^>]*data-testid="approval-row"/);
  });

  it("says there is nothing to read, rather than failing, when no company offers approvals (§76)", () => {
    const html = render({ ...base, canManageDelegation: false, companies: [] }, true);
    expect(html).toContain("No accessible data for this module.");
  });

  it("leaves a company workspace as it was: selectable rows, the review panel and delegation, no company labels", () => {
    const html = render({ ...base, items: [item("1"), item("2")], counts: { waiting: 2, overdue: 0, critical: 0, capped: false, partial: false, unavailable: [] } }, false);
    expect(html).toContain("Delegation");
    expect(html).toContain("Approval review");
    expect(html).toMatch(/<button[^>]*data-testid="approval-row"/);
    expect(html).not.toContain("company-tag");
    expect(html).not.toContain("approvals-by-company");
  });
});

/** AUD-10 §4, CW-03: a source that could not be read is never "0 waiting" or "all caught up". */
describe("an incomplete queue", () => {
  const finance = { key: "finance" as const, label: "Finance", moduleKey: "finance" };

  it("positive control: a complete, empty queue is all caught up", () => {
    const html = render(base, false);
    expect(html).toContain("You’re all caught up");
    expect(html).not.toContain("approvals-incomplete");
  });

  it("names the missing source and never says all caught up when nothing else waits", () => {
    const html = render({ ...base, counts: { ...base.counts, partial: true, unavailable: [finance] } }, false);
    expect(html).not.toContain("all caught up");
    expect(html).toContain("Some approvals could not be loaded");
    expect(html).toContain("The total is incomplete: Finance could not be loaded.");
    expect(html).toContain('data-testid="approvals-unavailable"');
    expect(html).toContain("Nothing to show from the sources that loaded.");
    expect(html).not.toContain("No approvals require your decision.");
  });

  it("gives an at-least total when other sources still answered, and marks the company that is short", () => {
    const counts = {
      waiting: 2,
      overdue: 0,
      critical: 0,
      capped: false,
      partial: true,
      unavailable: [{ ...finance, company: B }],
      byCompany: [
        { company: A, waiting: 1, overdue: 0, critical: 0, capped: false, partial: false },
        { company: B, waiting: 1, overdue: 0, critical: 0, capped: false, partial: true },
      ],
    };
    const html = render({ ...base, items: [item("1", A), item("2", B)], counts, canManageDelegation: false, companies: [A, B] }, true);
    expect(html).toContain("At least 2 waiting for you");
    expect(html).toContain('data-testid="approvals-by-company">ARLIS 1 · IDEAL 1+<');
    expect(html).toContain("Finance (IDEAL)");
  });
});
