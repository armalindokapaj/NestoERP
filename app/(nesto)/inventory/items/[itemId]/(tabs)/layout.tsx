import { ItemPageShell, loadItem } from "../item-shell";

type Props = { children: React.ReactNode; params: Promise<{ itemId: string }> };

/** The item record's frame: header and tabs stay mounted while the tab content swaps. */
export default async function ItemTabsLayout({ children, params }: Props) {
  const { itemId } = await params;
  const { item } = await loadItem(itemId);
  return <ItemPageShell item={item}>{children}</ItemPageShell>;
}
