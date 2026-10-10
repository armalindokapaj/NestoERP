import { WarehousePageShell, loadWarehouse } from "../warehouse-shell";

type Props = { children: React.ReactNode; params: Promise<{ warehouseId: string }> };

/** The warehouse record's frame: header and tabs stay mounted while the tab content swaps. */
export default async function WarehouseTabsLayout({ children, params }: Props) {
  const { warehouseId } = await params;
  const { warehouse } = await loadWarehouse(warehouseId);
  return <WarehousePageShell warehouse={warehouse}>{children}</WarehousePageShell>;
}
