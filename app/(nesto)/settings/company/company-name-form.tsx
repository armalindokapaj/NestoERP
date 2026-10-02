"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { renameCompanyAction } from "@/lib/actions/settings";

/** The company's display name, editable by whoever holds company.name.update. */
export function CompanyNameForm({ name }: { name: string }) {
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("settings");
  const formRef = React.useRef<HTMLFormElement>(null);
  const save = useEditorSave({
    formRef,
    action: async (formData: FormData) => {
      const result = await renameCompanyAction(formData);
      return result.ok ? result : { ok: false as const, error: result.message };
    },
    module: "settings",
    saveKind: "save",
    label: t("company.name"),
    onCommitted: () => {
      toast({ title: t("company.nameUpdated"), tone: "success" });
      router.refresh();
    },
  });
  const { pending } = save;

  return (
    <form ref={formRef} onSubmit={save.onSubmit} className="space-y-3">
      <SaveMessages save={save} />
      <div className="space-y-1.5">
        <Label htmlFor="name">{t("company.name")}</Label>
        <div className="flex flex-wrap items-center gap-3">
          <Input id="name" name="name" defaultValue={name} required minLength={2} maxLength={120} className="max-w-md" disabled={pending} />
          <Button type="submit" disabled={pending}>{pending ? t("saving") : t("company.nameSave")}</Button>
          <UnsavedIndicator save={save} />
        </div>
      </div>
    </form>
  );
}
