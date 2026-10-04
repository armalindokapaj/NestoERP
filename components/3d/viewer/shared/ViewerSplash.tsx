"use client";

import { useThreeDTranslations } from "@/components/3d/three-d-text";
import { ViewerLoadingMark } from "@/components/3d/viewer/shared/ViewerLoadingMark";

export type ViewerBrand = { name: string; logoUrl: string | null };

/** The viewer's loading screen: the owner's logo inside a turning ring, on NESTO's dark surface. */
export function ViewerSplash({ brand }: { brand: ViewerBrand }) {
  const t = useThreeDTranslations();
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface" role="status" aria-label={t("page.opening")}>
      <ViewerLoadingMark name={brand.name} logoUrl={brand.logoUrl} />
    </div>
  );
}
