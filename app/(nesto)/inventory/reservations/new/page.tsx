import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { ReservationForm } from "@/components/inventory/reservation-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import {
  documentFormOptions,
  heldBalances,
} from "@/lib/modules/inventory/inventory.options";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("meta.newReservation") };
}

type SearchParams = Record<string, string | string[] | undefined>;

/** Reserve stock (PRD #20 §158, §319). */
export default async function NewReservationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("inventory");
  const t = await getTranslations("inventory");
  if (!can(context, "inventory.reservation.create")) notFound();

  const params = await searchParams;
  const [options, balances] = await Promise.all([
    documentFormOptions(context),
    heldBalances(context),
  ]);

  const read = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : undefined;

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("meta.inventory"), href: "/inventory" },
          { label: t("meta.reservations"), href: "/inventory/reservations" },
          { label: t("meta.newReservation") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("meta.newReservation")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("newPage.reservations")}
        </p>
      </div>

      <ReservationForm
        options={options}
        balances={balances}
        defaults={{
          inventoryItemId: read("itemId"),
          warehouseId: read("warehouseId"),
          projectId: read("projectId"),
        }}
        cancelHref="/inventory/reservations"
      />
    </div>
  );
}
