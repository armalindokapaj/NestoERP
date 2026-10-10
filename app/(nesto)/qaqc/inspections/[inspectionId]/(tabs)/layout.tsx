import { InspectionPageShell, loadInspectionPage } from "../inspection-shell";

type Props = { children: React.ReactNode; params: Promise<{ inspectionId: string }> };

/** The inspection record's frame: header and tabs stay mounted while the tab content swaps. */
export default async function InspectionTabsLayout({ children, params }: Props) {
  const { inspectionId } = await params;
  const { context, inspection } = await loadInspectionPage(inspectionId, "overview");
  return (
    <InspectionPageShell context={context} inspection={inspection}>
      {children}
    </InspectionPageShell>
  );
}
