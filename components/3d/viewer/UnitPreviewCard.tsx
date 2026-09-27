"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import {
  Bath,
  BedDouble,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  ExternalLink,
  Heart,
  Home,
  Layers,
  Minimize2,
  Palette,
  Ruler,
  SquareStack,
  X,
} from "lucide-react";
import { PlaceholderImage } from "@/components/3d/viewer/shared/PlaceholderImage";
import { PublisherCard } from "@/components/3d/viewer/shared/PublisherCard";
import { useViewerStore } from "@/lib/3d/viewer/store";
import { usePriceFormat } from "@/components/3d/viewer/hooks/usePriceFormat";
import { useEffectiveReducedMotion } from "@/components/3d/viewer/hooks/useEffectiveReducedMotion";
import { useT } from "@/lib/3d/viewer/i18n";
import { cn } from "@/lib/3d/viewer/utils";
import Link from "@/components/navigation/nav-link";
import {
  DOCK_HEIGHT_DESKTOP,
  DOCK_HEIGHT_MOBILE_STANDARD,
} from "@/components/3d/viewer/viewer-hud/layoutState";
import type { Project, Unit, UnitOrientation } from "@/lib/3d/viewer/types";

const STATUS_LABEL_KEY: Record<Unit["status"], string> = {
  available: "unit.statusAvailable",
  reserved: "unit.statusReserved",
  sold: "unit.statusSold",
};

const TYPE_LABEL_KEY: Record<Unit["type"], string> = {
  residential: "unit.typeResidential",
  commercial: "unit.typeCommercial",
  parking: "unit.typeParking",
  storage: "unit.typeStorage",
};

const ORIENTATION_LABEL_KEY: Record<UnitOrientation, string> = {
  N: "unit.orientationN",
  E: "unit.orientationE",
  S: "unit.orientationS",
  W: "unit.orientationW",
};

const COMPACT_WIDTH_MOBILE = 256;
const COMPACT_WIDTH_DESKTOP = 288;
const EXPANDED_WIDTH = 384;

const EXPANDED_WIDTH_MIN = 268;

type CardMode = "compact" | "detail" | "exit";

const CHROME_GUTTER_MOBILE = 12;
const CHROME_GUTTER_DESKTOP = 16;

const PHOTO_COUNT = 3;

export function UnitPreviewCard({
  project,
  unit,
  expanded,
  retracted,
  floorSectionName,
  floorSectionActive,
  onViewInFloor,
  onExitFloor,
  exitFloorLabel,
  exitFloorTitle,
  onClose,
  onExpand,
  onCollapse,
}: {
  project: Project;
  unit: Unit | null;
  expanded: boolean;
  retracted: boolean;
  floorSectionName: string | null;
  floorSectionActive: boolean;
  onViewInFloor: () => void;
  onExitFloor: () => void;
  exitFloorLabel: string | null;
  exitFloorTitle: string | null;
  onClose: () => void;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const priceFmt = usePriceFormat();
  const { t } = useT();
  const reducedMotion = useEffectiveReducedMotion();
  const auth = useViewerStore((s) => s.auth);
  const saved = useViewerStore((s) => s.saved.projects.includes(project.id));
  const toggleSaved = useViewerStore((s) => s.toggleSavedProject);
  const compare = useViewerStore((s) => s.compare);
  const addCompare = useViewerStore((s) => s.addCompare);
  const removeCompareAt = useViewerStore((s) => s.removeCompareAt);
  const compareIndex = unit ? compare.findIndex((c) => c.kind === "unit" && c.entity.id === unit.id) : -1;
  const inCompare = compareIndex !== -1;
  const [designLeadSent, setDesignLeadSent] = useState(false);
  const eligibleForDesign = project.status === "under_construction" && unit?.type === "residential";

  const shellRef = useRef<HTMLDivElement>(null);
  const compactRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const exitRef = useRef<HTMLDivElement>(null);

  const [paneBoxes, setPaneBoxes] = useState({ compact: 0, detail: 0, exitW: 0, exitH: 0 });
  const [limits, setLimits] = useState({
    compactWidth: COMPACT_WIDTH_DESKTOP,
    maxWidth: EXPANDED_WIDTH,
    maxHeight: 560,
  });

  const measureLimits = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const { top } = shell.getBoundingClientRect();
    const narrow = window.innerWidth < 640;
    const gutter = narrow ? CHROME_GUTTER_MOBILE : CHROME_GUTTER_DESKTOP;
    const dock = document.querySelector<HTMLElement>("[data-viewer-dock]");
    const dockHeight =
      dock?.getBoundingClientRect().height ||
      (window.innerWidth < 1024 ? DOCK_HEIGHT_MOBILE_STANDARD + 2 : DOCK_HEIGHT_DESKTOP);
    const rail = document.querySelector<HTMLElement>("[data-viewer-floor-rail]");
    const railRight = rail ? rail.getBoundingClientRect().right : 0;
    const { right } = shell.getBoundingClientRect();
    const widthBudget = railRight > 0 ? right - railRight - gutter : window.innerWidth - gutter * 2;
    setLimits({
      compactWidth: Math.min(
        narrow ? COMPACT_WIDTH_MOBILE : COMPACT_WIDTH_DESKTOP,
        window.innerWidth - gutter * 2
      ),
      maxWidth: Math.min(EXPANDED_WIDTH, Math.max(EXPANDED_WIDTH_MIN, widthBudget)),
      maxHeight: Math.max(240, window.innerHeight - top - dockHeight - gutter * 2),
    });
  }, []);

  useLayoutEffect(() => {
    measureLimits();
    window.addEventListener("resize", measureLimits);
    const rail = document.querySelector<HTMLElement>("[data-viewer-floor-rail]");
    const observer = rail ? new ResizeObserver(measureLimits) : null;
    if (rail && observer) observer.observe(rail);
    return () => {
      window.removeEventListener("resize", measureLimits);
      observer?.disconnect();
    };
  }, [measureLimits]);

  useLayoutEffect(() => {
    const compact = compactRef.current;
    const detail = detailRef.current;
    const exit = exitRef.current;
    if (!compact || !detail || !exit) return;
    const sync = () =>
      setPaneBoxes((prev) => {
        const next = {
          compact: compact.offsetHeight,
          detail: detail.offsetHeight,
          exitW: exit.offsetWidth,
          exitH: exit.offsetHeight,
        };
        return prev.compact === next.compact &&
          prev.detail === next.detail &&
          prev.exitW === next.exitW &&
          prev.exitH === next.exitH
          ? prev
          : next;
      });
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(compact);
    observer.observe(detail);
    observer.observe(exit);
    return () => observer.disconnect();
  }, []);

  const compactWidth = limits.compactWidth;
  const mode: CardMode = retracted ? "exit" : expanded ? "detail" : "compact";
  const targetWidth =
    mode === "exit" ? paneBoxes.exitW : mode === "detail" ? limits.maxWidth : compactWidth;
  const targetHeight =
    mode === "exit"
      ? paneBoxes.exitH
      : mode === "detail"
        ? Math.min(paneBoxes.detail, limits.maxHeight)
        : paneBoxes.compact;

  const firstRun = useRef(true);
  const prevMode = useRef<CardMode>(mode);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const compact = compactRef.current;
    const detail = detailRef.current;
    const exit = exitRef.current;
    if (!shell || !compact || !detail || !exit || !targetHeight || !targetWidth) return;
    const panes: Record<CardMode, HTMLDivElement> = { compact, detail, exit };

    if (firstRun.current) {
      firstRun.current = false;
      gsap.set(shell, { width: targetWidth, height: targetHeight });
      (Object.keys(panes) as CardMode[]).forEach((m) =>
        gsap.set(panes[m], { autoAlpha: m === mode ? 1 : 0, scale: 1, y: 0 })
      );
      gsap.fromTo(
        shell,
        { autoAlpha: 0, y: -8, scale: 0.96 },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: reducedMotion ? 0.001 : 0.3,
          ease: "power3.out",
        }
      );
      return;
    }

    const from = prevMode.current;
    prevMode.current = mode;

    if (from === mode) {
      const settle = reducedMotion ? 0.001 : 0.2;
      const tween = gsap.timeline();
      tween.to(
        shell,
        { width: targetWidth, height: targetHeight, duration: settle, ease: "power2.out" },
        0
      );
      (Object.keys(panes) as CardMode[]).forEach((m) =>
        tween.to(
          panes[m],
          { autoAlpha: m === mode ? 1 : 0, scale: 1, y: 0, duration: settle, ease: "power2.out" },
          0
        )
      );
      return () => {
        tween.kill();
      };
    }

    const toExit = mode === "exit";
    const fromExit = from === "exit";
    const duration = reducedMotion ? 0.001 : toExit || fromExit ? 0.5 : 0.42;
    const outgoing = panes[from];
    const incoming = panes[mode];
    const timeline = gsap.timeline();
    timeline
      .to(shell, { width: targetWidth, height: targetHeight, duration, ease: "power3.inOut" }, 0)
      .to(
        outgoing,
        {
          autoAlpha: 0,
          scale: toExit ? 0.94 : 1,
          duration: duration * (toExit ? 0.42 : 0.5),
          ease: "power1.out",
        },
        0
      )
      .fromTo(
        incoming,
        { autoAlpha: 0, scale: toExit ? 0.82 : 1, y: toExit || fromExit ? 0 : mode === "detail" ? 10 : -6 },
        {
          autoAlpha: 1,
          scale: 1,
          y: 0,
          duration: duration * 0.85,
          ease: "power3.out",
        },
        duration * (toExit ? 0.3 : 0.15)
      );
    return () => {
      timeline.kill();
    };
  }, [mode, targetWidth, targetHeight, reducedMotion]);

  const exitingRef = useRef(false);
  const handleExitPress = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    const shell = shellRef.current;
    if (!shell || reducedMotion) {
      onExitFloor();
      return;
    }
    gsap.to(shell, {
      autoAlpha: 0,
      scale: 0.9,
      y: -6,
      duration: 0.22,
      ease: "power2.in",
      onComplete: onExitFloor,
    });
  }, [onExitFloor, reducedMotion]);

  useEffect(() => {
    if (!expanded) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCollapse();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [expanded, onCollapse]);

  const statusChip = (u: Unit) => (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
        u.status === "available" && "bg-emerald-400/15 text-emerald-300",
        u.status === "reserved" && "bg-amber-400/15 text-amber-300",
        u.status === "sold" && "bg-white/10 text-white/55"
      )}
    >
      {t(STATUS_LABEL_KEY[u.status])}
    </span>
  );

  const specRow = (u: Unit) => (
    <div className="flex items-center gap-2.5 text-[11px] text-white/55 sm:gap-3 sm:text-xs">
      <span className="flex items-center gap-1">
        <BedDouble className="h-3.5 w-3.5" /> {u.bedrooms}
      </span>
      <span className="flex items-center gap-1">
        <Bath className="h-3.5 w-3.5" /> {u.bathrooms}
      </span>
      <span className="flex items-center gap-1">
        <Ruler className="h-3.5 w-3.5" /> {u.area} m²
      </span>
      <span className="ml-auto">{statusChip(u)}</span>
    </div>
  );

  const closeButton = (
    <button
      onClick={onClose}
      aria-label={t("common.close")}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white"
    >
      <X className="h-4 w-4" />
    </button>
  );

  const saveButton = (className: string, withLabel: boolean) => (
    <button
      onClick={() => auth.signedIn && toggleSaved(project.id)}
      disabled={!auth.signedIn}
      aria-label={saved ? t("unit.savedProject") : t("unit.saveProject")}
      aria-pressed={saved}
      className={className}
    >
      <Heart className={cn("h-4 w-4 shrink-0", saved && "fill-red-500 text-red-500")} />
      {withLabel && (
        <span className="truncate">{saved ? t("unit.savedProject") : t("unit.saveProject")}</span>
      )}
    </button>
  );

  const compareButton = (u: Unit, className: string, withLabel: boolean) => (
    <button
      onClick={() =>
        inCompare
          ? removeCompareAt(compareIndex)
          : addCompare({
              kind: "unit",
              entity: u,
              projectName: project.name,
              projectSlug: project.slug,
            })
      }
      disabled={u.status === "sold"}
      aria-label={inCompare ? t("listing.inCompare") : t("nav.compare")}
      aria-pressed={inCompare}
      className={className}
    >
      {inCompare ? (
        <Check className="h-4 w-4 shrink-0" />
      ) : (
        <SquareStack className="h-4 w-4 shrink-0" />
      )}
      {withLabel && <span className="truncate">{inCompare ? t("listing.inCompare") : t("nav.compare")}</span>}
    </button>
  );

  const wideButtonClass =
    "flex flex-1 items-center justify-center gap-1.5 rounded-control border border-white/15 px-2.5 py-1.5 text-[11px] font-semibold text-white/85 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40";

  return (
    <div
      ref={shellRef}
      role={retracted ? undefined : "dialog"}
      aria-label={retracted ? undefined : unit?.code}
      className="viewer-glass absolute right-[max(0.75rem,env(safe-area-inset-right))] top-[calc(max(0.75rem,env(safe-area-inset-top))+3.75rem)] z-30 origin-top-right overflow-hidden rounded-panel shadow-[var(--shadow-2)] sm:right-4 sm:top-20"
      style={{ width: compactWidth }}
    >
      <div
        ref={compactRef}
        className="absolute right-0 top-0 origin-top-right p-3 sm:p-4"
        style={{ width: compactWidth }}
      >
        {unit && (
        <>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45 sm:text-[11px] sm:tracking-wide">
              {t("unit.floorLabel", { n: unit.floor })} · {unit.code}
            </p>
            <p className="font-numeric mt-0.5 text-[17px] font-semibold leading-tight text-white sm:text-xl sm:leading-normal">
              {priceFmt(unit.price, { currency: unit.currency })}
            </p>
          </div>
          <div className="-mr-1 -mt-0.5">{closeButton}</div>
        </div>

        <div className="mt-2 sm:mt-2.5">{specRow(unit)}</div>

        <div className="mt-3 flex items-center gap-1.5 border-t border-white/10 pt-3 sm:mt-3.5 sm:gap-2 sm:pt-3.5">
          {floorSectionName && (
            <button
              onClick={onViewInFloor}
              aria-pressed={floorSectionActive}
              title={t(floorSectionActive ? "unit.exitFloorViewTitle" : "unit.viewInFloorTitle", { n: unit.floor })}
              className={cn(
                "flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-control border text-[12px] font-semibold transition-colors sm:h-9 sm:gap-1.5 sm:text-[13px]",
                floorSectionActive
                  ? "border-brand-400/60 bg-brand-500/25 text-white"
                  : "border-white/15 bg-white/5 text-white/85 hover:bg-white/10 hover:text-white"
              )}
            >
              <Layers className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
              <span className="truncate">{t(floorSectionActive ? "unit.exitFloorView" : "unit.viewInFloor")}</span>
            </button>
          )}
          <button
            onClick={onExpand}
            className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-control bg-brand-500 text-[12px] font-semibold text-white transition-colors hover:bg-brand-600 sm:h-9 sm:gap-1.5 sm:text-[13px]"
          >
            <span className="truncate">{t("results.viewUnit")}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
          </button>
        </div>
        </>
        )}
      </div>

      <div
        ref={detailRef}
        className="absolute right-0 top-0 origin-top-right"
        style={{ width: limits.maxWidth }}
      >
        {unit && (
        <div className="flex flex-col" style={{ maxHeight: limits.maxHeight }}>
          <div className="shrink-0 border-b border-white/10 px-3.5 pb-2.5 pt-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-white/45">
                  {t("unit.floorLabel", { n: unit.floor })} · {unit.code}
                </p>
                <p className="font-numeric mt-0.5 text-lg font-semibold leading-tight text-white">
                  {priceFmt(unit.price, { currency: unit.currency })}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-white/45">{project.name}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={onCollapse}
                  aria-label={t("unit.collapseUnitDetail")}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <Minimize2 className="h-3.5 w-3.5" />
                </button>
                {closeButton}
              </div>
            </div>
            <div className="mt-2">{specRow(unit)}</div>
          </div>

          <div className="scroll-none min-h-0 flex-1 overflow-y-auto px-3.5 pb-3 pt-3">
            <UnitMedia key={unit.id} unit={unit} />

            <div className="mt-3 grid grid-cols-3 gap-1.5">
              <Fact icon={Home} label={t("unit.viewerBuilding")} value={unit.buildingName} />
              <Fact
                icon={Compass}
                label={t("unit.orientation")}
                value={
                  unit.orientation
                    ? t(ORIENTATION_LABEL_KEY[unit.orientation]).split(" ")[0]
                    : unit.orientationCode ?? "—"
                }
              />
              <Fact icon={SquareStack} label={t("unit.typeLabel")} value={t(TYPE_LABEL_KEY[unit.type])} />
            </div>

            {unit.href && (
              <Link
                href={unit.href}
                data-testid="project-3d-open-unit"
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-control bg-brand-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-600"
              >
                Open unit record
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}

            {eligibleForDesign && (
              <button
                onClick={() => setDesignLeadSent(true)}
                disabled={designLeadSent}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-control bg-listing-new-dev px-3 py-2 text-xs font-semibold text-white transition-[filter] hover:brightness-95 disabled:opacity-60"
              >
                <Palette className="h-3.5 w-3.5" />
                {designLeadSent ? t("unit.requestSent") : t("unit.designThisApartment")}
              </button>
            )}

            <div className="mt-3 border-t border-white/10 pt-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-white/45">
                {t("listing.contactPublisher")}
              </p>
              <PublisherCard
                bare
                tone="dark"
                compact
                publisher={project.developer}
                whatsappMessage={`Hi, I'm interested in unit ${unit.code} at ${project.name}`}
                contentTitle={`${project.name} — ${unit.code}`}
                contentUrl={`${typeof window === "undefined" ? "" : window.location.origin}/projects/${project.id}/3d?unit=${unit.id}`}
                trackEntity={{ type: "project", id: project.id }}
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t border-white/10 px-3.5 py-2.5">
            {saveButton(wideButtonClass, true)}
            {compareButton(
              unit,
              cn(
                wideButtonClass,
                inCompare && "border-brand-400/60 bg-brand-500/25 text-white hover:bg-brand-500/25"
              ),
              true
            )}
          </div>
        </div>
        )}
      </div>

      <div ref={exitRef} className="absolute right-0 top-0 w-max origin-top-right">
        <button
          type="button"
          onClick={handleExitPress}
          title={exitFloorTitle ?? undefined}
          className="flex h-12 items-center gap-1.5 whitespace-nowrap px-4 text-[13px] font-semibold text-white"
        >
          <Layers className="h-4 w-4 shrink-0 text-brand-300" />
          <span>{t("unit.exitFloorView")}</span>
          {exitFloorLabel && (
            <>
              <span className="text-white/45">·</span>
              <span className="text-white/60">{exitFloorLabel}</span>
            </>
          )}
          <X className="ml-0.5 h-4 w-4 shrink-0 text-white/45" />
        </button>
      </div>
    </div>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof BedDouble;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-card border border-white/10 bg-white/[0.03] px-2 py-1.5">
      <p className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-white/40">
        <Icon className="h-2.5 w-2.5 shrink-0" />
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-0.5 truncate text-[13px] font-semibold text-white">{value}</p>
    </div>
  );
}

type MediaTab = "photos" | "floorplan" | "facade" | "video";

function UnitMedia({ unit }: { unit: Unit }) {
  const { t } = useT();
  const [tab, setTab] = useState<MediaTab>("photos");
  const [index, setIndex] = useState(0);

  const tabs = useMemo(() => {
    const list: { key: MediaTab; label: string }[] = [
      { key: "photos", label: t("gallery.tabPhotos") },
      { key: "floorplan", label: t("gallery.tabFloorplan") },
    ];
    if (unit.facadeImage) list.push({ key: "facade", label: t("gallery.tabFacade") });
    if (unit.videoUrl) list.push({ key: "video", label: t("gallery.tabVideo") });
    return list;
  }, [t, unit.facadeImage, unit.videoUrl]);

  // NESTO units carry their own media; Rozaris' seeded placeholders stand in
  // only where a unit has none (or the reader may not open its files).
  const photoCount = unit.images.length || PHOTO_COUNT;
  const seeds = Array.from({ length: photoCount }, (_, i) => `${unit.id}-photo-${i}`);

  return (
    <div className="overflow-hidden rounded-card border border-white/10">
      <div className="relative aspect-[16/9] w-full bg-white/5">
        {tab === "photos" && (
          <>
            {unit.images[index] ? (
              <UnitImage src={unit.images[index]} />
            ) : (
              <PlaceholderImage
                seed={seeds[index]}
                kind="interior"
                className="h-full w-full"
                iconClassName="h-8 w-8"
                watermark
              />
            )}
            <button
              onClick={() => setIndex((i) => (i - 1 + photoCount) % photoCount)}
              aria-label={t("gallery.prevPhoto")}
              className="absolute left-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setIndex((i) => (i + 1) % photoCount)}
              aria-label={t("gallery.nextPhoto")}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
              {seeds.map((seed, i) => (
                <button
                  key={seed}
                  onClick={() => setIndex(i)}
                  aria-label={t("gallery.goToPhoto", { n: i + 1 })}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    i === index ? "w-4 bg-white" : "w-1.5 bg-white/60"
                  )}
                />
              ))}
            </div>
          </>
        )}
        {tab === "floorplan" && (
          unit.floorPlanImage ? (
            <UnitImage src={unit.floorPlanImage} contain />
          ) : (
            <PlaceholderImage
              seed={`${unit.id}-floorplan`}
              kind="floorplan"
              className="h-full w-full"
              iconClassName="h-8 w-8"
            />
          )
        )}
        {tab === "facade" && (
          <UnitImage src={unit.facadeImage!} />
        )}
        {tab === "video" && (
          <button
            type="button"
            aria-label={t("gallery.playVideo")}
            className="group h-full w-full cursor-pointer"
          >
            <PlaceholderImage
              seed={`${unit.id}-video`}
              kind="video"
              className="h-full w-full"
              iconClassName="h-10 w-10 transition-transform group-hover:scale-110"
            />
          </button>
        )}
      </div>
      <div className="flex gap-1 border-t border-white/10 p-1">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={cn(
              "truncate rounded-control px-2 py-1 text-[10px] font-semibold transition-colors",
              tab === key ? "bg-white/15 text-white" : "text-white/50 hover:bg-white/10 hover:text-white"
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function UnitImage({ src, contain = false }: { src: string; contain?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a signed-in thumbnail route, not an optimisable static asset
    <img src={src} alt="" className={cn("h-full w-full", contain ? "object-contain" : "object-cover")} loading="lazy" />
  );
}
