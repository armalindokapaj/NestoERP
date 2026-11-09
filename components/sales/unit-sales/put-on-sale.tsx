"use client";

import * as React from "react";

import { failureMessage, structureApi } from "@/components/project-structure/structure-ui";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * "Also put it on sale" (2026-11-09): wherever a price is saved on a unit that
 * is not for sale — the New and Edit unit dialogs, the Sales section's Price
 * dialog, the Prices page, ticked units' Set price and the unit side panel —
 * the same tick, ticked by default. Unticked, the unit keeps its new price and
 * stays held back. It is offered only to somebody who may change the sale
 * status, and only when the unit can be put on sale (`putOnSaleWithPrice`).
 *
 * The move is the unit's own Put on sale, after the price has saved: a unit
 * that cannot go on sale keeps its price and is named with the reason.
 */
export function PutOnSaleTick({
  checked,
  onChange,
  label,
  hint,
  disabled,
  testId = "put-on-sale",
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  testId?: string;
  className?: string;
}) {
  return (
    <label className={className ?? "flex items-start gap-2 text-table text-fg touch:min-h-11 touch:items-center"} data-testid={testId}>
      <Checkbox className="mt-0.5 shrink-0" checked={checked} onCheckedChange={(value) => onChange(value === true)} disabled={disabled} />
      <span>
        <span className="font-medium">{label}</span>
        {hint ? <span className="block text-meta font-normal text-fg-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

export type PutOnSaleResult = { moved: true; version: number } | { moved: false; message: string };

/**
 * Puts one unit on sale right after its price saved, through the unit's own
 * status door (`project.unit.sales_status.manage`), checked against the
 * version the price save answered with. Never throws: a refusal comes back
 * with the server's reason, and the price stays saved.
 */
export async function putOnSaleAfterPrice(unitId: string, salesVersion: number): Promise<PutOnSaleResult> {
  try {
    const moved = await structureApi<{ version: number }>(`/api/project-units/${unitId}/sales/status`, {
      method: "POST",
      body: { action: "put_on_sale", ...(salesVersion > 0 ? { expectedVersion: salesVersion } : {}) },
    });
    return { moved: true, version: moved.version };
  } catch (error) {
    return { moved: false, message: failureMessage(error) };
  }
}
