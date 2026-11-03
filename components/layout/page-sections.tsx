import type { ReactNode } from "react";

import { PageSectionsProvider, type PageTemplate, type PageUiContract } from "@/components/ui/page-sections";
import { ScrollRuler } from "@/components/ui/scroll-ruler";
import { getDesignState } from "@/lib/layout/design-server";

/**
 * A page's section registry and, where the page is eligible, its scroll ruler
 * (UI-02 §8, §26.3). A page mounts this once, around its content, and marks
 * each section's heading with `PageSection` (components/ui/page-sections.tsx).
 *
 * The scroll region is the document: in all three shells the page itself
 * scrolls, under the sticky top bar and breadcrumb bar.
 *
 * Version 2 only. In version 1 this renders its children and nothing else — no
 * provider, so every `PageSection` beneath it renders nothing either, and the
 * page's HTML is what it was (UI-02 §33).
 */
export async function PageSections({
  template,
  rulerPolicy = "eligible",
  children,
}: {
  template: PageTemplate;
  /** "never" keeps the registry and leaves the ruler out: a grid, a board, a viewer (§8.1). */
  rulerPolicy?: PageUiContract["rulerPolicy"];
  children: ReactNode;
}) {
  const { version } = await getDesignState();
  if (version !== "2") return <>{children}</>;
  return (
    <PageSectionsProvider template={template} rulerPolicy={rulerPolicy}>
      {rulerPolicy === "eligible" ? <ScrollRuler>{children}</ScrollRuler> : children}
    </PageSectionsProvider>
  );
}
