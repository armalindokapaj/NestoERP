import type { ProjectDetailModelSlotEntry } from "@/lib/3d/viewer/bootstrap-adapter";
import type { ConstructionTimelineDraft, Project, Project3DConfig, Unit } from "@/lib/3d/viewer/types";

export interface ProjectViewerRuntimeBootstrap {
  project: Project;
  construction: ConstructionTimelineDraft;
  detailModels: ProjectDetailModelSlotEntry[];
  viewerConfig: Project3DConfig;
  units: Unit[];
}

/** Rozaris serves a marketplace and a white-label channel; NESTO has the one Company channel. */
export type ViewerChannel = "company";
