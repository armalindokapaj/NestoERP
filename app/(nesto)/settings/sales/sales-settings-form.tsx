"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { failureMessage, structureApi } from "@/components/project-structure/structure-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import type { SalesSettingsDTO } from "@/lib/modules/settings/sales-settings.service";

const SOLD_RULES = ["RESERVATION", "SIGNED_CONTRACT", "DEPOSIT_RECEIVED", "SIGNED_CONTRACT_AND_DEPOSIT", "MANUAL_APPROVAL"] as const;

/**
 * Reservation length and the Sold rule for the company (E-05E §24; E-05F §42,
 * §43); the server validates and audits the change.
 */
export function SalesSettingsForm({ settings }: { settings: SalesSettingsDTO }) {
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("settings");
  const [days, setDays] = React.useState(String(settings.unitReservationDays));
  const [rule, setRule] = React.useState<string>(settings.unitSoldRule);
  const [error, setError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Said here in the reader's language; the server checks the same range again.
    if (!/^\d+$/.test(days.trim()) || Number(days) < 1 || Number(days) > 90) {
      setError(t("sales.reservationDaysInvalid"));
      return;
    }
    setPending(true);
    setError(null);
    setFormError(null);
    try {
      await structureApi("/api/settings/sales", { method: "PATCH", body: { unitReservationDays: days, unitSoldRule: rule } });
      toast({ title: t("sales.updated"), tone: "success" });
      router.refresh();
    } catch (caught) {
      setFormError(failureMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">{t("sales.reservationSection")}</h2>
        <p className="mt-1 text-meta text-fg-subtle">{t("sales.reservationSectionDescription")}</p>
        <div className="mt-4 max-w-xs space-y-1.5">
          <Label htmlFor="unitReservationDays">{t("sales.reservationDays")}</Label>
          <Input id="unitReservationDays" name="unitReservationDays" type="number" inputMode="numeric" min={1} max={90} step={1} value={days} onChange={(event) => setDays(event.target.value)} disabled={!settings.canUpdate} aria-invalid={Boolean(error)} aria-describedby="unitReservationDays-help" />
          <p id="unitReservationDays-help" className={error ? "text-meta text-danger-strong" : "text-meta text-fg-subtle"} role={error ? "alert" : undefined}>
            {error ?? t("sales.reservationDaysHint")}
          </p>
        </div>
      </section>
      <section className="nesto-card p-5">
        <fieldset>
          <legend className="text-card font-semibold text-fg">{t("sales.soldRuleSection")}</legend>
          <p className="mt-1 text-meta text-fg-subtle">{t("sales.soldRuleSectionDescription")}</p>
          <div className="mt-4 space-y-2" role="radiogroup" data-testid="sold-rule">
            {SOLD_RULES.map((key) => (
              <label key={key} htmlFor={`sold-rule-${key}`} className="flex cursor-pointer items-start gap-3 rounded-md border border-line p-3 has-[:checked]:border-accent has-[:disabled]:cursor-default">
                <input id={`sold-rule-${key}`} type="radio" name="unitSoldRule" value={key} checked={rule === key} onChange={() => setRule(key)} disabled={!settings.canUpdate} className="mt-1 accent-[var(--color-accent)]" />
                <span>
                  <span className="block text-table font-medium text-fg">{t(`sales.soldRules.${key}.label`)}</span>
                  <span className="block text-meta text-fg-subtle">{t(`sales.soldRules.${key}.description`)}</span>
                  {settings.unavailableRules.includes(key) ? <span className="mt-1 block text-meta text-warning-strong">{t("sales.soldRuleUnavailable")}</span> : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>
      {formError ? (
        <p className="text-table text-danger-strong" role="alert">
          {formError}
        </p>
      ) : null}
      {settings.canUpdate ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {t("sales.submit")}
          </Button>
        </div>
      ) : (
        <p className="text-table text-fg-muted">{t("sales.readOnly")}</p>
      )}
    </form>
  );
}
