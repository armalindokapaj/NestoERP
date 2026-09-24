"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, ReasonDialog, type FormField } from "@/components/engineering/form-kit";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useRouter } from "next/navigation";
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
};

function clean(payload: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== null && value !== ""));
}

export function PlatformCommandButton({ label, title, description, action, fixed = {}, fields = [], initial, submitLabel = label, variant = "secondary", size = "sm", success = "Platform updated.", reasonOnly = false, destructive = false }: Props) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const toast = useToast();

  async function submit(payload: Record<string, unknown>) {
    const result = await engineeringApi<{ pageRefresh?: "complete" | "pending" } | undefined>("/api/platform-admin/command", { body: { action, ...fixed, ...clean(payload) } });
    // A maintenance change is saved even when pages have not caught up yet (NAV-02 CACHE-02).
    toast(result?.pageRefresh === "pending" ? { title: "Setting saved. Page updates may take up to five seconds.", tone: "success" } : { title: success, tone: "success" });
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
