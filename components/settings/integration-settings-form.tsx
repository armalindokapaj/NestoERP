"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { TriangleAlert } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { updateIntegrationSettingsAction } from "@/lib/actions/settings";
import type { IntegrationSettingsDTO } from "@/lib/modules/settings/integration-settings.service";

const TOGGLES = [
  { name: "qualityGateForInventoryReceipts", copy: "qualityGate" },
  { name: "autoCreateFinanceCommitmentFromApprovedPo", copy: "commitment" },
] as const;

/**
 * Integration toggles (PRD #24 §236).
 *
 * A blocked toggle is disabled and says why, rather than failing on submit
 * (PRD #24 §225). Turning one off changes future workflows only — records
 * already created are left exactly as they are (PRD #24 §83, §84).
 */
export function IntegrationSettingsForm({ settings }: { settings: IntegrationSettingsDTO }) {
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("settings");
  const formRef = React.useRef<HTMLFormElement>(null);
  // Under the unsaved-work contract (AUD-03 §3, §6).
  const save = useEditorSave({
    formRef,
    action: async (formData: FormData) => {
      const result = await updateIntegrationSettingsAction(formData);
      return result.ok ? result : { ok: false as const, error: result.message };
    },
    module: "settings",
    saveKind: "save",
    label: t("integrations.submit"),
    onCommitted: () => {
      toast({ title: t("integrations.updated"), tone: "success" });
      router.refresh();
    },
  });
  const { pending } = save;

  const blockerFor = (name: string) => settings.blockers.find((b) => b.key === name);

  return (
    <form ref={formRef} onSubmit={save.onSubmit} className="space-y-5">
      <SaveMessages save={save} />
      <fieldset disabled={pending || Boolean(save.saved)} className="m-0 min-w-0 border-0 p-0">
      <div className="nesto-card divide-y divide-line">
        {TOGGLES.map((toggle) => {
          const blocker = blockerFor(toggle.name);
          const disabled = !settings.capabilities.canUpdate || (Boolean(blocker) && !settings[toggle.name]);

          return (
            <div key={toggle.name} className="flex gap-3 px-5 py-4">
              <Checkbox
                id={toggle.name}
                name={toggle.name}
                defaultChecked={settings[toggle.name]}
                disabled={disabled}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <label htmlFor={toggle.name} className="text-table font-medium text-fg">
                  {t(`integrations.${toggle.copy}`)}
                </label>
                <p className="mt-0.5 text-meta text-fg-subtle">{t(`integrations.${toggle.copy}Hint`)}</p>
                {blocker ? (
                  <p className="mt-1.5 flex items-start gap-1.5 text-meta text-warning">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" />
                    <span>{blocker.message}</span>
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      </fieldset>

      {settings.capabilities.canUpdate ? (
        <div className="flex items-center justify-end gap-3">
          <UnsavedIndicator save={save} />
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("integrations.submit")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
