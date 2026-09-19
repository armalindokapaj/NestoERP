/**
 * Client-safe Platform 3D contract boundary.
 *
 * Platform editor components may import from here and from `lib/3d/runtime`.
 * Company viewer code must never import this module or `lib/modules/project-3d`.
 */
export const PROJECT_3D_PLATFORM_API_ROOT = "/api/platform/3d" as const;

