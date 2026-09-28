"use client";

import { Building2, Home, LayoutGrid, ImageIcon, User, PlayCircle } from "lucide-react";
import { useThreeDTranslations } from "@/components/3d/three-d-text";
import { threeDLabel } from "@/lib/i18n/modules/threeD/labels";
import { cn } from "@/lib/3d/viewer/utils";

const GRADIENTS: Array<[string, string]> = [
  ["#e9e5ff", "#c9c1ff"],
  ["#dcebff", "#b7d4ff"],
  ["#ffe9d6", "#ffd2a8"],
  ["#e3f3ea", "#bfe4cf"],
  ["#f3e3f0", "#e3bfe0"],
  ["#eef1ff", "#d3d9ff"],
];

function hash(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) - h + seed.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

type Kind = "interior" | "facade" | "floorplan" | "hero" | "avatar" | "gallery" | "video";

const ICONS: Record<Kind, typeof Home> = {
  interior: Home,
  facade: Building2,
  floorplan: LayoutGrid,
  hero: Building2,
  avatar: User,
  gallery: ImageIcon,
  video: PlayCircle,
};

export function PlaceholderImage({
  seed,
  kind = "interior",
  className,
  iconClassName,
  watermark = false,
}: {
  seed: string;
  kind?: Kind;
  className?: string;
  iconClassName?: string;
  watermark?: boolean;
}) {
  const t = useThreeDTranslations();
  const idx = hash(seed) % GRADIENTS.length;
  const [from, to] = GRADIENTS[idx];
  const angle = (hash(seed + "a") % 4) * 45;
  const Icon = ICONS[kind];

  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden",
        className
      )}
      style={{
        backgroundImage: `linear-gradient(${angle}deg, ${from}, ${to})`,
      }}
      role="img"
      aria-label={t("hud.placeholderImage", { kind: threeDLabel(t, "placeholderKind", kind, kind) })}
    >
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, #17162280 0, #17162280 1px, transparent 1px, transparent 14px)",
        }}
      />
      <Icon
        className={cn(
          "relative text-neutral-0/70",
          iconClassName ?? "h-8 w-8"
        )}
        strokeWidth={1.5}
      />
      {watermark && (
        <span
          aria-hidden
          className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[8px] bg-brand-500 text-xs font-bold text-white opacity-50"
        >
          R
        </span>
      )}
    </div>
  );
}
