"use client";

import * as React from "react";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { useRouter } from "@/components/navigation/guarded-router";
import { MoveRight, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { useToast } from "@/components/ui/toast";
import type { UnitDetailDTO, UnitTypeOption } from "@/lib/modules/project-structure/structure.types";
import { MoveUnitDialog } from "./structure-dialogs";
import { failureMessage, structureApi } from "./structure-ui";
import { UnitDialog } from "./unit-dialog";

/**
 * What the unit page lets its reader do (E-05B §52, §55, §56). The same
 * dialogs as the structure screen: there is one unit, edited one way.
 */
export function UnitActions({ unit, types, buildings }: { unit: UnitDetailDTO; types: UnitTypeOption[]; buildings: Array<{ id: string; name: string; floors: Array<{ id: string; name: string }> }> }) {
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("projects");
  const [open, setOpen] = React.useState<"edit" | "move" | "delete" | null>(null);
  const { capabilities } = unit;

  // The confirmation owns the pending state and the double-tap guard; a refusal stays in the dialog (MOB-04 §50, §62).
  async function remove(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await structureApi(`/api/project-units/${unit.id}`, { method: "DELETE" });
      toast({ title: t("unitTable.deleted", { code: unit.unitCode }) });
      router.push(`/projects/${unit.projectId}/units?floor=${unit.floor.id}`);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: failureMessage(error, t("unitTable.deleteFailed")) };
    }
  }

  if (!capabilities.canUpdateUnit && !capabilities.canMoveUnit && !capabilities.canDeleteUnit) return null;

  return (
    <>
      {capabilities.canUpdateUnit ? (
        <Button variant="secondary" onClick={() => setOpen("edit")}>
          <Pencil aria-hidden="true" />
          {t("unitTable.edit")}
        </Button>
      ) : null}
      {capabilities.canMoveUnit ? (
        <Button variant="secondary" onClick={() => setOpen("move")}>
          <MoveRight aria-hidden="true" />
          {t("unitTable.move")}
        </Button>
      ) : null}
      {capabilities.canDeleteUnit ? (
        <Button variant="ghost" size="icon" aria-label={t("unitTable.deleteNamed", { code: unit.unitCode })} onClick={() => setOpen("delete")}>
          <Trash2 />
        </Button>
      ) : null}

      {open === "edit" ? <UnitDialog open onOpenChange={(value) => !value && setOpen(null)} floor={{ id: unit.floor.id, name: unit.floor.name, buildingName: unit.building.name }} unit={unit} types={types} onSaved={() => router.refresh()} /> : null}
      {open === "move" ? (
        <MoveUnitDialog
          open
          onOpenChange={(value) => !value && setOpen(null)}
          unit={{ id: unit.id, unitCode: unit.unitCode, version: unit.version, floorId: unit.floor.id, buildingId: unit.building.id }}
          buildings={buildings}
          onMoved={() => {
            toast({ title: t("workspace.unitMoved", { code: unit.unitCode }) });
            router.refresh();
          }}
        />
      ) : null}
      <ConfirmAction
        open={open === "delete"}
        onOpenChange={(value) => !value && setOpen(null)}
        title={t("unitTable.deleteTitle", { code: unit.unitCode })}
        description={t("workspace.deleteUnitBody")}
        run={remove}
      />
    </>
  );
}
