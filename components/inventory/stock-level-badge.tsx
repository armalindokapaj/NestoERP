import { Badge } from "@/components/ui/badge";
import {
  stockLevelLabels,
  type StockLevel,
} from "@/lib/modules/inventory/inventory.status";
import { stockLevelTones } from "./inventory-format";

/**
 * How much of something is left, said in words (PRD #20 §167, §329).
 *
 * An item with no threshold set is never "low": the product does not invent a
 * number the company never chose, so it says so instead (PRD #20 §168).
 */
export function StockLevelBadge({ level }: { level: StockLevel }) {
  if (level === "NOT_TRACKED") return <span className="text-fg-subtle">—</span>;
  return <Badge tone={stockLevelTones[level]}>{stockLevelLabels[level]}</Badge>;
}
