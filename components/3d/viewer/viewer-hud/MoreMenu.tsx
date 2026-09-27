"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { gsap } from "gsap";
import {
  ArrowLeft,
  BadgeCheck,
  ChevronDown,
  Copy,
  ExternalLink,
  Hand,
  Info,
  Mail,
  MessageCircle,
  MoreHorizontal,
  MousePointerClick,
  RotateCcw,
  Settings as SettingsIcon,
  Share2,
  ZoomIn,
} from "lucide-react";
import { useT } from "@/lib/3d/viewer/i18n";
import { useIsDesktop } from "@/components/3d/viewer/hooks/useMediaQuery";
import { useClickOutside } from "@/components/3d/viewer/hooks/useClickOutside";
import { useEffectiveReducedMotion } from "@/components/3d/viewer/hooks/useEffectiveReducedMotion";
import { useViewerStore } from "@/lib/3d/viewer/store";
import { useViewerPreferences } from "@/components/3d/viewer/hooks/useViewerPreferences";
import { VIEWER_QUALITY_LEVELS, type ViewerQualityLevel } from "@/lib/3d/viewer/viewerQuality";
import { cn } from "@/lib/3d/viewer/utils";
import type { Currency, Locale, PropertyType } from "@/lib/3d/viewer/types";

type MoreSection = "none" | "projectInformation" | "share" | "settings" | "help";

export interface MoreMenuProjectInfo {
  slug: string;
  name: string;
  developerName: string;
  developerVerified: boolean;
  city: string;
  propertyType: PropertyType;
  completionLabel: string;
  /** NESTO: the canonical project page, which also is where Back returns to. */
  backHref: string;
}

export function MoreMenu({ project }: { project: MoreMenuProjectInfo }) {
  const { t } = useT();
  const isDesktop = useIsDesktop();
  const reducedMotion = useEffectiveReducedMotion();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<MoreSection>("none");
  const [linkCopied, setLinkCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const textPrimary = isDesktop ? "text-sm" : "text-[13px]";
  const textSecondary = isDesktop ? "text-xs" : "text-[11px]";

  const locale = useViewerStore((s) => s.locale);
  const setLocale = useViewerStore((s) => s.setLocale);
  const currency = useViewerStore((s) => s.currency);
  const setCurrency = useViewerStore((s) => s.setCurrency);
  const {
    areaUnit,
    reducedMotionOverride,
    interfaceAutoHide,
    quality,
    setAreaUnit,
    setReducedMotionOverride,
    setInterfaceAutoHide,
    setQuality,
    reset,
  } = useViewerPreferences();

  function closeAll() {
    setOpen(false);
    setSection("none");
  }

  useClickOutside(rootRef, closeAll, open);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeAll();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    gsap.to(el, {
      autoAlpha: open ? 1 : 0,
      y: open ? 0 : -6,
      duration: reducedMotion ? 0 : 0.18,
      ease: open ? "power2.out" : "power1.in",
    });
  }, [open, reducedMotion]);

  const projectPageHref = project.backHref;
  const shareUrl = typeof window !== "undefined" ? window.location.href : "";

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
    }
  }

  const menuItems: { id: Exclude<MoreSection, "none">; icon: typeof Info; label: string }[] = [
    { id: "projectInformation", icon: Info, label: t("more.projectInformation") },
    { id: "share", icon: Share2, label: t("more.share") },
    { id: "settings", icon: SettingsIcon, label: t("more.settings") },
    { id: "help", icon: Hand, label: t("more.help") },
  ];

  const sectionTitle = section === "none" ? "" : t(`more.${section}`);

  const body = (
    <div className="max-h-[70vh] overflow-y-auto p-1.5">
      {section !== "none" && (
        <button
          type="button"
          onClick={() => setSection("none")}
          className={cn(
            "mb-1 flex w-full items-center gap-1.5 rounded-control px-2.5 py-2 font-semibold uppercase tracking-[0.12em] text-white/60 hover:bg-white/5 hover:text-white",
            textSecondary
          )}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {sectionTitle}
        </button>
      )}

      {section === "none" && (
        <div role="menu" className="space-y-0.5">
          {menuItems.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              onClick={() => setSection(id)}
              className={cn(
                "flex h-11 w-full items-center gap-2.5 rounded-control px-2 font-medium text-white transition-colors hover:bg-white/10",
                textPrimary
              )}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-white/5">
                <Icon className="h-4 w-4 text-white/70" aria-hidden="true" />
              </span>
              {label}
            </button>
          ))}
        </div>
      )}

      {section === "projectInformation" && (
        <div className="space-y-3 px-2.5 py-1.5">
          <div>
            <p className={cn("font-semibold text-white", textPrimary)}>{project.name}</p>
            <p className={cn("mt-0.5 flex items-center gap-1 text-white/60", textSecondary)}>
              {project.developerName}
              {project.developerVerified && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-brand-400" aria-label={t("more.verified")} />}
            </p>
          </div>
          {project.city && <p className={cn("text-white/60", textSecondary)}>{project.city}</p>}
          <p className={cn("text-white/60", textSecondary)}>{t(`more.propertyType.${project.propertyType}`)}</p>
          {project.completionLabel && (
            <p className={cn("text-white/60", textSecondary)}>
              {t("more.completion")}: {project.completionLabel}
            </p>
          )}
          <Link
            href={projectPageHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeAll}
            className={cn(
              "flex h-9 w-full items-center justify-center gap-1.5 rounded-control bg-brand-500 font-semibold text-white hover:bg-brand-400",
              textSecondary
            )}
          >
            {t("more.viewProjectPage")}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      )}

      {section === "share" && (
        <div className="space-y-1 px-1 py-1">
          <button
            type="button"
            onClick={handleCopyLink}
            className={cn("flex h-10 w-full items-center gap-3 rounded-control px-2.5 font-medium text-white hover:bg-white/10", textPrimary)}
          >
            <Copy className="h-4 w-4 text-white/60" aria-hidden="true" />
            {linkCopied ? t("more.linkCopied") : t("more.copyLink")}
          </button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareUrl)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeAll}
            className={cn("flex h-10 w-full items-center gap-3 rounded-control px-2.5 font-medium text-white hover:bg-white/10", textPrimary)}
          >
            <MessageCircle className="h-4 w-4 text-white/60" aria-hidden="true" />
            {t("more.shareWhatsApp")}
          </a>
          <a
            href={`mailto:?body=${encodeURIComponent(shareUrl)}`}
            onClick={closeAll}
            className={cn("flex h-10 w-full items-center gap-3 rounded-control px-2.5 font-medium text-white hover:bg-white/10", textPrimary)}
          >
            <Mail className="h-4 w-4 text-white/60" aria-hidden="true" />
            {t("more.shareEmail")}
          </a>
        </div>
      )}

      {section === "settings" && (
        <div className="space-y-3 px-2.5 py-1.5">
          <QualitySetting value={quality} onChange={setQuality} reducedMotion={reducedMotion} textSecondary={textSecondary} />

          <SettingsRow label={t("more.settingsLanguage")}>
            <SegmentedToggle
              value={locale}
              options={[
                { value: "en", label: "EN" },
                { value: "sq", label: "SQ" },
              ]}
              onChange={(v) => setLocale(v as Locale)}
            />
          </SettingsRow>

          <SettingsRow label={t("more.settingsAreaUnits")}>
            <SegmentedToggle
              value={areaUnit}
              options={[
                { value: "m2", label: "m²" },
                { value: "ft2", label: "ft²" },
              ]}
              onChange={(v) => setAreaUnit(v as "m2" | "ft2")}
            />
          </SettingsRow>

          <SettingsRow label={t("more.settingsCurrency")}>
            <SegmentedToggle
              value={currency}
              options={[
                { value: "EUR", label: "EUR" },
                { value: "ALL", label: "ALL" },
              ]}
              onChange={(v) => setCurrency(v as Currency)}
            />
          </SettingsRow>

          <SettingsRow label={t("more.settingsReducedMotion")}>
            <ToggleButton
              on={reducedMotionOverride === true}
              onLabel={t("more.on")}
              offLabel={t("more.off")}
              onToggle={(v) => setReducedMotionOverride(v ? true : null)}
            />
          </SettingsRow>

          <SettingsRow label={t("more.settingsAutoHide")}>
            <ToggleButton on={interfaceAutoHide} onLabel={t("more.on")} offLabel={t("more.off")} onToggle={setInterfaceAutoHide} />
          </SettingsRow>

          <button
            type="button"
            onClick={reset}
            className={cn(
              "flex h-9 w-full items-center justify-center gap-1.5 rounded-control border border-white/10 font-medium text-white/70 hover:bg-white/5 hover:text-white",
              textSecondary
            )}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            {t("more.settingsReset")}
          </button>
        </div>
      )}

      {section === "help" && (
        <div className="space-y-2.5 px-2.5 py-1.5">
          <HelpRow icon={isDesktop ? Hand : Hand} gesture={t(isDesktop ? "more.helpDrag" : "more.helpSwipe")} action={t("more.helpDragAction")} />
          <HelpRow icon={ZoomIn} gesture={t("more.helpScroll")} action={t("more.helpZoomAction")} />
          <HelpRow
            icon={MousePointerClick}
            gesture={t(isDesktop ? "more.helpClick" : "more.helpTap")}
            action={t("more.helpSelectAction")}
          />
        </div>
      )}
    </div>
  );

  return (
    <div ref={rootRef} className="relative flex self-stretch">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setSection("none");
        }}
        aria-label={t("viewer.more")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("viewer.more")}
        className={cn(
          "flex w-11 items-center justify-center rounded-control transition-colors",
          open ? "bg-white/10 text-white" : "hover:bg-white/10 hover:text-white/70"
        )}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      <div
        ref={panelRef}
        role="dialog"
        aria-hidden={!open}
        className={cn(
          "viewer-glass invisible absolute right-0 top-[calc(100%+8px)] overflow-hidden rounded-panel opacity-0 shadow-[var(--shadow-2)]",
          isDesktop ? "w-64" : "w-48",
          open ? "pointer-events-auto" : "pointer-events-none"
        )}
      >
        {body}
      </div>
    </div>
  );
}

function QualitySetting({
  value,
  onChange,
  reducedMotion,
  textSecondary,
}: {
  value: ViewerQualityLevel;
  onChange: (level: ViewerQualityLevel) => void;
  reducedMotion: boolean;
  textSecondary: string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    gsap.to(el, {
      height: open ? "auto" : 0,
      autoAlpha: open ? 1 : 0,
      duration: reducedMotion ? 0 : 0.2,
      ease: open ? "power2.out" : "power1.in",
    });
  }, [open, reducedMotion]);

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls="viewer-quality-options"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className={cn("text-white/70", textSecondary)}>{t("more.settingsQuality")}</span>
        <span
          className={cn(
            "flex h-7 shrink-0 items-center gap-1 rounded-pill px-2.5 text-[10px] font-semibold uppercase tracking-wide transition-colors",
            open ? "bg-white/20 text-white" : "bg-white/10 text-white/80"
          )}
        >
          {t(`more.quality.${value}`)}
          <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </span>
      </button>
      <div ref={listRef} id="viewer-quality-options" className="invisible h-0 overflow-hidden opacity-0">
        <div
          role="radiogroup"
          aria-label={t("more.settingsQuality")}
          className="mt-1.5 space-y-0.5 rounded-control bg-white/10 p-0.5"
        >
          {VIEWER_QUALITY_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={value === level}
              onClick={() => {
                onChange(level);
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className={cn(
                "flex h-8 w-full items-center rounded-pill px-2.5 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                value === level ? "bg-brand-500 text-white" : "text-white/60 hover:bg-white/10 hover:text-white"
              )}
            >
              <span className="truncate">{t(`more.quality.${level}`)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  const isDesktop = useIsDesktop();
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={cn("text-white/70", isDesktop ? "text-xs" : "text-[11px]")}>{label}</span>
      {children}
    </div>
  );
}

function ToggleButton({
  on,
  onLabel,
  offLabel,
  onToggle,
}: {
  on: boolean;
  onLabel: string;
  offLabel: string;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onToggle(!on)}
      className={cn(
        "flex h-7 w-16 items-center rounded-pill px-1 text-[10px] font-semibold uppercase tracking-wide transition-colors",
        on ? "justify-end bg-brand-500 text-white" : "justify-start bg-white/10 text-white/60"
      )}
    >
      <span className="rounded-pill bg-black/20 px-1.5 py-0.5">{on ? onLabel : offLabel}</span>
    </button>
  );
}

function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex h-7 items-center gap-0.5 rounded-pill bg-white/10 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={cn(
            "rounded-pill px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors",
            value === opt.value ? "bg-brand-500 text-white" : "text-white/60 hover:text-white"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function HelpRow({ icon: Icon, gesture, action }: { icon: typeof Hand; gesture: string; action: string }) {
  const isDesktop = useIsDesktop();
  return (
    <div className={cn("flex items-center justify-between rounded-control bg-white/[0.03] px-3 py-2", isDesktop ? "text-xs" : "text-[11px]")}>
      <span className="flex items-center gap-2 text-white/70">
        <Icon className="h-3.5 w-3.5 text-white/40" aria-hidden="true" />
        {gesture}
      </span>
      <span className="font-medium text-white">{action}</span>
    </div>
  );
}
