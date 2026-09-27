import type { ActiveModule } from "./types";

export interface ViewerLayoutState {
  leftPanelOpen: boolean;
  unitsSheetOpen: boolean;
}

export function getViewerLayoutState(activeModule: ActiveModule, isDesktop: boolean, unitsListOpen: boolean): ViewerLayoutState {
  const listRequested = activeModule === "units" && unitsListOpen;
  return {
    leftPanelOpen: listRequested && isDesktop,
    unitsSheetOpen: listRequested && !isDesktop,
  };
}

export const DOCK_DIMENSIONS = {
  sunTime: { widthDesktop: 660 },
} as const;

export const DOCK_HEIGHT_DESKTOP = 62;

// 70, not 72: this is a min-height on the CONTENT div, and DockShell's own 1px
// top+bottom border adds the remaining 2px to reach the 72px shell target.
export const DOCK_HEIGHT_MOBILE_STANDARD = 70;

export const DOCK_MORPH_TIMING = {
  selectionFeedback: 0.06,
  navCollapse: 0.16,
  containerMorph: 0.3,
  contentRevealItem: 0.19,
  contentRevealStagger: 0.04,
  presetTween: 0.75,
  transitionLock: 0.35,
  popover: 0.16,
} as const;

export const DOCK_MORPH_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

// Literal rgba() strings, not var(--shadow-1): GSAP tweens boxShadow by
// interpolating numbers positionally, so both strings need the same token shape
// and a CSS custom property resolves to no numbers at all.
export const DOCK_MORPH_SHADOW = {
  rest: "0px 2px 8px 0px rgba(17, 17, 24, 0.06)",
  lifted: "0px 26px 60px 0px rgba(0, 0, 0, 0.55)",
} as const;
