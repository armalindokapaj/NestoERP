"use client";

import * as React from "react";
import { Check, UserPlus } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Field, fieldErrors, FormError, failureMessage, isFailure, numberText, structureApi } from "@/components/project-structure/structure-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/ui/search-field";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { SUPPORTED_CURRENCIES } from "@/lib/modules/finance/finance.currency";
import { SALES_NOTES_MAX, SALES_REASON_MAX, UNIT_PRICE_BASES, UNIT_PRICE_BASIS_LABELS, type UnitSalesDTO } from "@/lib/modules/sales/units/unit-sales.types";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { outcomeOf } from "@/lib/unsaved/outcome";
import { cn } from "@/lib/utils/cn";

/**
 * The dialogs a unit's sale is changed through (E-05E §10, §16-§31, §48). Each
 * sends one request and relays the server's answer: a message beside the field
 * it is about, or above the form. Nothing here decides whether a change is
 * allowed — the panel offers only what the reader may do, and the server
 * decides again.
 *
 * Every dialog takes part in the unsaved-work contract (AUD-03 §3, §5): it
 * tells FormDialog whether its values differ from those it opened with, and
 * the X, Escape, the backdrop and Cancel ask before throwing them away. An
 * ordinary save (a price, a correction) is offered as "Save and continue"; a
 * workflow step (reserve, reopen, a reason) is not — leaving offers Stay or
 * Discard.
 */

type Submit = (url: string, body: Record<string, unknown>, success: string) => Promise<void>;

/** A date input's value for an instant, in the reader's own calendar. */
export function dateValue(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The end of the chosen day, where the reader is: a reservation "until the 24th" lasts the whole 24th. */
export function endOfDay(value: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:00`).toISOString() : undefined;
}

export function FormDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  pending,
  error,
  onSubmit,
  children,
  testId,
  wide,
  dirty,
  unresolved = false,
  save,
  workflow,
  module = "units",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel: string;
  pending: boolean;
  error: string | null;
  onSubmit: () => void;
  children: React.ReactNode;
  testId?: string;
  wide?: boolean;
  /** Whether the values differ from those the dialog opened with (`useOpenedWith`). */
  dirty: boolean;
  /** A request that threw before the server answered: it may have gone through (AUD-03 §6). */
  unresolved?: boolean;
  /**
   * An ordinary save, run by "Save and continue" through the same checks as the
   * dialog's own button, without closing or navigating. Absent for a workflow
   * step, which only its own button may take.
   */
  save?: { kind: "save" | "create"; run: () => Promise<SaveOutcome> };
  /** The workflow step's verb for the prompt; the confirm label when absent. */
  workflow?: string;
  module?: string;
}) {
  return (
    // Every close — X, Escape, the backdrop, Cancel — goes through the guarded
    // root, which asks while there is unsaved or in-flight input (AUD-03 §5).
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : null)}>
      <DialogContent className={cn("max-h-[calc(100dvh-2rem)] overflow-y-auto", wide ? "max-w-xl" : "max-w-lg")} data-testid={testId}>
        <DialogEditor label={title} module={module} dirty={dirty} saving={pending} unresolved={unresolved} save={save} workflow={save ? undefined : (workflow ?? confirmLabel)} />
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
        <form
          className="mt-4 space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <FormError message={error} />
          {children}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Working…" : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A dialog's registration with the tab's coordinator (AUD-03 §3, §5). Rendered
 * inside the dialog's content, so closing that dialog is what asks about it.
 * For controlled dialogs whose values live in React state.
 */
export function DialogEditor({
  label,
  module,
  dirty,
  saving,
  unresolved,
  save,
  workflow,
}: {
  label: string;
  module: string;
  dirty: boolean;
  saving: boolean;
  unresolved: boolean;
  save?: { kind: "save" | "create"; run: () => Promise<SaveOutcome> };
  workflow?: string;
}) {
  const editor = useUnsavedEditor({ label, module, saveKind: save ? save.kind : "none", workflow, save: save?.run });
  const { setDirty, setSaving, setUnresolved } = editor;
  React.useEffect(() => setDirty(dirty), [dirty, setDirty]);
  React.useEffect(() => setSaving(saving), [saving, setSaving]);
  React.useEffect(() => setUnresolved(unresolved), [unresolved, setUnresolved]);
  return null;
}

/**
 * Whether a dialog's values differ from those it opened with (AUD-03 §3).
 *
 * The baseline is taken on the render after the dialog opened, once its own
 * reset has applied — so it is exactly what the person was shown. Nothing is
 * trimmed or rounded: putting a value back makes the dialog clean again.
 */
export function useOpenedWith(open: boolean, values: unknown): boolean {
  const key = JSON.stringify(values);
  const [baseline, setBaseline] = React.useState<string | null>(null);
  const [arming, setArming] = React.useState(false);
  React.useEffect(() => {
    setBaseline(null);
    setArming(open);
  }, [open]);
  React.useEffect(() => {
    if (!arming) return;
    setBaseline(key);
    setArming(false);
  }, [arming, key]);
  return open && baseline !== null && key !== baseline;
}

/** What a dialog's request answered, as a save outcome: only no failure is a commit (AUD-03 §6). */
export function requestOutcome(failed: unknown): SaveOutcome {
  if (!failed) return { kind: "committed" };
  // A request that never reached an answer may have gone through.
  if (!isFailure(failed) || failed.code === "NETWORK") return { kind: "unknown" };
  return outcomeOf({ ok: false, code: failed.code, error: failed.message });
}

/** Runs one request for a dialog: pending, a form-level error, and field errors. */
export function useDialogRequest(submit: Submit) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fields, setFields] = React.useState<Record<string, string>>({});
  /** The server said yes: the dialog is saved and closing, so nothing in it is unsaved any more. */
  const [done, setDone] = React.useState(false);
  /** A request that threw without an answer (AUD-03 §6). */
  const [unresolved, setUnresolved] = React.useState(false);
  const reset = React.useCallback(() => {
    setError(null);
    setFields({});
    setDone(false);
    setUnresolved(false);
  }, []);
  const send = React.useCallback(
    async (url: string, body: Record<string, unknown>, success: string): Promise<unknown> => {
      setPending(true);
      reset();
      try {
        await submit(url, body, success);
        setDone(true);
        return null;
      } catch (caught) {
        const byField = fieldErrors(caught);
        setFields(byField);
        setError(Object.keys(byField).length ? null : failureMessage(caught, "That did not work. Try again."));
        setUnresolved(requestOutcome(caught).kind === "unknown");
        return caught;
      } finally {
        setPending(false);
      }
    },
    [submit, reset],
  );
  return { pending, error, fields, send, reset, setError, done, unresolved };
}

function CurrencySelect({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <select id={id} className={selectClass} value={value} onChange={(event) => onChange(event.target.value)}>
      {SUPPORTED_CURRENCIES.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </select>
  );
}

/* Price (§10-§12) --------------------------------------------------------------------- */

export function PriceDialog({ open, onClose, sales, submit }: { open: boolean; onClose: () => void; sales: UnitSalesDTO; submit: Submit }) {
  const request = useDialogRequest(submit);
  const [price, setPrice] = React.useState("");
  const [currency, setCurrency] = React.useState(sales.defaults.currency);
  const [basis, setBasis] = React.useState(sales.priceBasis);
  const [notes, setNotes] = React.useState("");
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    if (!open) return;
    setPrice(sales.askingPrice ?? "");
    setCurrency(sales.currency ?? sales.defaults.currency);
    setBasis(sales.priceBasis);
    setNotes(sales.salesNotes ?? "");
    setReason("");
    request.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const changed = useOpenedWith(open, [price, currency, basis, notes, reason]);
  const send = () => request.send(`/api/project-units/${sales.unitId}/sales`, { askingPrice: price, currency, priceBasis: basis, salesNotes: notes, reason, ...(sales.version > 0 ? { expectedVersion: sales.version } : {}) }, `The price of ${sales.unitCode} was saved.`);

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={`Price of ${sales.unitCode}`}
      description="Every change of the asking price is kept in the price history. The agreed price of a reservation is separate."
      confirmLabel="Save price"
      pending={request.pending}
      error={request.error}
      testId="price-dialog"
      dirty={changed && !request.done}
      unresolved={request.unresolved}
      save={{ kind: "save", run: async () => requestOutcome(await send()) }}
      onSubmit={() => void send().then((failed) => (failed ? null : onClose()))}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <Field label="Asking price" htmlFor="sales-asking-price" error={request.fields.askingPrice}>
          <Input id="sales-asking-price" inputMode="decimal" value={price} onChange={(event) => setPrice(numberText(event.target.value))} autoFocus placeholder="e.g. 185000" />
        </Field>
        <Field label="Currency" htmlFor="sales-currency" error={request.fields.currency}>
          <CurrencySelect id="sales-currency" value={currency} onChange={setCurrency} />
        </Field>
      </div>
      <Field label="Price basis" htmlFor="sales-price-basis" hint="The area the price per m² is worked out from." error={request.fields.priceBasis}>
        <select id="sales-price-basis" className={selectClass} value={basis} onChange={(event) => setBasis(event.target.value as typeof basis)}>
          {UNIT_PRICE_BASES.map((value) => (
            <option key={value} value={value}>
              {UNIT_PRICE_BASIS_LABELS[value]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reason for the change" htmlFor="sales-price-reason" error={request.fields.reason}>
        <Input id="sales-price-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={SALES_REASON_MAX} placeholder="e.g. Second price list" />
      </Field>
      <Field label="Sales notes" htmlFor="sales-notes" error={request.fields.salesNotes}>
        <Textarea id="sales-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={SALES_NOTES_MAX} />
      </Field>
    </FormDialog>
  );
}

/* A reason, and sometimes a date (§26-§28, §31) ---------------------------------------------- */

export function ReasonDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  url,
  body,
  success,
  submit,
  date,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  url: string;
  body: Record<string, unknown>;
  success: string;
  submit: Submit;
  /** A date to ask for beside the reason: required, or optional (a hold's review date). */
  date?: { label: string; field: string; required: boolean; initial?: string; min?: string };
  testId?: string;
}) {
  const request = useDialogRequest(submit);
  const [reason, setReason] = React.useState("");
  const [day, setDay] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setReason("");
    setDay(date?.initial ?? "");
    setTouched(false);
    request.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const changed = useOpenedWith(open, [reason, day]);
  const blank = reason.trim() === "";
  const dayMissing = Boolean(date?.required) && !endOfDay(day);

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      pending={request.pending}
      error={request.error}
      testId={testId}
      dirty={changed && !request.done}
      unresolved={request.unresolved}
      onSubmit={() => {
        setTouched(true);
        if (blank || dayMissing) return;
        const extra = date && endOfDay(day) ? { [date.field]: endOfDay(day) } : {};
        void request.send(url, { ...body, ...extra, reason }, success).then((failed) => (failed ? null : onClose()));
      }}
    >
      {date ? (
        <Field label={date.label} htmlFor="sales-reason-date" required={date.required} error={(touched && dayMissing ? "Choose a date." : undefined) ?? request.fields[date.field]}>
          <Input id="sales-reason-date" type="date" value={day} min={date.min} onChange={(event) => setDay(event.target.value)} />
        </Field>
      ) : null}
      <Field label="Reason" htmlFor="sales-reason" required error={(touched && blank ? "Give a reason." : undefined) ?? request.fields.reason}>
        <Textarea id="sales-reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={SALES_REASON_MAX} autoFocus={!date} aria-invalid={touched && blank} />
      </Field>
    </FormDialog>
  );
}

/* Reopen a sold unit (§31) ------------------------------------------------------------------------ */

export function ReopenDialog({ open, onClose, sales, submit }: { open: boolean; onClose: () => void; sales: UnitSalesDTO; submit: Submit }) {
  const request = useDialogRequest(submit);
  const [to, setTo] = React.useState<"FOR_SALE" | "RESERVED">("FOR_SALE");
  const [reason, setReason] = React.useState("");
  const [day, setDay] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setTo("FOR_SALE");
    setReason("");
    setDay(dateValue(new Date(Date.now() + sales.defaults.reservationDays * 86_400_000)));
    setTouched(false);
    request.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const changed = useOpenedWith(open, [to, reason, day]);
  const blank = reason.trim() === "";

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={`Reopen the sale of ${sales.unitCode}?`}
      description="The sale is undone. The converted reservation stays in the history as cancelled."
      confirmLabel="Reopen sale"
      pending={request.pending}
      error={request.error}
      testId="reopen-dialog"
      dirty={changed && !request.done}
      unresolved={request.unresolved}
      onSubmit={() => {
        setTouched(true);
        if (blank) return;
        void request
          .send(`/api/project-units/${sales.unitId}/reopen-sale`, { to, reason, ...(to === "RESERVED" && endOfDay(day) ? { expiresAt: endOfDay(day) } : {}), ...(sales.version > 0 ? { expectedVersion: sales.version } : {}) }, `The sale of ${sales.unitCode} was reopened.`)
          .then((failed) => (failed ? null : onClose()));
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-meta font-medium text-fg-muted">Return the unit to</legend>
        {(["FOR_SALE", "RESERVED"] as const).map((value) => (
          <label key={value} className="flex items-center gap-2 text-table text-fg">
            <input type="radio" name="reopen-to" value={value} checked={to === value} onChange={() => setTo(value)} />
            {value === "FOR_SALE" ? "For Sale — free for anyone to reserve" : "Reserved — for the same client and deal"}
          </label>
        ))}
      </fieldset>
      {to === "RESERVED" ? (
        <Field label="Reserved until" htmlFor="reopen-expiry" error={request.fields.expiresAt}>
          <Input id="reopen-expiry" type="date" value={day} min={dateValue(new Date())} onChange={(event) => setDay(event.target.value)} />
        </Field>
      ) : null}
      <Field label="Reason" htmlFor="reopen-reason" required error={(touched && blank ? "Give a reason." : undefined) ?? request.fields.reason}>
        <Textarea id="reopen-reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={SALES_REASON_MAX} />
      </Field>
    </FormDialog>
  );
}

/* Correct a reservation (§38 sales_correct) ------------------------------------------------------------ */

export function CorrectDialog({ open, onClose, sales, submit }: { open: boolean; onClose: () => void; sales: UnitSalesDTO; submit: Submit }) {
  const request = useDialogRequest(submit);
  const reservation = sales.activeReservation;
  const [price, setPrice] = React.useState("");
  const [currency, setCurrency] = React.useState(sales.defaults.currency);
  const [notes, setNotes] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => {
    if (!open || !reservation) return;
    setPrice(reservation.agreedPrice ?? "");
    setCurrency(reservation.currency ?? sales.defaults.currency);
    setNotes(reservation.notes ?? "");
    setReason("");
    setTouched(false);
    request.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const changed = useOpenedWith(open, [price, currency, notes, reason]);
  if (!reservation) return null;
  const blank = reason.trim() === "";
  /** The dialog's one save path, for its button and for "Save and continue" alike. */
  const correct = async (): Promise<unknown> => {
    setTouched(true);
    if (blank) return { code: "VALIDATION_ERROR", message: "Give a reason." };
    return request.send(`/api/unit-reservations/${reservation.id}/correct`, { agreedPrice: price, currency, notes, reason, expectedVersion: reservation.version }, `The reservation of ${sales.unitCode} was corrected.`);
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={`Correct the reservation of ${sales.unitCode}`}
      description="An administrative correction. The reason is kept in the audit trail."
      confirmLabel="Save correction"
      pending={request.pending}
      error={request.error}
      testId="correct-dialog"
      dirty={changed && !request.done}
      unresolved={request.unresolved}
      save={{ kind: "save", run: async () => requestOutcome(await correct()) }}
      onSubmit={() => void correct().then((failed) => (failed ? null : onClose()))}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <Field label="Agreed price" htmlFor="correct-price" error={request.fields.agreedPrice}>
          <Input id="correct-price" inputMode="decimal" value={price} onChange={(event) => setPrice(numberText(event.target.value))} />
        </Field>
        <Field label="Currency" htmlFor="correct-currency" error={request.fields.currency}>
          <CurrencySelect id="correct-currency" value={currency} onChange={setCurrency} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="correct-notes" error={request.fields.notes}>
        <Textarea id="correct-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={SALES_NOTES_MAX} />
      </Field>
      <Field label="Reason" htmlFor="correct-reason" required error={(touched && blank ? "Give a reason." : undefined) ?? request.fields.reason}>
        <Input id="correct-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={SALES_REASON_MAX} />
      </Field>
    </FormDialog>
  );
}

/* Reserve (§16-§23) ---------------------------------------------------------------------------------- */

type ClientOption = { id: string; name: string; code: string | null };
type DealOption = { id: string; name: string; stage: string };
type Duplicate = { id: string; name: string; code: string | null; reason: string };

export function ReserveDialog({ open, onClose, sales, submit }: { open: boolean; onClose: () => void; sales: UnitSalesDTO; submit: Submit }) {
  const caps = sales.capabilities;
  const request = useDialogRequest(submit);
  const [clientMode, setClientMode] = React.useState<"existing" | "new">("existing");
  const [client, setClient] = React.useState<ClientOption | null>(null);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<ClientOption[] | null>(null);
  const [newClient, setNewClient] = React.useState({ name: "", type: "INDIVIDUAL", email: "", phone: "" });
  const [duplicates, setDuplicates] = React.useState<Duplicate[] | null>(null);
  const [deals, setDeals] = React.useState<DealOption[] | null>(null);
  const [dealId, setDealId] = React.useState("");
  const [dealName, setDealName] = React.useState("");
  const [day, setDay] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [currency, setCurrency] = React.useState(sales.defaults.currency);
  const [notes, setNotes] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const defaultDay = dateValue(new Date(Date.now() + sales.defaults.reservationDays * 86_400_000));

  React.useEffect(() => {
    if (!open) return;
    setClientMode(caps.canSeeClients ? "existing" : "new");
    setClient(null);
    setQuery("");
    setResults(null);
    setNewClient({ name: "", type: "INDIVIDUAL", email: "", phone: "" });
    setDuplicates(null);
    setDeals(null);
    setDealId("");
    setDealName("");
    setDay(defaultDay);
    setPrice(sales.askingPrice ?? "");
    setCurrency(sales.currency ?? sales.defaults.currency);
    setNotes("");
    setTouched(false);
    request.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Client search, through the Clients module's own list and its own scope (§16, §67).
  React.useEffect(() => {
    if (!open || clientMode !== "existing" || client || !caps.canSeeClients) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ limit: "8", status: "ACTIVE" });
      if (query.trim()) params.set("search", query.trim());
      structureApi<ClientOption[]>(`/api/clients?${params}`)
        .then((rows) => !controller.signal.aborted && setResults(rows))
        .catch(() => !controller.signal.aborted && setResults([]));
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, clientMode, client, query, caps.canSeeClients]);

  // The chosen client's open deals, through the Sales module's own list (§17, §67).
  React.useEffect(() => {
    if (!client || !caps.canSeeDeals) {
      setDeals(null);
      return;
    }
    let live = true;
    structureApi<DealOption[]>(`/api/sales/opportunities?clientId=${encodeURIComponent(client.id)}&outcome=OPEN&limit=50`)
      .then((rows) => {
        if (!live) return;
        setDeals(rows);
        setDealId(rows[0]?.id ?? (caps.canCreateDeal ? "new" : ""));
      })
      .catch(() => live && setDeals([]));
    return () => {
      live = false;
    };
  }, [client, caps.canSeeDeals, caps.canCreateDeal]);

  // The search text finds a client; it is not itself input to keep (AUD-03 §3).
  const changed = useOpenedWith(open, [clientMode, client?.id ?? null, newClient, dealId, dealName, day, price, currency, notes]);
  const creatingDeal = clientMode === "new" || dealId === "new";
  const clientMissing = clientMode === "existing" ? !client : newClient.name.trim().length < 2;
  const dealMissing = !creatingDeal && !dealId;

  async function reserve(acceptDuplicate = false) {
    setTouched(true);
    if (clientMissing || dealMissing) return;
    const body: Record<string, unknown> = {
      ...(clientMode === "existing" ? { clientId: client!.id } : { newClient: { name: newClient.name, type: newClient.type, email: newClient.email, phone: newClient.phone, ...(acceptDuplicate ? { acceptDuplicate: true } : {}) } }),
      ...(creatingDeal ? { newDeal: dealName.trim() ? { name: dealName.trim() } : {} } : { opportunityId: dealId }),
      ...(day !== defaultDay && endOfDay(day) ? { expiresAt: endOfDay(day) } : {}),
      ...(price ? { agreedPrice: price, currency } : {}),
      notes,
      ...(sales.version > 0 ? { expectedVersion: sales.version } : {}),
    };
    const failed = await request.send(`/api/project-units/${sales.unitId}/reservations`, body, `${sales.unitCode} is reserved.`);
    if (!failed) return onClose();
    // A similar client already exists: offer it back instead of creating a second (§16).
    if (isFailure(failed) && failed.code === "CONFLICT" && Array.isArray(failed.details)) {
      setDuplicates(failed.details as unknown as Duplicate[]);
      request.setError(null);
    }
  }

  return (
    <FormDialog open={open} onClose={onClose} title={`Reserve ${sales.unitCode}`} description="The unit is held for this client and deal until the expiry date. Only one reservation can be active on a unit." confirmLabel="Reserve" pending={request.pending} error={request.error} onSubmit={() => void reserve()} testId="reserve-dialog" wide dirty={changed && !request.done} unresolved={request.unresolved}>
      <fieldset className="space-y-2">
        <legend className="text-meta font-medium text-fg-muted">
          Client <span aria-hidden="true">*</span>
        </legend>
        {caps.canSeeClients && caps.canCreateClient ? (
          <div className="flex gap-1" role="group" aria-label="Client">
            {(["existing", "new"] as const).map((mode) => (
              <Button key={mode} type="button" size="sm" variant={clientMode === mode ? "primary" : "secondary"} aria-pressed={clientMode === mode} onClick={() => { setClientMode(mode); setDuplicates(null); }}>
                {mode === "existing" ? "Existing client" : <><UserPlus aria-hidden="true" /> New client</>}
              </Button>
            ))}
          </div>
        ) : null}

        {clientMode === "existing" ? (
          client ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface-muted px-3 py-2" data-testid="reserve-client">
              <span className="min-w-0 truncate text-table font-medium text-fg">
                {client.name}
                {client.code ? <span className="ml-2 text-meta text-fg-subtle">{client.code}</span> : null}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setClient(null)}>
                Change
              </Button>
            </div>
          ) : (
            <>
              <SearchField placeholder="Search clients" aria-label="Search clients" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
              <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-md border border-line" data-testid="reserve-client-results">
                {results === null ? (
                  <li className="px-3 py-2 text-table text-fg-muted">Searching…</li>
                ) : results.length === 0 ? (
                  <li className="px-3 py-2 text-table text-fg-muted">No client matches.{caps.canCreateClient ? " Create a new client instead." : ""}</li>
                ) : (
                  results.map((row) => (
                    <li key={row.id}>
                      <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-table hover:bg-hover" onClick={() => setClient(row)}>
                        <span className="truncate text-fg">{row.name}</span>
                        {row.code ? <span className="text-meta text-fg-subtle">{row.code}</span> : null}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </>
          )
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Client name" htmlFor="reserve-client-name" required className="sm:col-span-2" error={touched && clientMissing ? "Give the client's name." : request.fields["newClient.name"]}>
              <Input id="reserve-client-name" value={newClient.name} onChange={(event) => { setNewClient({ ...newClient, name: event.target.value }); setDuplicates(null); }} autoFocus maxLength={200} />
            </Field>
            <Field label="Type" htmlFor="reserve-client-type">
              <select id="reserve-client-type" className={selectClass} value={newClient.type} onChange={(event) => setNewClient({ ...newClient, type: event.target.value })}>
                <option value="INDIVIDUAL">Individual</option>
                <option value="COMPANY">Company</option>
              </select>
            </Field>
            <Field label="Phone" htmlFor="reserve-client-phone">
              <Input id="reserve-client-phone" type="tel" value={newClient.phone} onChange={(event) => setNewClient({ ...newClient, phone: event.target.value })} maxLength={40} />
            </Field>
            <Field label="Email" htmlFor="reserve-client-email" className="sm:col-span-2" error={request.fields["newClient.email"]}>
              <Input id="reserve-client-email" type="email" value={newClient.email} onChange={(event) => setNewClient({ ...newClient, email: event.target.value })} maxLength={254} />
            </Field>
          </div>
        )}
        {touched && clientMode === "existing" && !client ? <p className="text-meta text-danger-strong">Select a Client before reserving this Unit.</p> : null}
        {request.fields.clientId ? <p className="text-meta text-danger-strong">{request.fields.clientId}</p> : null}

        {duplicates?.length ? (
          <div className="space-y-2 rounded-md border border-warning/30 bg-warning-soft p-3" data-testid="reserve-duplicates" role="alert">
            <p className="text-table font-medium text-warning-strong">A similar client already exists. Use it rather than creating a second one?</p>
            <ul className="space-y-1">
              {duplicates.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2 text-table">
                  <span className="truncate text-fg">
                    {row.name}
                    {row.code ? <span className="ml-2 text-meta text-fg-subtle">{row.code}</span> : null}
                  </span>
                  <Button type="button" size="sm" variant="secondary" onClick={() => { setClientMode("existing"); setClient({ id: row.id, name: row.name, code: row.code }); setDuplicates(null); }}>
                    <Check aria-hidden="true" /> Use this client
                  </Button>
                </li>
              ))}
            </ul>
            <Button type="button" size="sm" variant="ghost" disabled={request.pending} onClick={() => void reserve(true)}>
              Create a new client anyway
            </Button>
          </div>
        ) : null}
      </fieldset>

      <Field label="Deal" htmlFor="reserve-deal" required error={touched && dealMissing ? "Create or select a Deal before reserving this Unit." : request.fields.opportunityId}>
        {clientMode === "existing" && caps.canSeeDeals ? (
          <select id="reserve-deal" className={cn(selectClass, !client && "opacity-60")} value={dealId} disabled={!client || deals === null} onChange={(event) => setDealId(event.target.value)}>
            {!client ? <option value="">Choose the client first</option> : deals === null ? <option value="">Loading deals…</option> : null}
            {deals?.map((deal) => (
              <option key={deal.id} value={deal.id}>
                {deal.name}
              </option>
            ))}
            {client && deals && caps.canCreateDeal ? <option value="new">New deal for this client</option> : null}
            {client && deals?.length === 0 && !caps.canCreateDeal ? <option value="">This client has no open deal</option> : null}
          </select>
        ) : (
          <p id="reserve-deal" className="text-table text-fg-muted">
            A new deal is opened for the new client.
          </p>
        )}
      </Field>
      {creatingDeal ? (
        <Field label="Deal name" htmlFor="reserve-deal-name" hint={`Left empty, it is named “${sales.unitCode} — client name”.`}>
          <Input id="reserve-deal-name" value={dealName} onChange={(event) => setDealName(event.target.value)} maxLength={200} />
        </Field>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem]">
        <Field label="Reserved until" htmlFor="reserve-expiry" required hint={`Default ${sales.defaults.reservationDays} days`} error={request.fields.expiresAt}>
          <Input id="reserve-expiry" type="date" value={day} min={dateValue(new Date())} onChange={(event) => setDay(event.target.value)} />
        </Field>
        <Field label="Agreed price" htmlFor="reserve-price" error={request.fields.agreedPrice}>
          <Input id="reserve-price" inputMode="decimal" value={price} onChange={(event) => setPrice(numberText(event.target.value))} />
        </Field>
        <Field label="Currency" htmlFor="reserve-currency" error={request.fields.currency}>
          <CurrencySelect id="reserve-currency" value={currency} onChange={setCurrency} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="reserve-notes" error={request.fields.notes}>
        <Textarea id="reserve-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={SALES_NOTES_MAX} />
      </Field>
    </FormDialog>
  );
}
