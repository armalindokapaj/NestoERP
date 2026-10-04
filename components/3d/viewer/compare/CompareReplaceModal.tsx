"use client";

import { useViewerStore } from "@/lib/3d/viewer/store";
import { PlaceholderImage } from "@/components/3d/viewer/shared/PlaceholderImage";
import { useT } from "@/lib/3d/viewer/i18n";
import { compareImage, compareTitle } from "@/lib/3d/viewer/compare";

export function CompareReplaceModal() {
  const candidate = useViewerStore((s) => s.compareReplaceCandidate);
  const compare = useViewerStore((s) => s.compare);
  const confirmReplace = useViewerStore((s) => s.confirmReplace);
  const cancelReplace = useViewerStore((s) => s.cancelReplace);
  const { t } = useT();

  if (!candidate) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="alertdialog" aria-modal>
      <button
        aria-label={t("common.cancel")}
        onClick={cancelReplace}
        className="absolute inset-0 bg-[rgba(15,15,20,0.28)]"
      />
      <div className="relative w-full max-w-sm rounded-panel bg-surface p-5 shadow-[var(--shadow-3)]">
        <h2 className="text-base font-bold text-fg">{t("compare.replaceTitle")}</h2>
        <p className="mt-1.5 text-sm text-fg-muted">
          {t("compare.replaceBody", { title: compareTitle(candidate) })}
        </p>
        <div className="mt-4 space-y-2">
          {compare.map((item, i) => (
            <button
              key={i}
              onClick={() => confirmReplace(i)}
              className="flex w-full items-center gap-3 rounded-card border border-line p-2.5 text-left hover:border-accent hover:bg-accent"
            >
              <PlaceholderImage
                seed={compareImage(item)}
                kind="interior"
                className="h-12 w-12 shrink-0 rounded-xl"
                iconClassName="h-4 w-4"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">
                  {compareTitle(item)}
                </span>
                <span className="text-xs text-accent-strong">{t("compare.replaceThis")}</span>
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={cancelReplace}
          className="mt-4 w-full rounded-control border border-line py-2.5 text-sm font-semibold text-fg-muted hover:bg-surface-muted"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
