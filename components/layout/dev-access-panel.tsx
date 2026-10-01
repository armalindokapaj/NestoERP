"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, Wrench } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * The development access debugger (PRD #5 §68, PRD #7 §123, PRD #9 §212).
 *
 * Shows exactly what the resolver decided for the signed-in account and the
 * page you are looking at: who, which session and membership, the role and
 * position held, the assignments and grants behind them, then the module,
 * access level, data scope and the permissions in play. During implementation
 * and manual QA this turns "why can't I see this?" from a guess into a reading.
 * Every value is the account's own: nothing overrides a role (C-01 §37).
 *
 * Rendered only when the caller has already checked `isDevMode`, and never
 * mounted in a production build (PRD #9 §211).
 */
export type DevAccessSnapshot = {
  user: string;
  userId: string;
  sessionId: string;
  membershipId: string;
  company: string;
  /** The membership's role, label and key. */
  role: string;
  position: string;
  department: string;
  /** Live department assignments that concern this company, one line each. */
  assignments: string[];
  /** Delegated access in this company, one line each. */
  grants: string[];
  permissionCount: number;
  /** module key → resolved access. */
  modules: Record<string, { label: string; accessLevel: string; scope: string; permissions: string[] }>;
};

const STORAGE_KEY = "nesto.dev-access-open";

export function DevAccessPanel({ snapshot }: { snapshot: DevAccessSnapshot }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    setOpen(window.localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  function toggle() {
    setOpen((current) => {
      window.localStorage.setItem(STORAGE_KEY, String(!current));
      return !current;
    });
  }

  const moduleKey = pathname.split("/").filter(Boolean)[0] ?? "dashboard";
  const access = snapshot.modules[moduleKey];

  return (
    <div className="fixed bottom-[calc(0.75rem+var(--nesto-bottom-nav-space,0px))] left-3 z-[80] max-w-[min(22rem,calc(100vw-1.5rem))] print:hidden">
      {!open ? (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={false}
          aria-label="Dev access"
          title={`Dev access${access ? `: ${access.accessLevel} / ${access.scope}` : ""}`}
          className="nesto-card flex size-7 items-center justify-center text-fg-subtle shadow-menu transition-colors hover:bg-hover"
        >
          <Wrench aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
      <div className={cn("nesto-card overflow-hidden shadow-menu", !open && "hidden")}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-micro font-semibold uppercase tracking-[0.08em] text-fg-subtle transition-colors hover:bg-hover"
        >
          <Wrench aria-hidden="true" className="size-3.5" />
          Dev access
          <span className="ml-auto flex items-center gap-1.5 normal-case tracking-normal text-fg-muted">
            {access ? `${access.accessLevel} / ${access.scope}` : "—"}
            <ChevronDown
              aria-hidden="true"
              className={cn("size-3.5 transition-transform", open && "rotate-180")}
            />
          </span>
        </button>

        {open ? (
          <dl className="space-y-1.5 border-t border-line px-3 py-2.5 text-meta">
            <Row label="User" value={snapshot.user} />
            <Row label="User ID" value={snapshot.userId} mono />
            <Row label="Session ID" value={snapshot.sessionId} mono />
            <Row label="Membership ID" value={snapshot.membershipId} mono />
            <Row label="Company" value={snapshot.company} />
            <Row label="Role" value={snapshot.role} />
            <Row label="Position" value={snapshot.position} />
            <Row label="Department" value={snapshot.department} />
            <Lines label="Assignments" values={snapshot.assignments} />
            <Lines label="Grants" values={snapshot.grants} />
            <Row label="Permissions" value={`${snapshot.permissionCount} effective`} />
            <Row label="Module" value={access?.label ?? moduleKey} />
            <Row label="Access" value={access?.accessLevel ?? "NONE"} />
            <Row label="Scope" value={access?.scope ?? "—"} />

            {access && access.permissions.length > 0 ? (
              <div className="pt-1">
                <dt className="text-fg-subtle">Module permissions</dt>
                <dd className="mt-1 max-h-40 overflow-y-auto font-mono text-micro leading-relaxed text-fg-muted">
                  {access.permissions.map((permission) => (
                    <div key={permission}>{permission}</div>
                  ))}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-fg-subtle">{label}</dt>
      <dd title={value} className={cn("min-w-0 truncate text-right text-fg", mono && "font-mono text-micro")}>{value}</dd>
    </div>
  );
}

function Lines({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return <Row label={label} value="—" />;
  return (
    <div>
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 max-h-24 overflow-y-auto font-mono text-micro leading-relaxed text-fg-muted">
        {values.map((value, index) => (
          <div key={`${index}:${value}`}>{value}</div>
        ))}
      </dd>
    </div>
  );
}
