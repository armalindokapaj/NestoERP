"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { UnsavedScope } from "@/components/unsaved/use-unsaved";
import { unsaved } from "@/lib/unsaved/coordinator";

/**
 * A dialog or drawer root that protects the editors inside it (AUD-03 §5).
 *
 * Every way Radix closes it — the X, Escape, the backdrop, a `DialogClose`
 * Cancel — arrives as `onOpenChange(false)`. Here that becomes a dismissal of
 * this dialog's scope: a clean dialog closes at once; one holding unsaved input
 * stays open, editor and values intact, while the person is asked. Only the
 * editors inside this dialog are in question — a nested dialog's close concerns
 * its own editors, the page's editors are not asked about at all.
 *
 * Uncontrolled dialogs are made controlled here, so a close can be refused.
 * A `locked` dialog — its request in flight — ignores closing altogether:
 * no question is asked whose Discard could not be carried out.
 */
export function GuardedRoot({
  open: openProp,
  defaultOpen,
  onOpenChange,
  locked = false,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & { locked?: boolean }) {
  const id = React.useId();
  const scope = `dialog:${id}`;
  const [innerOpen, setInnerOpen] = React.useState(defaultOpen ?? false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : innerOpen;
  const onOpenChangeRef = React.useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const lockedRef = React.useRef(locked);
  lockedRef.current = locked;

  const change = React.useCallback(
    (next: boolean) => {
      const apply = () => {
        if (!controlled) setInnerOpen(next);
        onOpenChangeRef.current?.(next);
      };
      if (next) {
        apply();
        return;
      }
      if (lockedRef.current) return;
      const intent = { kind: "dismiss", scope } as const;
      if (unsaved.isLeaving() || !unsaved.hasBlocking(intent)) {
        apply();
        return;
      }
      void unsaved.requestDeparture(intent).then((approval) => {
        approval?.run(apply);
      });
    },
    [controlled, scope],
  );

  const close = React.useCallback(() => change(false), [change]);

  return (
    <DismissContext.Provider value={close}>
    <UnsavedScope id={scope}>
      <DialogPrimitive.Root open={open} onOpenChange={change} {...props}>
        {children}
      </DialogPrimitive.Root>
    </UnsavedScope>
    </DismissContext.Provider>
  );
}

const DismissContext = React.createContext<(() => void) | null>(null);

/**
 * The guarded close of the dialog or drawer around the caller: for a Cancel
 * button that closes the dialog itself instead of through `DialogClose`. It
 * asks about the unsaved input inside, exactly like the X and Escape.
 */
export function useDialogClose(): () => void {
  const close = React.useContext(DismissContext);
  return close ?? (() => undefined);
}
