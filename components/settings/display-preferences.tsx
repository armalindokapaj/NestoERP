"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useTranslations } from "@/components/i18n/i18n-provider";
import {
  DENSITY_CHOICES,
  DENSITY_COOKIE,
  DESIGN_COOKIE,
  DESIGN_VERSIONS,
  RULER_CHOICES,
  RULER_COOKIE,
  densityAttribute,
  designAttribute,
  readDensityChoice,
  readRulerChoice,
  rulerAttribute,
  type DensityChoice,
  type DesignVersion,
  type RulerChoice,
} from "@/lib/layout/design-state";
import { cn } from "@/lib/utils/cn";

/**
 * Density, page ruler and design version (UI-02 §6.4, §15, §33).
 *
 * Written the way the colour scheme is (theme-preference.tsx): the choice goes
 * into a cookie and onto <html> at the same moment, so the change is immediate
 * here and already correct on the server for every later page. Shared by the
 * Appearance settings and the account panel, so both write the same way.
 */

function cookieValue(name: string): string | undefined {
  const entry = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
  return entry?.slice(name.length + 1);
}

/** Stores one preference for a year, and says whether the browser kept it (§15: an honest answer when it did not). */
function remember(name: string, value: string): boolean {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
  return cookieValue(name) === value;
}

function setAttribute(name: "ds" | "density" | "ruler", value: string | undefined) {
  const root = document.documentElement;
  if (value === undefined) delete root.dataset[name];
  else root.dataset[name] = value;
}

/** The version this document is in: the attribute the server rendered, or a switch made since. */
export function currentDesignVersion(): DesignVersion {
  return document.documentElement.dataset.ds === "2" ? "2" : "1";
}

export function applyDensityChoice(choice: DensityChoice): boolean {
  const saved = remember(DENSITY_COOKIE, choice);
  setAttribute("density", densityAttribute(choice, currentDesignVersion()));
  return saved;
}

export function applyRulerChoice(choice: RulerChoice): boolean {
  const saved = remember(RULER_COOKIE, choice);
  setAttribute("ruler", rulerAttribute(choice, false, currentDesignVersion()));
  return saved;
}

/**
 * The developer's switch between the two versions. Density and the ruler
 * belong to version 2 only, so their attributes come and go with the version.
 * (The kill switch is the server's to apply: the page is asked for again.)
 */
export function applyDesignVersion(version: DesignVersion): boolean {
  const saved = remember(DESIGN_COOKIE, version);
  setAttribute("ds", designAttribute(version));
  setAttribute("density", densityAttribute(readDensityChoice(cookieValue(DENSITY_COOKIE)), version));
  setAttribute("ruler", rulerAttribute(readRulerChoice(cookieValue(RULER_COOKIE)), false, version));
  return saved;
}

/** What the document shows now, for a control that opens after the page was rendered. */
export function readDisplayPreferences(): { design: DesignVersion; density: DensityChoice; ruler: RulerChoice } {
  if (typeof document === "undefined") return { design: "1", density: "comfortable", ruler: "auto" };
  const { density, ruler } = document.documentElement.dataset;
  return {
    design: currentDesignVersion(),
    density: density === "compact" ? "compact" : "comfortable",
    ruler: ruler === "off" ? "off" : "auto",
  };
}

const LOOK = {
  /* The Appearance settings: the segmented control the colour scheme uses there. */
  setting: {
    group: "inline-flex shrink-0 gap-0.5 rounded-lg border border-line bg-surface-muted p-0.5",
    option: "inline-flex items-center justify-center rounded-md px-2.5 py-1.5 text-table font-medium transition-colors touch:min-h-11 touch:min-w-11",
    selected: "bg-accent-soft text-accent-strong",
    idle: "text-fg-muted hover:text-fg",
  },
  /* The account panel: the one its Light / Dark choice uses, filling the column it is given. */
  panel: {
    group: "grid min-w-0 grid-flow-col auto-cols-fr gap-1 rounded-lg border border-line bg-surface-muted p-1",
    option:
      "flex min-h-9 min-w-0 cursor-pointer items-center justify-center rounded-md px-2 text-meta transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:min-h-11",
    selected: "bg-surface font-semibold text-fg shadow-sm ring-1 ring-accent",
    idle: "text-fg-muted hover:text-fg",
  },
} as const;

/**
 * One choice among a few, as a radio group (AUD-11 §3): one Tab stop — the
 * checked option — and the arrow keys move and select, wrapping at the ends.
 */
export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  look = "setting",
  testId,
  className,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
  look?: keyof typeof LOOK;
  /** Each option is `${testId}-${value}`. */
  testId?: string;
  className?: string;
}) {
  const styles = LOOK[look];

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const edge = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : undefined;
    if (step === undefined && edge === undefined) return;
    event.preventDefault();
    const current = options.findIndex((option) => option.value === value);
    const next = edge ?? (current + step! + options.length) % options.length;
    onChange(options[next].value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cn(styles.group, className)}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            data-testid={testId ? `${testId}-${option.value}` : undefined}
            className={cn(styles.option, selected ? styles.selected : styles.idle)}
          >
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A setting's row on the Appearance page: what it is, what it does, and the choice. */
function SettingRow({ title, hint, notSaved, children }: { title: string; hint: string; notSaved: string | null; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-card font-semibold text-fg">{title}</p>
        <p className="mt-1 text-table text-fg-muted">{hint}</p>
        {/* §15: said plainly when the browser kept nothing; the change still applies to this page. */}
        <p role="status" className="text-meta text-warning-strong [&:not(:empty)]:mt-1">{notSaved}</p>
      </div>
      {children}
    </div>
  );
}

export function DensityPreference({ initial }: { initial: DensityChoice }) {
  const t = useTranslations("settings");
  const [choice, setChoice] = React.useState(initial);
  const [saved, setSaved] = React.useState(true);

  return (
    <SettingRow title={t("appearance.density")} hint={t("appearance.densityChoiceHint")} notSaved={saved ? null : t("appearance.notSaved")}>
      <ChoiceGroup
        label={t("appearance.density")}
        value={choice}
        options={DENSITY_CHOICES.map((value) => ({ value, label: t(`appearance.densities.${value}`) }))}
        onChange={(next) => {
          setChoice(next);
          setSaved(applyDensityChoice(next));
        }}
        testId="density"
      />
    </SettingRow>
  );
}

export function RulerPreference({ initial }: { initial: RulerChoice }) {
  const t = useTranslations("settings");
  const [choice, setChoice] = React.useState(initial);
  const [saved, setSaved] = React.useState(true);

  return (
    <SettingRow title={t("appearance.ruler")} hint={t("appearance.rulerHint")} notSaved={saved ? null : t("appearance.notSaved")}>
      <ChoiceGroup
        label={t("appearance.ruler")}
        value={choice}
        options={RULER_CHOICES.map((value) => ({ value, label: t(`appearance.rulers.${value}`) }))}
        onChange={(next) => {
          setChoice(next);
          setSaved(applyRulerChoice(next));
        }}
        testId="ruler"
      />
    </SettingRow>
  );
}

/**
 * Classic / New: offered only where the server says the version is switchable
 * (a developer's machine with the release flag set). The page is refreshed
 * after the switch, because the server decides what a version shows.
 */
export function DesignPreference({ initial }: { initial: DesignVersion }) {
  const t = useTranslations("settings");
  const router = useRouter();
  const [version, setVersion] = React.useState(initial);
  const [saved, setSaved] = React.useState(true);

  return (
    <SettingRow title={t("appearance.design")} hint={t("appearance.designHint")} notSaved={saved ? null : t("appearance.notSaved")}>
      <ChoiceGroup
        label={t("appearance.design")}
        value={version}
        options={DESIGN_VERSIONS.map((value) => ({ value, label: t(`appearance.designs.${value}`) }))}
        onChange={(next) => {
          setVersion(next);
          const kept = applyDesignVersion(next);
          setSaved(kept);
          if (kept) router.refresh();
        }}
        testId="design"
      />
    </SettingRow>
  );
}
