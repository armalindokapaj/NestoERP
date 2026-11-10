"use client";

import * as React from "react";

import { useLocale, useTranslations } from "@/components/i18n/i18n-provider";
import { moneyLabel, perSqmLabel } from "@/components/sales/unit-sales/commercial-status";
import { formatDateTime } from "@/lib/i18n/format";
import { unitTypeName } from "@/lib/i18n/stock-names";
import type { MessageKey } from "@/lib/i18n/translator";
import type { SheetField, SheetPriceDTO, SheetSkipDTO } from "@/lib/modules/unit-sheet/unit-sheet.types";
import { areaText } from "../structure-ui";

/**
 * How the Google Sheet's screens word a field, a value and a reason
 * (2026-11-10): the same words, m² and money as the rest of the Units tab.
 * Values arrive as the server's canonical strings ("64.72", "2", "NE", a type
 * id, "130000.00"); `null` is an empty cell.
 */

const AREA_FIELDS = new Set<SheetField>(["internalArea", "balconyArea", "terraceArea", "commonAreaAllocation", "grossArea", "saleableArea", "outdoorArea", "gardenArea"]);
const COUNT_FIELDS = new Set<SheetField>(["bedrooms", "bathrooms", "storage"]);

export type SheetWords = ReturnType<typeof useSheetWords>;

export function useSheetWords(unitTypes: ReadonlyArray<{ id: string; name: string }> = []) {
  const t = useTranslations("projects");
  const locale = useLocale();
  return React.useMemo(() => {
    const types = new Map(unitTypes.map((type) => [type.id, type.name]));
    const fieldLabel = (field: SheetField): string => {
      if (AREA_FIELDS.has(field)) return t(`area.${field}` as MessageKey<"projects">);
      if (COUNT_FIELDS.has(field)) return t(`count.${field}` as MessageKey<"projects">);
      return t(`unitSheet.field.${field}` as MessageKey<"projects">);
    };
    const empty = t("unitSheet.sync.empty");
    const price = (value: SheetPriceDTO | null, plain: string | null, currency: string | null): string => {
      const total = value ? value.total : plain;
      if (total === null) return empty;
      const money = moneyLabel(total, currency, locale);
      if (value?.entry === "PER_SQM" && value.rate !== null && value.area !== null) {
        return `${money} (${t("unitSheet.sync.perSqm", { rate: perSqmLabel(value.rate, currency, locale).replace(/\/m²$/, ""), area: areaText(value.area, locale) })})`;
      }
      return money;
    };
    /** One value as the Units tab writes it; a price with its rate when the sheet gave one. */
    const value = (field: SheetField, raw: string | null, options: { price?: SheetPriceDTO | null; currency?: string | null } = {}): string => {
      if (field === "price") return price(options.price ?? null, raw, options.currency ?? null);
      if (raw === null) return empty;
      if (AREA_FIELDS.has(field)) return areaText(raw, locale);
      if (field === "orientation") return t(`orientation.${raw}` as MessageKey<"projects">);
      if (field === "type") {
        const name = types.get(raw);
        return name ? unitTypeName(name, locale) : raw;
      }
      return raw;
    };
    const reason = (skip: Pick<SheetSkipDTO, "reason" | "message">): string => {
      const key = `unitSheet.reason.${skip.reason}` as MessageKey<"projects">;
      const text = t(key);
      return text === key ? skip.message : text;
    };
    const when = (iso: string) => formatDateTime(iso, locale);
    return { t, locale, fieldLabel, value, reason, when, empty };
  }, [t, locale, unitTypes]);
}
