"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { QuietHours } from "@/lib/core/notifications/push.quiet-hours";

const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const fromTime = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
};

/**
 * Quiet hours (MOB-10 §91-§94, §160). One row for the person, saved as they
 * change it. The critical-alert line is only shown while the override is on, so
 * the screen never promises more or less than the policy does.
 */
export function QuietHoursCard({ initial }: { initial: QuietHours }) {
  const t = useTranslations("settings");
  const toast = useToast();
  const [value, setValue] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);

  async function save(next: QuietHours) {
    const previous = value;
    setValue(next);
    setSaving(true);
    try {
      const response = await fetch("/api/notifications/quiet-hours", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error(String(response.status));
      toast({ title: t("notifications.quietHours.saved"), tone: "success" });
    } catch {
      setValue(previous);
      toast({ title: t("notifications.failed"), tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  // Turning quiet hours on uses this device's zone when the stored one is only a default.
  const deviceZone = () => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || value.timezone;
    } catch {
      return value.timezone;
    }
  };

  return (
    <section aria-labelledby="quiet-hours-title" className="nesto-card space-y-4 p-6" data-testid="quiet-hours">
      <div>
        <h2 id="quiet-hours-title" className="text-heading font-semibold text-fg">{t("notifications.quietHours.title")}</h2>
        <p className="text-table text-fg-muted">{t("notifications.quietHours.description")}</p>
      </div>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="quiet-enabled">{t("notifications.quietHours.enabled")}</Label>
        <Switch
          id="quiet-enabled"
          checked={value.enabled}
          disabled={saving}
          onCheckedChange={(enabled) => void save({ ...value, enabled, timezone: enabled ? deviceZone() : value.timezone })}
        />
      </div>
      {value.enabled ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="quiet-from">{t("notifications.quietHours.from")}</Label>
              <Input
                id="quiet-from"
                type="time"
                value={toTime(value.startMinute)}
                disabled={saving}
                onChange={(event) => {
                  const minutes = fromTime(event.target.value);
                  if (minutes !== null) void save({ ...value, startMinute: minutes });
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="quiet-until">{t("notifications.quietHours.until")}</Label>
              <Input
                id="quiet-until"
                type="time"
                value={toTime(value.endMinute)}
                disabled={saving}
                onChange={(event) => {
                  const minutes = fromTime(event.target.value);
                  if (minutes !== null) void save({ ...value, endMinute: minutes });
                }}
              />
            </div>
          </div>
          <p className="text-meta text-fg-subtle">{t("notifications.quietHours.timezone")}: {value.timezone}</p>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="quiet-critical">{t("notifications.quietHours.allowCritical")}</Label>
            <Switch id="quiet-critical" checked={value.allowCritical} disabled={saving} onCheckedChange={(allowCritical) => void save({ ...value, allowCritical })} />
          </div>
          {value.allowCritical ? <p className="text-meta text-fg-subtle">{t("notifications.quietHours.allowCriticalHint")}</p> : null}
        </>
      ) : null}
    </section>
  );
}
