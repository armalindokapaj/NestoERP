import { Checkbox } from "@/components/ui/checkbox";
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Radio } from "@/components/ui/radio";
import { SearchField } from "@/components/ui/search-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { CatalogEntry, SpecimenGroup } from "./frame";
import { SearchDemo } from "./live";

/** A labelled field: the label is a real label, and a hint or an error is tied to the control. */
function Field({ id, label, note, error, children }: { id: string; label: string; note?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="w-full min-w-0 space-y-1.5 sm:w-64">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p id={`${id}-error`} className="text-meta text-danger-strong">{error}</p> : null}
      {note ? <p id={`${id}-note`} className="text-meta text-fg-subtle">{note}</p> : null}
    </div>
  );
}

export function FieldEntry() {
  return (
    <CatalogEntry
      id="fields"
      title="Inputs, selects and search"
      source="components/ui/input.tsx · textarea.tsx · select.tsx · form-select.tsx · search-field.tsx"
      summary="One control height for the density — 40px, 32px compact, 44px under touch — the 3:1 control border, square. The border is what identifies a field, so it is never a divider grey."
      notes={{
        props: "Input and Textarea: the native attributes, aria-invalid for an error. Select: value, onValueChange, disabled. FormSelect: the native select's own, with option children. SearchField: the native input's, with onClear and shortcut.",
        role: "Native input and textarea; the select is a combobox with a listbox.",
        keyboard: "Tab to it. A select opens with Enter, Space or the arrows and is typed into to find an option. Escape clears the search field, then leaves it.",
        events: "The native onChange, onBlur and onFocus. A FormSelect's onChange carries an event whose target is its hidden input, so a plain form keeps working.",
        precedence: "Disabled blocks. Error styling stays through hover and focus. Read-only is focusable and can be copied.",
        nesting: "A field stands beside its label and its message; nothing interactive goes inside it but its own clear button.",
        responsive: "40px high, 32px in compact density, 44px under touch, where a list opens as a slab of the overlay radius. Fields take the width of their column.",
        data: "Controlled or uncontrolled, as the caller chooses. The message under a field is the caller's, tied to it with aria-describedby.",
        notApplicable: "Pressed, selected (a select shows its chosen option), loading.",
        avoid: "A placeholder in place of a label, or an error shown by colour alone.",
      }}
    >
      <SpecimenGroup title="Input">
        <Field id="f-default" label="Project name" note="Default — Tab to it">
          <Input id="f-default" placeholder="e.g. Tirana Tower" aria-describedby="f-default-note" />
        </Field>
        <Field id="f-value" label="Project name" note="With a value">
          <Input id="f-value" defaultValue="Riverside Residences" aria-describedby="f-value-note" />
        </Field>
        <Field id="f-long" label="Project name" note="Long text scrolls inside the field">
          <Input id="f-long" defaultValue="Riverside Residences, Phase Two — Blocks C and D with the shared basement" aria-describedby="f-long-note" />
        </Field>
        <Field id="f-error" label="Contract value" error="Enter an amount greater than zero.">
          <Input id="f-error" defaultValue="0" inputMode="decimal" aria-invalid="true" aria-describedby="f-error-error" />
        </Field>
        <Field id="f-readonly" label="Invoice number" note="Read-only: focusable, selectable, not editable">
          <Input id="f-readonly" readOnly defaultValue="INV-2042" aria-describedby="f-readonly-note" />
        </Field>
        <Field id="f-disabled" label="Currency" note="Disabled">
          <Input id="f-disabled" disabled defaultValue="EUR" aria-describedby="f-disabled-note" />
        </Field>
      </SpecimenGroup>

      <SpecimenGroup title="Textarea">
        <Field id="t-default" label="Notes" note="Default">
          <Textarea id="t-default" placeholder="What changed on site today?" aria-describedby="t-default-note" />
        </Field>
        <Field id="t-error" label="Reason for rejection" error="Say why it was rejected, so it can be corrected.">
          <Textarea id="t-error" aria-invalid="true" aria-describedby="t-error-error" />
        </Field>
        <Field id="t-disabled" label="Notes" note="Disabled">
          <Textarea id="t-disabled" disabled defaultValue="Closed with the period." aria-describedby="t-disabled-note" />
        </Field>
      </SpecimenGroup>

      <SpecimenGroup title="Select">
        <Field id="s-default" label="Status" note="Select — the product's own list">
          <Select defaultValue="review">
            <SelectTrigger id="s-default" aria-describedby="s-default-note"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="review">In review</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="long">Returned to the subcontractor for a revised method statement</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field id="s-form" label="Company" note="FormSelect — a drop-in for a native select">
          <FormSelect id="s-form" name="company" defaultValue="aurelia" className="w-full" aria-describedby="s-form-note">
            <option value="">All companies</option>
            <option value="aurelia">Aurelia Construction</option>
            <option value="terra">Terra Infrastructure</option>
          </FormSelect>
        </Field>
        <Field id="s-disabled" label="Status" note="Disabled">
          <Select defaultValue="approved" disabled>
            <SelectTrigger id="s-disabled" aria-describedby="s-disabled-note"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="approved">Approved</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </SpecimenGroup>

      <SpecimenGroup title="Search">
        <div className="w-full min-w-0 space-y-1.5 sm:w-64">
          <SearchDemo />
          <p className="text-meta text-fg-subtle">With text and a clear button — live</p>
        </div>
        <div className="w-full min-w-0 space-y-1.5 sm:w-64">
          <SearchField aria-label="Search projects" placeholder="Search projects…" shortcut="/" />
          <p className="text-meta text-fg-subtle">Empty, with a shortcut hint</p>
        </div>
        <div className="w-full min-w-0 space-y-1.5 sm:w-64">
          <SearchField aria-label="Search unavailable" placeholder="Search is not available here" disabled />
          <p className="text-meta text-fg-subtle">Disabled</p>
        </div>
      </SpecimenGroup>

      <SpecimenGroup title="Checkbox, radio and switch" hint="Their size does not follow the density; under touch each has a 44px hit area around it." className="gap-x-8">
        <label className="flex items-center gap-2 text-body text-fg touch:min-h-11"><Checkbox />Unchecked</label>
        <label className="flex items-center gap-2 text-body text-fg touch:min-h-11"><Checkbox defaultChecked />Checked</label>
        <label className="flex items-center gap-2 text-body text-fg touch:min-h-11"><Checkbox checked="indeterminate" />Indeterminate</label>
        <label className="flex items-center gap-2 text-body text-fg-muted touch:min-h-11"><Checkbox disabled />Disabled</label>
        <fieldset className="flex items-center gap-4">
          <legend className="sr-only">Billing</legend>
          <label className="flex items-center gap-2 text-body text-fg touch:min-h-11"><Radio name="catalog-billing" defaultChecked />Billable</label>
          <label className="flex items-center gap-2 text-body text-fg touch:min-h-11"><Radio name="catalog-billing" />Not billable</label>
        </fieldset>
        <label className="flex items-center gap-2 text-body text-fg touch:min-h-11"><Switch defaultChecked />Email me a daily summary</label>
        <label className="flex items-center gap-2 text-body text-fg-muted touch:min-h-11"><Switch disabled />Disabled</label>
      </SpecimenGroup>
    </CatalogEntry>
  );
}
