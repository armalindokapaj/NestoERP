"use client";

import * as React from "react";
import { Loader2, UserRoundCog } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { ApprovalDelegationDTO, ApprovalProviderSummary } from "@/lib/modules/approvals/approvals.types";
import { approvalsApi, failureMessage } from "./approvals-api";
import { formatDay } from "./approval-ui";

/**
 * Delegation (PRD #41 §32-§35, §170-§173): who is standing in for you, and for
 * whom you are standing in. The server decides everything — the people
 * offered are only those who could open the chosen source, and a delegation
 * that would be circular, overlapping or passed on is refused with a reason.
 */

type Listing = { given: ApprovalDelegationDTO[]; received: ApprovalDelegationDTO[]; canManage: boolean };
type Candidate = { memberId: string; fullName: string; jobTitle: string | null };

const STATE_TONE = { ACTIVE: "success", UPCOMING: "info", ENDED: "default", REVOKED: "default" } as const;
const STATE_TEXT = { ACTIVE: "Active", UPCOMING: "Upcoming", ENDED: "Ended", REVOKED: "Revoked" } as const;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function DelegationDialog({ open, onOpenChange, providers }: { open: boolean; onOpenChange: (open: boolean) => void; providers: ApprovalProviderSummary[] }) {
  const toast = useToast();
  const [listing, setListing] = React.useState<Listing | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [pending, setPending] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ providerKey: "", toMemberId: "", startsOn: today(), endsOn: today(), reason: "" });
  const [search, setSearch] = React.useState("");
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setListing(await approvalsApi<Listing>("/api/approvals/delegations"));
    } catch (failure) {
      setError(failureMessage(failure, "Delegations could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open) void load();
  }, [open, load]);

  React.useEffect(() => {
    if (!open || !listing?.canManage) return;
    const handle = window.setTimeout(async () => {
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      if (form.providerKey) params.set("provider", form.providerKey);
      try {
        setCandidates(await approvalsApi<Candidate[]>(`/api/approvals/delegations/options?${params}`));
      } catch {
        setCandidates([]);
      }
    }, 200);
    return () => window.clearTimeout(handle);
  }, [open, search, form.providerKey, listing?.canManage]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!form.toMemberId) {
      setError("Choose who will decide for you.");
      return;
    }
    setPending("create");
    try {
      await approvalsApi("/api/approvals/delegations", {
        body: { toMemberId: form.toMemberId, providerKey: form.providerKey || null, startsOn: form.startsOn, endsOn: form.endsOn, reason: form.reason || undefined },
      });
      toast({ title: "Delegation saved", tone: "success" });
      setForm({ providerKey: "", toMemberId: "", startsOn: today(), endsOn: today(), reason: "" });
      setSearch("");
      await load();
    } catch (failure) {
      setError(failureMessage(failure, "The delegation could not be saved."));
    } finally {
      setPending(null);
    }
  }

  async function revoke(row: ApprovalDelegationDTO) {
    setPending(row.id);
    try {
      await approvalsApi(`/api/approvals/delegations/${row.id}`, { method: "DELETE" });
      toast({ title: "Delegation ended", tone: "success" });
      await load();
    } catch (failure) {
      toast({ title: failureMessage(failure, "The delegation could not be ended."), tone: "danger" });
    } finally {
      setPending(null);
    }
  }

  const chosen = candidates.find((row) => row.memberId === form.toMemberId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto" data-testid="delegation-dialog">
        <DialogTitle className="flex items-center gap-2">
          <UserRoundCog aria-hidden="true" className="size-5 text-fg-subtle" />
          Delegation
        </DialogTitle>
        <DialogDescription>
          Lend the approvals assigned to you — a review addressed to you, a step that belongs to your role — to a colleague for a while. They decide on your behalf, and it says so everywhere.
        </DialogDescription>

        {loading && !listing ? (
          <p className="mt-6 flex items-center gap-2 text-table text-fg-muted">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" /> Loading…
          </p>
        ) : listing ? (
          <div className="mt-5 space-y-6">
            <DelegationList title="You delegated" empty="You have not delegated any approvals." rows={listing.given} pending={pending} onRevoke={revoke} who={(row) => `To ${row.to.name}`} />
            <DelegationList title="Delegated to you" empty="Nobody has delegated approvals to you." rows={listing.received} pending={pending} onRevoke={revoke} who={(row) => `From ${row.from.name}`} />

            {listing.canManage ? (
              <form onSubmit={create} className="space-y-4 rounded-xl border border-line bg-surface-muted/50 p-4" aria-labelledby="new-delegation-heading">
                <h3 id="new-delegation-heading" className="text-card font-semibold text-fg">
                  New delegation
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="delegation-scope">Approvals</Label>
                    <select id="delegation-scope" className={selectClass} value={form.providerKey} onChange={(event) => setForm({ ...form, providerKey: event.target.value, toMemberId: "" })}>
                      <option value="">All approvals I decide</option>
                      {providers.map((provider) => (
                        <option key={provider.key} value={provider.key}>
                          {provider.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="delegation-search">Delegate</Label>
                    <Input id="delegation-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search colleagues" autoComplete="off" />
                  </div>
                </div>
                <div role="listbox" aria-label="Colleagues who could decide for you" className="max-h-40 overflow-y-auto rounded-lg border border-line bg-surface">
                  {candidates.length === 0 ? (
                    <p className="px-3 py-2 text-meta text-fg-subtle">Nobody matches who could open these approvals.</p>
                  ) : (
                    candidates.map((candidate) => (
                      <button
                        key={candidate.memberId}
                        type="button"
                        role="option"
                        aria-selected={form.toMemberId === candidate.memberId}
                        onClick={() => setForm({ ...form, toMemberId: candidate.memberId })}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-table hover:bg-hover aria-selected:bg-accent-soft"
                      >
                        <span className="font-medium text-fg">{candidate.fullName}</span>
                        <span className="text-meta text-fg-subtle">{candidate.jobTitle}</span>
                      </button>
                    ))
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="delegation-start">From</Label>
                    <Input id="delegation-start" type="date" min={today()} value={form.startsOn} onChange={(event) => setForm({ ...form, startsOn: event.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="delegation-end">Until (inclusive)</Label>
                    <Input id="delegation-end" type="date" min={form.startsOn} value={form.endsOn} onChange={(event) => setForm({ ...form, endsOn: event.target.value })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="delegation-reason">Reason (optional)</Label>
                  <Textarea id="delegation-reason" rows={2} maxLength={500} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Annual leave" />
                </div>
                {error ? (
                  <p role="alert" className="text-meta font-medium text-danger-strong">
                    {error}
                  </p>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-meta text-fg-muted">{chosen ? `${chosen.fullName} will decide for you.` : "Choose a delegate."}</p>
                  <Button type="submit" disabled={pending === "create"}>
                    {pending === "create" ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                    Delegate
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        ) : error ? (
          <p role="alert" className="mt-4 text-table text-danger-strong">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DelegationList({
  title,
  empty,
  rows,
  pending,
  onRevoke,
  who,
}: {
  title: string;
  empty: string;
  rows: ApprovalDelegationDTO[];
  pending: string | null;
  onRevoke: (row: ApprovalDelegationDTO) => void;
  who: (row: ApprovalDelegationDTO) => string;
}) {
  return (
    <section>
      <h3 className="text-micro font-semibold uppercase tracking-[0.12em] text-fg-subtle">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-table text-fg-subtle">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="delegation-row">
              <span className="min-w-0 flex-1">
                <span className="block text-table font-medium text-fg">
                  {who(row)} · {row.providerLabel}
                </span>
                <span className="block text-meta text-fg-muted">
                  {formatDay(row.startsAt)} – {formatDay(new Date(new Date(row.endsAt).getTime() - 1).toISOString())}
                  {row.reason ? ` · ${row.reason}` : ""}
                </span>
              </span>
              <Badge tone={STATE_TONE[row.state]}>{STATE_TEXT[row.state]}</Badge>
              {row.canRevoke ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => onRevoke(row)} disabled={pending === row.id}>
                  {pending === row.id ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                  End
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
