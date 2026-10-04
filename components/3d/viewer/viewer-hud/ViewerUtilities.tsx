"use client";

import { Camera, Expand, Minimize } from "lucide-react";
import { useT } from "@/lib/3d/viewer/i18n";
import { useIsDesktop } from "@/components/3d/viewer/hooks/useMediaQuery";
import { MoreMenu, type MoreMenuProjectInfo } from "./MoreMenu";

export function ViewerUtilities({
  screenshotEnabled,
  fullscreenEnabled,
  fullscreen,
  onToggleFullscreen,
  onScreenshot,
  project,
}: {
  screenshotEnabled: boolean;
  fullscreenEnabled: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onScreenshot: () => void;
  project: MoreMenuProjectInfo;
}) {
  const { t } = useT();
  const isDesktop = useIsDesktop();
  const showScreenshot = screenshotEnabled && isDesktop;
  const showFullscreen = fullscreenEnabled && isDesktop;

  return (
    <div className="viewer-glass relative flex h-12 shrink-0 items-stretch gap-0.5 rounded-panel p-0.5 text-fg">
      {showScreenshot && (
        <button
          type="button"
          onClick={onScreenshot}
          aria-label={t("project.screenshot")}
          title={t("project.screenshot")}
          className="flex w-11 items-center justify-center rounded-control transition-colors hover:bg-fg/10 hover:text-fg/70"
        >
          <Camera className="h-4 w-4" />
        </button>
      )}
      {showFullscreen && (
        <button
          type="button"
          onClick={onToggleFullscreen}
          aria-label={t("unit.viewerFullscreen")}
          title={t("unit.viewerFullscreen")}
          className="flex w-11 items-center justify-center rounded-control transition-colors hover:bg-fg/10 hover:text-fg/70"
        >
          {fullscreen ? <Minimize className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
        </button>
      )}
      {(showScreenshot || showFullscreen) && <span className="my-2 w-px shrink-0 bg-fg/10" aria-hidden="true" />}
      <MoreMenu project={project} />
    </div>
  );
}
