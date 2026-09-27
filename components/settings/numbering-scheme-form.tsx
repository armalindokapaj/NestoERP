"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { updateNumberingSchemeAction } from "@/lib/actions/settings";
import type { NumberingSchemeDTO } from "@/lib/modules/settings/numbering.service";

const selectClass =
  "h-9 w-full rounded-md border border-line bg-surface px-2.5 text-table text-fg " +
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20 " +
  "disabled:cursor-not-allowed disabled:bg-surface-muted";

/**
 * One numbering scheme (PRD #24 §114-§119).
 *
 * The preview updates as the fields change, using the same pieces the server
 * formats with, so what is on screen is what the next record will be called.
 * It is only a preview: the number itself is allocated under a row lock at the
 * moment a record is created, never from here.
 *
 * Changing a scheme affects future records only. Numbers already issued do not
 * move, and the sequence is never rewound (PRD #24 §111, §117).
 */
export function NumberingSchemeForm({
  scheme,
  label,
}: {
  scheme: NumberingSchemeDTO;
  label: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("settings");
  const formRef = React.useRef<HTMLFormElement>(null);
  // One editor per scheme on the page (AUD-03 §3): leaving asks about each
  // one with unsaved changes, by its own name.
  const save = useEditorSave({
    formRef,
    action: async (formData: FormData) => {
      const result = await updateNumberingSchemeAction(formData);
      return result.ok ? result : { ok: false as const, error: result.message, fieldErrors: result.fieldErrors };
    },
    module: "settings",
    saveKind: "save",
    label,
    onCommitted: () => {
      toast({ title: t("numbering.updated", { label }), tone: "success" });
      router.refresh();
    },
  });
  const { pending } = save;

  const [mode, setMode] = React.useState(scheme.mode);
  const [prefix, setPrefix] = React.useState(scheme.prefix ?? "");
  const [separator, setSeparator] = React.useState(scheme.separator);
  const [yearMode, setYearMode] = React.useState(scheme.yearMode);
  const [padding, setPadding] = React.useState(String(scheme.padding));

  const preview = React.useMemo(() => {
    if (mode !== "AUTO") return t("numbering.manualPreview");
    const year = new Date().getUTCFullYear();
    const parts = [prefix || null];
    if (yearMode === "YYYY") parts.push(String(year));
    if (yearMode === "YY") parts.push(String(year).slice(-2));
    parts.push(String(scheme.nextSequence).padStart(Number(padding) || 1, "0"));
    return parts.filter(Boolean).join(separator);
  }, [mode, prefix, separator, yearMode, padding, scheme.nextSequence, t]);

  const id = `${scheme.moduleKey}-${scheme.entityType}`;
  const disabled = !scheme.canManage || pending || Boolean(save.saved);

  return (
    <form ref={formRef} onSubmit={save.onSubmit} className="space-y-3 px-5 py-4">
      <SaveMessages save={save} />
      <input type="hidden" name="moduleKey" value={scheme.moduleKey} />
      <input type="hidden" name="entityType" value={scheme.entityType} />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-table font-medium text-fg">{label}</h3>
        <p className="font-mono text-meta text-fg-muted">{preview}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <Label htmlFor={`${id}-mode`}>{t("numbering.mode")}</Label>
          <select
            id={`${id}-mode`}
            name="mode"
            className={selectClass}
            value={mode}
            disabled={disabled}
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
            <option value="AUTO">{t("numbering.automatic")}</option>
            <option value="MANUAL">{t("numbering.manual")}</option>
          </select>
        </div>

        <div>
          <Label htmlFor={`${id}-prefix`}>{t("numbering.prefix")}</Label>
          <Input
            id={`${id}-prefix`}
            name="prefix"
            value={prefix}
            maxLength={20}
            disabled={disabled || mode !== "AUTO"}
            onChange={(event) => setPrefix(event.target.value.toUpperCase())}
            placeholder="INV"
          />
        </div>

        <div>
          <Label htmlFor={`${id}-separator`}>{t("numbering.separator")}</Label>
          <Input
            id={`${id}-separator`}
            name="separator"
            value={separator}
            maxLength={1}
            disabled={disabled || mode !== "AUTO"}
            onChange={(event) => setSeparator(event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor={`${id}-yearMode`}>{t("numbering.year")}</Label>
          <select
            id={`${id}-yearMode`}
            name="yearMode"
            className={selectClass}
            value={yearMode}
            disabled={disabled || mode !== "AUTO"}
            onChange={(event) => setYearMode(event.target.value as typeof yearMode)}
          >
            <option value="NONE">{t("numbering.noYear")}</option>
            <option value="YYYY">2026</option>
            <option value="YY">26</option>
          </select>
        </div>

        <div>
          <Label htmlFor={`${id}-padding`}>{t("numbering.digits")}</Label>
          <Input
            id={`${id}-padding`}
            name="padding"
            type="number"
            inputMode="numeric"
            min={3}
            max={10}
            value={padding}
            disabled={disabled || mode !== "AUTO"}
            onChange={(event) => setPadding(event.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${id}-reset`}
            name="resetSequenceYearly"
            defaultChecked={scheme.resetSequenceYearly}
            disabled={disabled || mode !== "AUTO"}
          />
          <label htmlFor={`${id}-reset`} className="text-meta text-fg-muted">
            {t("numbering.resetYearly")}
          </label>
        </div>

        {scheme.canManage ? (
          <div className="flex items-center gap-3">
            <UnsavedIndicator save={save} />
            <Button type="submit" size="sm" variant="secondary" disabled={pending}>
              {pending ? t("saving") : t("save")}
            </Button>
          </div>
        ) : null}
      </div>
    </form>
  );
}
