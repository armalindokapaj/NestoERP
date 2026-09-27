"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { RejectDialog } from "@/components/finance/reject-dialog";
import {
  recordMaterialDecisionAction,
  removeMaterialDecisionAction,
  releaseMaterialAction,
  revokeReleaseAction,
} from "@/lib/actions/qaqc";
import type {
  MaterialDecisionDTO,
  MaterialReleaseDTO,
} from "@/lib/modules/qaqc/qaqc.types";
import { ReleaseBadge } from "./qaqc-format";

/**
 * Deciding what happens to delivered material (PRD #21 §90, §91, §96, §98).
 *
 * The equation is shown as the inspector types, because
 * `accepted + rejected + conditional = inspected` is the whole rule and it is
 * far better to see it not balancing than to be refused on save. The server
 * checks the same thing in Decimal (§220).
 *
 * Releasing is deliberately a second, separate act: quality decides, and only
 * then does Inventory get to book anything in (§102).
 */
export function MaterialPanel({
  inspectionId,
  lines,
  decisions,
  release,
  canDecide,
  canRelease,
}: {
  inspectionId: string;
  lines: { id: string; description: string; receivedQuantity: string; unit: string }[];
  decisions: MaterialDecisionDTO[];
  release: MaterialReleaseDTO | null;
  canDecide: boolean;
  canRelease: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [dialog, setDialog] = React.useState<"release" | "revoke" | null>(null);

  // A fresh form after each recorded decision: new values, a new baseline.
  const [formKey, setFormKey] = React.useState(0);

  function runRelease(notes: string | null) {
    return new Promise<boolean>((resolve) => {
      startTransition(async () => {
        const result = await releaseMaterialAction(inspectionId, notes);
        if (result.ok) {
          setDialog(null);
          toast({ title: result.message ?? "Released.", tone: "success" });
          router.refresh();
          resolve(true);
        } else {
          toast({ title: result.error, tone: "danger" });
          resolve(false);
        }
      });
    });
  }

  function removeDecision(goodsReceiptItemId: string) {
    startTransition(async () => {
      const result = await removeMaterialDecisionAction(inspectionId, goodsReceiptItemId);
      if (result.ok) {
        toast({ title: result.message ?? "Decision removed.", tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  function runRevoke(reason: string) {
    return new Promise<boolean>((resolve) => {
      startTransition(async () => {
        const result = await revokeReleaseAction(inspectionId, reason);
        if (result.ok) {
          setDialog(null);
          toast({ title: result.message ?? "Revoked.", tone: "success" });
          router.refresh();
          resolve(true);
        } else {
          toast({ title: result.error, tone: "danger" });
          resolve(false);
        }
      });
    });
  }

  return (
    <div className="space-y-4">
      {decisions.length > 0 ? (
        // Five figures and Remove need ~560px: they pan inside a labelled region
        // instead of being clipped by the card (AUD-04 §5, D-04-01, MW-05).
        <ScrollRegion label="Material decisions" className="nesto-card">
          <table className="w-full min-w-[34rem] text-table">
            <caption className="sr-only">Material decisions on this inspection</caption>
            <thead>
              <tr className="border-b border-line text-left text-meta text-fg-subtle">
                <th scope="col" className="px-4 py-2 font-medium">Line</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Inspected</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Accepted</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Rejected</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Conditional</th>
                {canDecide && !release ? <th scope="col" className="px-4 py-2" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {decisions.map((decision) => (
                <tr key={decision.id}>
                  <td className="px-4 py-2.5 text-fg">
                    {decision.line?.description ?? (
                      <span className="text-fg-subtle">Delivery line</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-fg">
                    {decision.inspectedQuantity} {decision.unit}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-success-strong">
                    {decision.acceptedQuantity}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-danger-strong">
                    {decision.rejectedQuantity}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-warning-strong">
                    {decision.conditionalQuantity}
                  </td>
                  {/*
                    * Only before release. Once material has been released to
                    * stock the decision is what stock was posted against, and
                    * removing it would leave the posting unexplained (§236).
                    */}
                  {canDecide && !release ? (
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => removeDecision(decision.goodsReceiptItemId)}
                      >
                        Remove
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      ) : (
        <p className="nesto-card p-5 text-table text-fg-subtle">
          Nothing decided yet. Record how much of each delivered line passed, failed, or passed
          with a condition.
        </p>
      )}

      {release ? (
        <div className="nesto-card space-y-2 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-card font-semibold text-fg">Release</h3>
            <ReleaseBadge status={release.status} />
          </div>
          <p className="text-table text-fg-muted">
            <span className="tabular-nums text-fg">{release.releasedQuantity}</span> {release.unit}{" "}
            released to stock,{" "}
            <span className="tabular-nums text-fg">{release.rejectedQuantity}</span> rejected.
          </p>
          {release.revocationReason ? (
            <p className="text-meta text-fg-subtle">
              <span className="font-medium">Revoked:</span> {release.revocationReason}
            </p>
          ) : null}
          {release.capabilities.canRevoke ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setDialog("revoke")}
            >
              Revoke the release
            </Button>
          ) : null}
        </div>
      ) : canRelease ? (
        <div className="nesto-card space-y-3 p-5">
          <h3 className="text-card font-semibold text-fg">Release to stock</h3>
          <p className="text-table text-fg-muted">
            Accepted and conditionally accepted quantity becomes available for Inventory to book
            in. Rejected quantity never reaches a warehouse.
          </p>
          <Button size="sm" disabled={pending} onClick={() => setDialog("release")}>
            Release material
          </Button>
        </div>
      ) : null}

      {canDecide && lines.length > 0 ? (
        <DecisionForm
          key={formKey}
          inspectionId={inspectionId}
          lines={lines}
          onRecorded={() => setFormKey((key) => key + 1)}
        />
      ) : null}

      <RejectDialog
        open={dialog === "release"}
        onOpenChange={(open) => setDialog(open ? "release" : null)}
        title="Release this material to stock?"
        description="Accepted and conditionally accepted quantity becomes available for Inventory to book in. Rejected quantity does not."
        label="Note"
        placeholder="Anything the storeman should know?"
        confirmLabel="Release material"
        pendingLabel="Releasing…"
        emptyMessage=""
        onReject={(note) => runRelease(note || null)}
      />

      <RejectDialog
        open={dialog === "revoke"}
        onOpenChange={(open) => setDialog(open ? "revoke" : null)}
        title="Revoke this release?"
        description="Only possible before Inventory has booked the delivery in. Afterwards the correction is a stock adjustment."
        label="Reason"
        placeholder="Why is the release being taken back?"
        confirmLabel="Revoke release"
        pendingLabel="Revoking…"
        emptyMessage="Say why it is being revoked."
        onReject={(reason) => runRevoke(reason)}
      />
    </div>
  );
}

/**
 * Recording one line's decision (PRD #21 §90, §91): quantities typed before
 * one save, so an editor under the unsaved-work contract (AUD-03 §3) whose
 * "Save and continue" runs this same "Record decision" — including the balance
 * rule its button is held back by. Remounted after each recorded decision, so
 * the next one starts empty with a fresh baseline.
 */
function DecisionForm({
  inspectionId,
  lines,
  onRecorded,
}: {
  inspectionId: string;
  lines: { id: string; description: string; receivedQuantity: string; unit: string }[];
  onRecorded: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const formRef = React.useRef<HTMLFormElement>(null);

  const [lineId, setLineId] = React.useState(lines[0]?.id ?? "");
  const [inspected, setInspected] = React.useState("");
  const [accepted, setAccepted] = React.useState("");
  const [rejected, setRejected] = React.useState("0");
  const [conditional, setConditional] = React.useState("0");

  const line = lines.find((row) => row.id === lineId);

  const balance = React.useMemo(() => {
    const scale = (value: string) => {
      const parsed = Number.parseFloat(value.replace(",", "."));
      return Number.isFinite(parsed) ? Math.round(parsed * 10_000) : null;
    };

    const parts = [inspected, accepted, rejected, conditional].map(scale);
    if (parts.some((part) => part === null)) return null;

    const [i, a, r, c] = parts as number[];
    return { difference: (a + r + c - i) / 10_000, balanced: a + r + c === i };
  }, [inspected, accepted, rejected, conditional]);
  const balanceRef = React.useRef(balance);
  balanceRef.current = balance;

  const save = useEditorSave({
    formRef,
    action: async (formData: FormData) => {
      // The rule the button is disabled by holds for the prompt's save too.
      if (balanceRef.current && !balanceRef.current.balanced) {
        return {
          ok: false as const,
          error: "Accepted, rejected and conditional must add up to the quantity inspected.",
        };
      }
      return recordMaterialDecisionAction(inspectionId, formData);
    },
    module: "qaqc",
    saveKind: "create",
    label: "Material decision",
    onCommitted: (result, mode) => {
      if (mode === "normal") {
        toast({ title: result?.message ?? "Decision recorded.", tone: "success" });
        router.refresh();
      }
      onRecorded();
      return true;
    },
  });
  const { pending } = save;

  return (
    <form ref={formRef} onSubmit={save.onSubmit} className="nesto-card space-y-4 p-5">
      <div>
        <h3 className="text-card font-semibold text-fg">Record a decision</h3>
        <p className="mt-1 text-meta text-fg-subtle">
          Recording a line again replaces the earlier decision on it.
        </p>
      </div>

      <SaveMessages save={save} />

      <fieldset disabled={pending || Boolean(save.saved)} aria-busy={pending || undefined} className="m-0 min-w-0 space-y-4 border-0 p-0">
        <div className="space-y-1.5">
          <Label htmlFor="goodsReceiptItemId">Delivery line</Label>
          <select
            id="goodsReceiptItemId"
            name="goodsReceiptItemId"
            className={selectClass}
            value={lineId}
            onChange={(event) => setLineId(event.target.value)}
            required
          >
            {lines.map((row) => (
              <option key={row.id} value={row.id}>
                {row.description} — {row.receivedQuantity} {row.unit} received
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="inspectedQuantity">Inspected</Label>
            <Input
              id="inspectedQuantity"
              name="inspectedQuantity"
              value={inspected}
              onChange={(event) => setInspected(event.target.value)}
              inputMode="decimal"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acceptedQuantity">Accepted</Label>
            <Input
              id="acceptedQuantity"
              name="acceptedQuantity"
              value={accepted}
              onChange={(event) => setAccepted(event.target.value)}
              inputMode="decimal"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rejectedQuantity">Rejected</Label>
            <Input
              id="rejectedQuantity"
              name="rejectedQuantity"
              value={rejected}
              onChange={(event) => setRejected(event.target.value)}
              inputMode="decimal"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conditionalQuantity">Conditional</Label>
            <Input
              id="conditionalQuantity"
              name="conditionalQuantity"
              value={conditional}
              onChange={(event) => setConditional(event.target.value)}
              inputMode="decimal"
              required
            />
          </div>
        </div>

        {balance && !balance.balanced ? (
          <p className="text-meta text-danger-strong">
            Accepted, rejected and conditional are{" "}
            <span className="tabular-nums">{Math.abs(balance.difference)}</span>{" "}
            {balance.difference > 0 ? "more" : "less"} than the quantity inspected. Every unit
            looked at has to end up in exactly one of the three.
          </p>
        ) : balance?.balanced ? (
          <p className="text-meta text-fg-subtle">
            Balanced against {inspected} {line?.unit ?? ""} inspected.
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="notes">Note</Label>
          <Textarea id="notes" name="notes" rows={2} maxLength={2000} />
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending || (balance !== null && !balance.balanced)}>
          {pending ? "Saving…" : "Record decision"}
        </Button>
        <UnsavedIndicator save={save} />
      </div>
    </form>
  );
}
