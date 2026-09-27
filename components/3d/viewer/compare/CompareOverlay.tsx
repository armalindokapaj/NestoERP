"use client";

import { Fragment } from "react";
import Link from "@/components/navigation/nav-link";
import { X, SquareStack } from "lucide-react";
import { useViewerStore } from "@/lib/3d/viewer/store";
import { PlaceholderImage } from "@/components/3d/viewer/shared/PlaceholderImage";
import { usePriceFormat } from "@/components/3d/viewer/hooks/usePriceFormat";
import { useT } from "@/lib/3d/viewer/i18n";
import {
  buildCompareRows,
  compareHref,
  compareImage,
  comparePrice,
  compareTitle,
} from "@/lib/3d/viewer/compare";

export function CompareOverlay() {
  const open = useViewerStore((s) => s.compareOverlayOpen);
  const setOpen = useViewerStore((s) => s.setCompareOverlayOpen);
  const compare = useViewerStore((s) => s.compare);
  const removeCompareAt = useViewerStore((s) => s.removeCompareAt);
  const priceFmt = usePriceFormat();
  const { t, locale } = useT();

  if (!open) return null;

  const hasTwo = compare.length === 2;
  const rows = hasTwo ? buildCompareRows([compare[0], compare[1]], locale) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center" role="dialog" aria-modal>
      <button
        aria-label={t("compare.closeComparison")}
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-[rgba(15,15,20,0.28)]"
      />
      <div className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-panel bg-white shadow-[var(--shadow-3)] lg:max-h-[85vh] lg:rounded-panel">
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-100 px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-neutral-900">
            <SquareStack className="h-4.5 w-4.5 text-brand-500" />
            {t("compare.title")}
          </h2>
          <button
            onClick={() => setOpen(false)}
            aria-label={t("common.close")}
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!hasTwo ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <SquareStack className="h-8 w-8 text-neutral-300" />
            <p className="text-sm font-medium text-neutral-700">
              {compare.length === 0 ? t("compare.hintNone") : t("compare.hintOne")}
            </p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto scroll-thin">
            <div className="grid grid-cols-[140px_1fr_1fr] lg:grid-cols-[180px_1fr_1fr]">
              <div className="sticky top-0 z-10 border-b border-neutral-100 bg-white p-3" />
              {compare.map((item, i) => (
                <div
                  key={i}
                  className="sticky top-0 z-10 border-b border-l border-neutral-100 bg-white p-3"
                >
                  <div className="relative">
                    <PlaceholderImage
                      seed={compareImage(item)}
                      kind="interior"
                      className="aspect-[4/3] w-full rounded-card"
                      watermark
                    />
                    <button
                      onClick={() => removeCompareAt(i)}
                      aria-label={t("compare.removeFromCompareShort")}
                      className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-neutral-600 shadow"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {compareHref(item) ? (
                    <Link
                      href={compareHref(item)!}
                      className="mt-2 block truncate text-sm font-semibold text-neutral-900 hover:text-brand-600"
                    >
                      {compareTitle(item)}
                    </Link>
                  ) : (
                    <p className="mt-2 block truncate text-sm font-semibold text-neutral-900">{compareTitle(item)}</p>
                  )}
                  <p className="text-sm font-bold text-brand-600">
                    {priceFmt(comparePrice(item).price, { currency: comparePrice(item).currency })}
                  </p>
                </div>
              ))}

              {rows.map((row) => (
                <Fragment key={row.label}>
                  <div className="border-b border-neutral-100 p-3 text-xs font-medium text-neutral-500">
                    {row.label}
                  </div>
                  <div className="border-b border-l border-neutral-100 p-3 text-sm text-neutral-800">
                    {row.values[0]}
                  </div>
                  <div className="border-b border-l border-neutral-100 p-3 text-sm text-neutral-800">
                    {row.values[1]}
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
