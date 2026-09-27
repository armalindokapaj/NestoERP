import { translateViewer } from "@/lib/3d/viewer/i18n";
import type { CompareEntity } from "@/lib/3d/viewer/store";
import type { Locale } from "@/lib/3d/viewer/types";
import { formatPrice, transactionLabel } from "@/lib/3d/viewer/utils";

/*
 * Rozaris' comparison rows, for the one kind the Project viewer can add: a
 * unit. The listing-only rows (parking, furnishing, neighbourhood) have no
 * NESTO source and are left out rather than printed as dashes.
 */

export interface CompareRow {
  label: string;
  values: [string, string];
}

const DASH = "—";

export function compareTitle(item: CompareEntity): string {
  return `${item.projectName} · ${item.entity.code}`;
}

export function compareImage(item: CompareEntity): string {
  return `${item.projectSlug}-${item.entity.id}`;
}

/** Rozaris links to the listing; NESTO links to the canonical unit record, when the reader may open it. */
export function compareHref(item: CompareEntity): string | null {
  return item.entity.href;
}

export function comparePrice(item: CompareEntity) {
  return { price: item.entity.price, currency: item.entity.currency };
}

export function buildCompareRows(items: [CompareEntity, CompareEntity], locale: Locale): CompareRow[] {
  const [a, b] = items;
  const f = (key: string) => translateViewer(locale, `compareFields.${key}`);
  const onRequest = translateViewer(locale, "projectDetail.priceOnRequest");

  const field = (label: string, fn: (i: CompareEntity) => string | number | null | undefined): CompareRow => {
    const va = fn(a);
    const vb = fn(b);
    return {
      label,
      values: [
        va === null || va === undefined || va === "" ? DASH : String(va),
        vb === null || vb === undefined || vb === "" ? DASH : String(vb),
      ],
    };
  };

  return [
    field(f("price"), (i) => (i.entity.price == null ? onRequest : formatPrice(i.entity.price, i.entity.currency, { locale }))),
    field(f("pricePerSqm"), (i) =>
      i.entity.price == null || !i.entity.area ? null : formatPrice(Math.round(i.entity.price / i.entity.area), i.entity.currency, { locale })
    ),
    field(f("area"), (i) => `${i.entity.area} m²`),
    field(f("bedrooms"), (i) => i.entity.bedrooms),
    field(f("bathrooms"), (i) => i.entity.bathrooms),
    field(f("floor"), (i) => i.entity.floor),
    field(f("propertyType"), () => f("projectUnit")),
    field(f("transaction"), (i) => transactionLabel(i.entity.transaction, locale)),
    field(f("publisher"), (i) => i.projectName),
    field(f("availability"), (i) => (i.entity.status === "available" ? f("available") : i.entity.status)),
  ];
}
