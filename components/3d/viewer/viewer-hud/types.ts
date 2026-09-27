import { Building2, Clock, Compass, Image } from "lucide-react";

export type NavigationVisualState = "idle" | "hover" | "active";

export type ActiveModule = "none" | "explore" | "units" | "views" | "sunTime";

export const NAV_ITEMS: Exclude<ActiveModule, "none">[] = ["explore", "units", "views", "sunTime"];

export const MODULE_ICONS: Record<Exclude<ActiveModule, "none">, typeof Compass> = {
  explore: Compass,
  units: Building2,
  views: Image,
  sunTime: Clock,
};
