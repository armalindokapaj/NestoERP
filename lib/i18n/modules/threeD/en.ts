/**
 * The company 3D viewer's frame: its loading and error screens, the renderer's
 * fallbacks and the few HUD strings outside the viewer's own dictionary
 * (lib/3d/viewer/i18n.ts). Stored values' words live under `labels`.
 */
export const threeDEn = {
  labels: {
    placeholderKind: {
      interior: "interior",
      facade: "facade",
      floorplan: "floorplan",
      hero: "hero",
      avatar: "avatar",
      gallery: "gallery",
      video: "video",
    },
  },
  page: {
    opening: "Opening the 3D viewer",
    openFailed: "Could not open the 3D viewer.",
    releaseUnreadable: "The published 3D release could not be read.",
    noExperience: "No published 3D experience is available.",
    backToProject: "Back to project",
    tryAgain: "Try again",
    modelsFailed: "One or more published models could not be loaded.",
    modelAccessExpired: "The signed model access may have expired.",
    affected: "Affected: {models}",
    retry: "Retry",
    noLongerAvailable: "This 3D experience is no longer available.",
    updatedTitle: "A newer version of this 3D experience is available.",
    reload: "Reload",
    loginTitle: "Sign in to view this 3D experience",
    loginBody: "Only signed-in users with access to this company and project can view it.",
    signIn: "Sign in",
    unavailableTitle: "This 3D experience is not available",
    unavailableBody: "The link may have changed, or the experience is offline.",
    previewBadge: "Public preview",
  },
  renderer: {
    cannotDisplay: "This device can't display the 3D viewer.",
    interrupted: "The 3D view was interrupted by this device's graphics driver.",
    reload: "Reload",
  },
  hud: {
    backTo: "Back to {project}",
    rangeMinimum: "{label} minimum",
    rangeMaximum: "{label} maximum",
    placeholderImage: "{kind} placeholder image",
  },
};
