import { describe, expect, it } from "vitest";

import { permissionsForRole } from "@/config/role-defaults";
import { ROLE_KEYS } from "@/config/roles";
import { contractMachine } from "@/lib/modules/contracts/contracts/contract.machine";
import { unitContractRequestMachine } from "@/lib/modules/contracts/units/unit-contract-request.machine";
import { UNIT_CONTRACT_STATUS_LABELS } from "@/lib/modules/contracts/units/unit-contract.types";
import { paymentScheduleMachine } from "@/lib/modules/finance/units/payment-schedule.machine";
import { financialStatus, installmentStatus, progressPercent, proposeAllocations, scheduleTarget } from "@/lib/modules/finance/units/unit-finance.rules";
import { canMarkUnitSold } from "@/lib/modules/sales/units/unit-sales.rules";

/**
 * The derivations and policies behind a unit's contract and collection
 * (E-05F §9, §22, §40, §41, §42-§44, §56, §85, §121, §122), without a database.
 */

const DAY = 86_400_000;
const today = new Date("2026-09-17T00:00:00.000Z");
const due = (days: number) => new Date(today.getTime() + days * DAY + 12 * 3_600_000);

describe("installment status (§22)", () => {
  it("derives upcoming, due, partly paid, paid and overdue from the due date and what is allocated", () => {
    const active = { scheduleStatus: "ACTIVE" as const, amount: "50000", today };
    expect(installmentStatus({ ...active, paid: "0", dueDate: due(30) })).toBe("UPCOMING");
    expect(installmentStatus({ ...active, paid: "0", dueDate: due(7) })).toBe("DUE");
    expect(installmentStatus({ ...active, paid: "0", dueDate: due(0) })).toBe("DUE");
    expect(installmentStatus({ ...active, paid: "20000", dueDate: due(30) })).toBe("PARTIALLY_PAID");
    expect(installmentStatus({ ...active, paid: "20000", dueDate: due(-1) })).toBe("OVERDUE");
    expect(installmentStatus({ ...active, paid: "50000", dueDate: due(-1) })).toBe("PAID");
  });

  it("closes the installments of a superseded or cancelled schedule, keeping what was paid", () => {
    expect(installmentStatus({ scheduleStatus: "SUPERSEDED", amount: "100", paid: "100", dueDate: due(-5), today })).toBe("PAID");
    expect(installmentStatus({ scheduleStatus: "SUPERSEDED", amount: "100", paid: "40", dueDate: due(-5), today })).toBe("CANCELLED");
    expect(installmentStatus({ scheduleStatus: "CANCELLED", amount: "100", paid: "0", dueDate: due(5), today })).toBe("CANCELLED");
    expect(installmentStatus({ scheduleStatus: "DRAFT", amount: "100", paid: "0", dueDate: due(-5), today })).toBe("UPCOMING");
  });
});

describe("financial status, in the PRD's order (§40, §41, §85, §121)", () => {
  const base = { value: "300000", paid: "0", overdue: "0", unallocated: "0", openInstallments: "300000" };
  it("walks every status", () => {
    expect(financialStatus({ ...base, contractStatus: null })).toBe("NO_CONTRACT");
    for (const status of ["DRAFT", "IN_REVIEW", "PENDING_APPROVAL", "APPROVED", "SENT"]) expect(financialStatus({ ...base, contractStatus: status })).toBe("CONTRACT_PENDING");
    expect(financialStatus({ ...base, contractStatus: "ACTIVE" })).toBe("PAYMENT_PENDING");
    expect(financialStatus({ ...base, contractStatus: "SIGNED", paid: "40000" })).toBe("PARTIALLY_PAID");
    expect(financialStatus({ ...base, contractStatus: "ACTIVE", paid: "40000", overdue: "10000" })).toBe("OVERDUE");
    expect(financialStatus({ ...base, contractStatus: "ACTIVE", paid: "300000", openInstallments: "0" })).toBe("FINANCIALLY_COMPLETE");
    // Paid in full with money left to resolve is paid, not yet complete.
    expect(financialStatus({ ...base, contractStatus: "ACTIVE", paid: "300000", openInstallments: "0", unallocated: "500" })).toBe("PAID");
    expect(financialStatus({ ...base, contractStatus: "ACTIVE", paid: "300000", openInstallments: "1000" })).toBe("PAID");
    // Settled before overdue: nothing outstanding is not overdue.
    expect(financialStatus({ ...base, contractStatus: "COMPLETED", paid: "300000", overdue: "1000", openInstallments: "0" })).toBe("FINANCIALLY_COMPLETE");
  });

  it("measures progress and what a new schedule must cover", () => {
    expect(progressPercent("300000", "120000")).toBe("40.0");
    expect(progressPercent("300000", "310000")).toBe("100.0");
    expect(progressPercent("0", "0")).toBeNull();
    expect(scheduleTarget("300000", "30000").toFixed(2)).toBe("270000.00");
    expect(scheduleTarget("300000", "320000").toFixed(2)).toBe("0.00");
  });

  it("proposes allocations earliest first, never beyond what each owes", () => {
    const rows = [
      { id: "b", dueDate: due(60), sequence: 2, outstanding: "90000" },
      { id: "a", dueDate: due(5), sequence: 1, outstanding: "30000" },
      { id: "c", dueDate: due(90), sequence: 3, outstanding: "0" },
    ];
    expect(proposeAllocations("100000", rows)).toEqual([
      { installmentId: "a", amount: "30000.00" },
      { installmentId: "b", amount: "70000.00" },
    ]);
    expect(proposeAllocations("200000", rows)).toEqual([
      { installmentId: "a", amount: "30000.00" },
      { installmentId: "b", amount: "90000.00" },
    ]);
  });
});

describe("the Sold rule (§42-§44, §122)", () => {
  const reserved = { status: "RESERVED" as const, reservation: { status: "ACTIVE", clientId: "c", opportunityId: "o", agreedPrice: "300000.00" } };
  it("rejects Sold before each rule's conditions are met, and allows it after", () => {
    expect(canMarkUnitSold({ ...reserved, rule: "RESERVATION" }).allowed).toBe(true);
    expect(canMarkUnitSold({ ...reserved, rule: "SIGNED_CONTRACT", contract: null }).missing).toEqual(["A signed contract"]);
    expect(canMarkUnitSold({ ...reserved, rule: "SIGNED_CONTRACT", contract: { signed: false } }).missing).toEqual(["A signed contract"]);
    expect(canMarkUnitSold({ ...reserved, rule: "SIGNED_CONTRACT", contract: { signed: true } }).allowed).toBe(true);
    expect(canMarkUnitSold({ ...reserved, rule: "DEPOSIT_RECEIVED", deposit: { exists: false, paid: false } }).missing).toEqual(["A deposit in the active payment schedule"]);
    expect(canMarkUnitSold({ ...reserved, rule: "DEPOSIT_RECEIVED", deposit: { exists: true, paid: false } }).missing).toEqual(["The deposit paid in full"]);
    expect(canMarkUnitSold({ ...reserved, rule: "SIGNED_CONTRACT_AND_DEPOSIT", contract: { signed: true }, deposit: { exists: true, paid: false } }).allowed).toBe(false);
    expect(canMarkUnitSold({ ...reserved, rule: "SIGNED_CONTRACT_AND_DEPOSIT", contract: { signed: false }, deposit: { exists: true, paid: true } }).allowed).toBe(false);
    expect(canMarkUnitSold({ ...reserved, rule: "SIGNED_CONTRACT_AND_DEPOSIT", contract: { signed: true }, deposit: { exists: true, paid: true } }).allowed).toBe(true);
    expect(canMarkUnitSold({ ...reserved, rule: "MANUAL_APPROVAL", approval: { status: "PENDING" } }).missing).toEqual(["An approved sale (waiting for a decision)"]);
    expect(canMarkUnitSold({ ...reserved, rule: "MANUAL_APPROVAL", approval: { status: "APPROVED" } }).allowed).toBe(true);
  });

  it("keeps a unit under contract past its reservation's date", () => {
    const now = new Date("2026-09-17T12:00:00.000Z");
    const lapsed = { ...reserved, reservation: { ...reserved.reservation, expiresAt: "2026-09-10T12:00:00.000Z" }, now };
    expect(canMarkUnitSold({ ...lapsed, rule: "SIGNED_CONTRACT", contract: null }).missing).toContain("A reservation that has not expired");
    expect(canMarkUnitSold({ ...lapsed, rule: "SIGNED_CONTRACT", contract: { signed: true } }).allowed).toBe(true);
  });
});

describe("machines (§9, §20, §12; PRD #49)", () => {
  it("completes only an active contract, archives a completed one, and names each status the E-05F way", () => {
    const complete = contractMachine.transitions.find((row) => row.action === "complete")!;
    expect([complete.from, complete.to]).toEqual([["ACTIVE"], "COMPLETED"]);
    expect(contractMachine.transitions.find((row) => row.action === "archive")!.from).toContain("COMPLETED");
    expect([UNIT_CONTRACT_STATUS_LABELS.IN_REVIEW, UNIT_CONTRACT_STATUS_LABELS.APPROVED, UNIT_CONTRACT_STATUS_LABELS.COMPLETED]).toEqual(["Under review", "Ready for signature", "Completed"]);
  });

  it("supersedes, completes and cancels schedules only from where they can be, and ends requests once", () => {
    const from = (action: string) => paymentScheduleMachine.transitions.find((row) => row.action === action)!.from;
    expect(from("activate")).toEqual(["DRAFT"]);
    expect(from("supersede")).toEqual(["ACTIVE"]);
    expect(from("cancel_with_contract")).toEqual(["DRAFT", "ACTIVE"]);
    expect(paymentScheduleMachine.terminal).toEqual(["SUPERSEDED", "COMPLETED", "CANCELLED"]);
    expect(unitContractRequestMachine.transitions.every((row) => row.from.length === 1 && row.from[0] === "OPEN")).toBe(true);
  });
});

describe("default permission policy (§54-§56, §123, §130)", () => {
  const holds = (role: (typeof ROLE_KEYS)[number], permission: string) => (permissionsForRole(role) as readonly string[]).includes(permission);

  it("lets Finance collect, Legal contract, and Sales ask — each only for its own part", () => {
    expect(holds("FINANCE", "project.unit.finance.record_payment")).toBe(true);
    expect(holds("FINANCE", "project.unit.contract.create")).toBe(false);
    expect(holds("LEGAL", "project.unit.contract.sign_status")).toBe(true);
    expect(holds("LEGAL", "project.unit.finance.record_payment")).toBe(false);
    expect(holds("SALES", "project.unit.contract.request")).toBe(true);
    expect(holds("SALES", "project.unit.finance.record_payment")).toBe(false);
    expect(holds("SALES", "project.unit.contract.create")).toBe(false);
    expect(holds("SALES_MANAGER", "project.unit.sale.approve")).toBe(true);
    expect(holds("SALES", "project.unit.sale.approve")).toBe(false);
  });

  it("keeps Architecture and Engineering from a unit's contract and money, and the Viewer from changing either", () => {
    for (const role of ["ARCHITECT", "ARCHITECTURE_MANAGER", "ENGINEER"] as const) {
      expect((permissionsForRole(role) as readonly string[]).filter((permission) => /^project\.unit\.(legal|contract|finance|sale)\b/.test(permission)), role).toEqual([]);
    }
    expect((permissionsForRole("VIEWER") as readonly string[]).filter((permission) => /^project\.unit\.(legal|contract|finance|sale)\b/.test(permission)).sort()).toEqual(["project.unit.finance.view", "project.unit.legal.view"]);
    for (const role of ROLE_KEYS) {
      // Correcting money is never granted without reading it.
      if (holds(role, "project.unit.finance.correct")) expect(holds(role, "project.unit.finance.view"), role).toBe(true);
    }
  });
});
