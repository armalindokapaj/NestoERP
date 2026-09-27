"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/modules/status-badge";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { archiveLocationAction, createLocationAction } from "@/lib/actions/inventory";
import type { LocationDTO } from "@/lib/modules/inventory/inventory.types";
import { useInventoryTranslations } from "./inventory-text";

/**
 * The bins, racks and bays inside a warehouse (PRD #20 §61–§66).
 *
 * A location is where stock actually sits, and every movement names one. The
 * default location is where a document lands when nobody picks — every
 * warehouse has exactly one, created with it (PRD #20 §64).
 */
export function LocationList({
  warehouseId,
  locations,
  canCreate,
}: {
  warehouseId: string;
  locations: LocationDTO[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const t = useInventoryTranslations();
  const [pending, startTransition] = React.useTransition();
  const [adding, setAdding] = React.useState(false);
  const [archiving, setArchiving] = React.useState<LocationDTO | null>(null);

  function archive(location: LocationDTO) {
    startTransition(async () => {
      const result = await archiveLocationAction(warehouseId, location.id);
      if (result.ok) {
        setArchiving(null);
        toast({ title: t("locations.archived"), tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  return (
    <section className="nesto-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-card font-semibold text-fg">{t("locations.title")}</h2>
          <p className="mt-1 text-meta text-fg-subtle">
            {t("locations.subtitle")}
          </p>
        </div>
        {canCreate ? (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            {t("locations.add")}
          </Button>
        ) : null}
      </div>

      {locations.length === 0 ? (
        <p className="mt-4 text-table text-fg-subtle">
          {t("locations.empty")}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {locations.map((location) => (
            <li
              key={location.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-table font-medium text-fg">
                  {location.code}
                  {location.isDefault ? <Badge tone="info">{t("locations.default")}</Badge> : null}
                  {location.status !== "ACTIVE" ? (
                    <StatusBadge status={location.status} />
                  ) : null}
                </p>
                <p className="text-meta text-fg-subtle">
                  {location.name ?? t("locations.noName")}
                  {location.distinctItems > 0
                    ? ` · ${t("locations.itemsHeld", { count: location.distinctItems })}`
                    : ` · ${t("locations.emptyLocation")}`}
                </p>
              </div>

              {location.capabilities.canArchive && !location.isDefault ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => setArchiving(location)}
                >
                  {t("actions.archive")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-w-md">
          <DialogTitle>{t("locations.addTitle")}</DialogTitle>
          <DialogDescription>
            {t("locations.addDescription")}
          </DialogDescription>

          {/* Inside the dialog, so its guarded close asks about what was typed (AUD-03 §5). */}
          <AddLocationForm warehouseId={warehouseId} onAdded={() => setAdding(false)} />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => setArchiving(open ? archiving : null)}
        title={archiving ? t("actions.archiveTitle", { name: archiving.code }) : t("locations.archiveFallback")}
        description={t("locations.archiveDescription")}
        confirmLabel={t("locations.archiveConfirm")}
        pending={pending}
        onConfirm={() => archiving && archive(archiving)}
      />
    </section>
  );
}

function AddLocationForm({ warehouseId, onAdded }: { warehouseId: string; onAdded: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const t = useInventoryTranslations();
  const formRef = React.useRef<HTMLFormElement>(null);
  const save = useEditorSave({
    formRef,
    action: (formData: FormData) => createLocationAction(warehouseId, formData),
    module: "inventory",
    saveKind: "create",
    label: t("locations.newLocation"),
    onCommitted: () => {
      onAdded();
      toast({ title: t("locations.added"), tone: "success" });
      router.refresh();
      return true;
    },
  });
  const { pending, fieldErrors: errors } = save;

  return (
    <form ref={formRef} onSubmit={save.onSubmit} className="space-y-4">
      <SaveMessages save={save} />

      <fieldset disabled={pending || Boolean(save.saved)} className="m-0 min-w-0 space-y-4 border-0 p-0">
        <div className="space-y-1.5">
          <Label htmlFor="location-code">{t("locations.code")}</Label>
          <Input id="location-code" name="code" required maxLength={40} />
          {errors.code ? (
            <p className="text-meta text-danger-strong">{errors.code[0]}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="location-name">{t("locations.name")}</Label>
          <Input id="location-name" name="name" maxLength={200} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="location-description">{t("locations.description")}</Label>
          <Input id="location-description" name="description" maxLength={1000} />
        </div>
      </fieldset>

      <DialogFooter>
        <UnsavedIndicator save={save} className="mr-auto self-center" />
        {/* The guarded close, like the X (§5). */}
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            {t("actions.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? t("locations.adding") : t("locations.add")}
        </Button>
      </DialogFooter>
    </form>
  );
}
