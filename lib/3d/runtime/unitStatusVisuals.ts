import type { Unit, UnitsConfig } from "@/lib/3d/runtime/types";

export const DEFAULT_UNIT_STATUS_VISUAL_CONFIG: Pick<
  UnitsConfig,
  "unitColorAvailable" | "unitColorReserved" | "unitColorSold" | "unitColorSelected"
> = {
  unitColorAvailable: "#22c55e",
  unitColorReserved: "#eab308",
  unitColorSold: "#ef4444",
  unitColorSelected: "#6b55f5",
};

export const UNIT_STATUS_LABELS: Record<Unit["status"], string> = {
  available: "Available",
  reserved: "Reserved",
  sold: "Sold",
};

function hexToNumber(hex: string): number {
  const parsed = parseInt(hex.replace("#", ""), 16);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function unitStatusColorHex(
  status: Unit["status"],
  config?: Partial<Pick<UnitsConfig, "unitColorAvailable" | "unitColorReserved" | "unitColorSold">>
): string {
  switch (status) {
    case "available":
      return config?.unitColorAvailable ?? DEFAULT_UNIT_STATUS_VISUAL_CONFIG.unitColorAvailable;
    case "reserved":
      return config?.unitColorReserved ?? DEFAULT_UNIT_STATUS_VISUAL_CONFIG.unitColorReserved;
    case "sold":
      return config?.unitColorSold ?? DEFAULT_UNIT_STATUS_VISUAL_CONFIG.unitColorSold;
    default:
      return DEFAULT_UNIT_STATUS_VISUAL_CONFIG.unitColorAvailable;
  }
}

export function unitStatusColorNumber(
  status: Unit["status"],
  config?: Partial<Pick<UnitsConfig, "unitColorAvailable" | "unitColorReserved" | "unitColorSold">>
): number {
  return hexToNumber(unitStatusColorHex(status, config));
}

export function unitSelectedOutlineColorNumber(config?: Partial<Pick<UnitsConfig, "unitColorSelected">>): number {
  return hexToNumber(config?.unitColorSelected ?? DEFAULT_UNIT_STATUS_VISUAL_CONFIG.unitColorSelected);
}

export function unitSelectedFillColorNumber(config?: Partial<Pick<UnitsConfig, "unitColorSelectedFill">>): number {
  return hexToNumber(config?.unitColorSelectedFill ?? DEFAULT_UNIT_STATUS_VISUAL_CONFIG.unitColorSelected);
}

