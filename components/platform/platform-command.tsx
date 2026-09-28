"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, ReasonDialog, type FormField } from "@/components/engineering/form-kit";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useRouter } from "@/components/navigation/guarded-router";
import { usePathname, useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui/toast";

type Props = {
  label: string;
  title: string;
  description?: string;
  action: string;
  fixed?: Record<string, unknown>;
  fields?: FormField[];
  initial?: Record<string, unknown>;
  submitLabel?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  success?: string;
  reasonOnly?: boolean;
  destructive?: boolean;
  /** Where to go once it succeeds; `{key}` is filled from the response (`/companies/{companyId}`). */
  redirectTo?: string;
  /** Opens on arrival when the address carries `?create=<this>` — the global Create's way in (Admin IA §19, §20). */
  openOnCreate?: string;
};

/**
 * Dialog state that starts open when `?create=<key>` names it, and drops the
 * parameter again once it closes so Back and refresh do not reopen it.
 */
export function useCreateParam(key: string | undefined): [boolean, (open: boolean) => void] {
  const params = useSearchParams();
  const pathname = usePathname();
  const requested = Boolean(key) && params.get("create") === key;
  const [open, setOpenState] = React.useState(requested);
  React.useEffect(() => { if (requested) setOpenState(true); }, [requested]);
  const setOpen = React.useCallback((next: boolean) => {
    setOpenState(next);
    if (!next && requested) {
      const rest = new URLSearchParams(params.toString());
      rest.delete("create");
      window.history.replaceState(null, "", rest.size ? `${pathname}?${rest}` : pathname);
    }
  }, [requested, params, pathname]);
  return [open, setOpen];
}

/** Blank fields are left out; the ids and action this button was built for come last, so no form field overrides them (AUD-09 §4). */
function clean(payload: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== null && value !== ""));
}

export function PlatformCommandButton({ label, title, description, action, fixed = {}, fields = [], initial, submitLabel = label, variant = "secondary", size = "sm", success = "Platform updated.", reasonOnly = false, destructive = false, redirectTo, openOnCreate }: Props) {
  const [open, setOpen] = useCreateParam(openOnCreate);
  const router = useRouter();
  const toast = useToast();

  async function submit(payload: Record<string, unknown>) {
    const result = await engineeringApi<({ pageRefresh?: "complete" | "pending" } & Record<string, unknown>) | undefined>("/api/platform-admin/command", { body: { ...clean(payload), action, ...fixed } });
    // A maintenance change is saved even when pages have not caught up yet (NAV-02 CACHE-02).
    toast(result?.pageRefresh === "pending" ? { title: "Setting saved. Page updates may take up to five seconds.", tone: "success" } : { title: success, tone: "success" });
    if (redirectTo) {
      router.push(redirectTo.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(String(result?.[key] ?? ""))));
      return;
    }
    router.refresh();
  }

  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>{label}</Button>
      {reasonOnly ? (
        <ReasonDialog open={open} onOpenChange={setOpen} title={title} description={description} confirmLabel={submitLabel} destructive={destructive} onConfirm={submit} />
      ) : (
        <FormDialog open={open} onOpenChange={setOpen} title={title} description={description} fields={fields} initial={initial} submitLabel={submitLabel} onSubmit={submit} wide={fields.length > 5} />
      )}
    </>
  );
}
