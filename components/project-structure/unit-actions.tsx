"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { MoveRight, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  const [open, setOpen] = React.useState<"edit" | "move" | "delete" | null>(null);
  const [pending, setPending] = React.useState(false);
  const { capabilities } = unit;

  async function remove() {
    setPending(true);
    try {
      await structureApi(`/api/project-units/${unit.id}`, { method: "DELETE" });
      toast({ title: `${unit.unitCode} deleted.` });
      router.push(`/projects/${unit.projectId}/units?floor=${unit.floor.id}`);
    } catch (error) {
      setOpen(null);
      toast({ title: failureMessage(error, "The unit could not be deleted."), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  if (!capabilities.canUpdateUnit && !capabilities.canMoveUnit && !capabilities.canDeleteUnit) return null;

  return (
    <>
      {capabilities.canUpdateUnit ? (
        <Button variant="secondary" onClick={() => setOpen("edit")}>
          <Pencil aria-hidden="true" />
          Edit
        </Button>
      ) : null}
      {capabilities.canMoveUnit ? (
        <Button variant="secondary" onClick={() => setOpen("move")}>
          <MoveRight aria-hidden="true" />
          Move
        </Button>
      ) : null}
      {capabilities.canDeleteUnit ? (
        <Button variant="ghost" size="icon" aria-label={`Delete ${unit.unitCode}`} onClick={() => setOpen("delete")}>
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
            toast({ title: `${unit.unitCode} moved. Its code and page are unchanged.` });
            router.refresh();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={open === "delete"}
        onOpenChange={(value) => !value && setOpen(null)}
        title={`Delete ${unit.unitCode}?`}
        description="The unit and its page are removed. Deactivate it instead to keep it on record. This cannot be undone."
        pending={pending}
        onConfirm={() => void remove()}
      />
    </>
  );
}
