import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

/**
 * Input modes for a phone keyboard (MOB-04 §26). `type="number"` is avoided for
 * money and measurements: it reformats, drops trailing zeros and rejects a
 * comma decimal. A decimal value is a text input with a decimal keypad, checked
 * by the shared `decimalValidator`; a whole number gets the numeric keypad.
 */
export type FieldKind = "text" | "email" | "phone" | "url" | "search" | "decimal" | "integer";

export function inputPropsFor(kind: FieldKind): Pick<React.ComponentProps<"input">, "type" | "inputMode" | "autoComplete" | "autoCapitalize" | "spellCheck" | "enterKeyHint"> {
  switch (kind) {
    case "email":
      return { type: "email", inputMode: "email", autoComplete: "email", autoCapitalize: "none", spellCheck: false };
    case "phone":
      return { type: "tel", inputMode: "tel", autoComplete: "tel" };
    case "url":
      return { type: "url", inputMode: "url", autoCapitalize: "none", spellCheck: false };
    case "search":
      return { type: "search", inputMode: "search", enterKeyHint: "search" };
    case "decimal":
      return { type: "text", inputMode: "decimal", autoComplete: "off" };
    case "integer":
      return { type: "text", inputMode: "numeric", autoComplete: "off" };
    default:
      return { type: "text" };
  }
}

/**
 * A number with its unit or currency attached (MOB-04 §37, §38): `118 [m²]`,
 * `245,000 [EUR]`. The unit is a visual adornment outside the value — it is
 * announced with the field (`aria-describedby` via `unitId`) but never submitted
 * or mistaken for typed text. The decimal keypad is used; the stored value is
 * whatever the user typed, parsed by the server rules, never reformatted here.
 */
export function UnitInput({
  unit,
  kind = "decimal",
  className,
  id,
  "aria-describedby": describedBy,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & { unit: string; kind?: "decimal" | "integer" }) {
  const unitId = id ? `${id}-unit` : undefined;
  return (
    <div className="relative">
      <Input
        id={id}
        {...inputPropsFor(kind)}
        aria-describedby={[describedBy, unitId].filter(Boolean).join(" ") || undefined}
        className={cn("pr-14 tabular-nums", className)}
        {...props}
      />
      <span id={unitId} className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-meta text-fg-subtle">
        {unit}
      </span>
    </div>
  );
}
