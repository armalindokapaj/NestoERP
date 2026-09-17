"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ExternalLink, MoreHorizontal, MoveRight, Pencil, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { ORIENTATION_LABELS, POSITION_LABELS, type UnitDTO, type UnitListDTO } from "@/lib/modules/project-structure/structure.types";
import { areaText, countText } from "./structure-ui";

/**
 * The unit table (E-05B §46, §109). Inside one floor the Building and Floor
 * columns would say the same thing on every row, so they are left out. On a
 * phone each unit is a card with the few facts that decide which one it is.
 */

export type UnitRowActions = {
  canUpdate: boolean;
  canMove: boolean;
  canDelete: boolean;
  /** Only inside one floor, in the structure order, for somebody who orders the structure (§51). */
  canReorder: boolean;
  onEdit: (unit: UnitDTO) => void;
  onMove: (unit: UnitDTO) => void;
  onDelete: (unit: UnitDTO) => void;
  onReorder: (unit: UnitDTO, offset: -1 | 1) => void;
};

function RowMenu({ unit, href, index, count, actions }: { unit: UnitDTO; href: string; index: number; count: number; actions: UnitRowActions }) {
  // A reader with nothing to do but open the unit already has the link.
  if (!actions.canUpdate && !actions.canMove && !actions.canDelete && !actions.canReorder) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${unit.unitCode}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={href}>
            <ExternalLink aria-hidden="true" />
            Open unit
          </Link>
        </DropdownMenuItem>
        {actions.canUpdate ? (
          <DropdownMenuItem onSelect={() => actions.onEdit(unit)}>
            <Pencil aria-hidden="true" />
            Edit
          </DropdownMenuItem>
        ) : null}
        {actions.canMove ? (
          <DropdownMenuItem onSelect={() => actions.onMove(unit)}>
            <MoveRight aria-hidden="true" />
            Move to another floor
          </DropdownMenuItem>
        ) : null}
        {actions.canReorder ? (
          <>
            <DropdownMenuItem disabled={index === 0} onSelect={() => actions.onReorder(unit, -1)}>
              <ArrowUp aria-hidden="true" />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === count - 1} onSelect={() => actions.onReorder(unit, 1)}>
              <ArrowDown aria-hidden="true" />
              Move down
            </DropdownMenuItem>
          </>
        ) : null}
        {actions.canDelete ? (
          <DropdownMenuItem className="text-danger-strong" onSelect={() => actions.onDelete(unit)}>
            <Trash2 aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UnitTable({ projectId, list, showLocation, actions, onPage, loading }: { projectId: string; list: UnitListDTO; showLocation: boolean; actions: UnitRowActions; onPage: (page: number) => void; loading: boolean }) {
  const href = (unit: UnitDTO) => `/projects/${projectId}/units/${unit.id}`;
  const first = list.total ? (list.page - 1) * list.pageSize + 1 : 0;
  const last = Math.min(list.page * list.pageSize, list.total);
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));

  return (
    <div className={loading ? "opacity-60 transition-opacity" : undefined} aria-busy={loading}>
      <div className="hidden md:block">
        <Table data-testid="unit-table">
          <TableHead>
            <tr>
              <TableHeaderCell>Unit</TableHeaderCell>
              <TableHeaderCell>Type</TableHeaderCell>
              {showLocation ? (
                <>
                  <TableHeaderCell>Building</TableHeaderCell>
                  <TableHeaderCell>Floor</TableHeaderCell>
                </>
              ) : null}
              <TableHeaderCell>Position</TableHeaderCell>
              <TableHeaderCell>Orientation</TableHeaderCell>
              <TableHeaderCell className="text-right">Internal</TableHeaderCell>
              <TableHeaderCell className="text-right">Saleable</TableHeaderCell>
              <TableHeaderCell className="text-right">Rooms</TableHeaderCell>
              <TableHeaderCell className="text-right">Bedrooms</TableHeaderCell>
              <TableHeaderCell className="w-12">
                <span className="sr-only">Actions</span>
              </TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {list.items.map((unit, index) => (
              <TableRow key={unit.id} data-testid="unit-row" data-unit-code={unit.unitCode}>
                <TableCell className="whitespace-nowrap">
                  <Link href={href(unit)} className="font-medium text-fg hover:text-accent-strong">
                    {unit.unitCode}
                  </Link>
                  {unit.name ? <span className="block text-meta text-fg-subtle">{unit.name}</span> : null}
                  {unit.isActive ? null : <Badge className="ml-2">Inactive</Badge>}
                </TableCell>
                <TableCell>{unit.unitType.name}</TableCell>
                {showLocation ? (
                  <>
                    <TableCell className="whitespace-nowrap">{unit.building.name}</TableCell>
                    <TableCell className="whitespace-nowrap">{unit.floor.name}</TableCell>
                  </>
                ) : null}
                <TableCell className="text-fg-muted">{unit.position ? POSITION_LABELS[unit.position] : "—"}</TableCell>
                <TableCell className="text-fg-muted">{unit.orientation ? ORIENTATION_LABELS[unit.orientation] : "—"}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{areaText(unit.areas.internalArea)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{areaText(unit.areas.saleableArea)}</TableCell>
                <TableCell className="text-right tabular-nums">{countText(unit.rooms)}</TableCell>
                <TableCell className="text-right tabular-nums">{countText(unit.bedrooms)}</TableCell>
                <TableCell className="text-right">
                  <RowMenu unit={unit} href={href(unit)} index={index} count={list.items.length} actions={actions} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-2 md:hidden" data-testid="unit-cards">
        {list.items.map((unit, index) => (
          <li key={unit.id} className="nesto-card flex items-start gap-3 p-3" data-testid="unit-card" data-unit-code={unit.unitCode}>
            <Link href={href(unit)} className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-body font-semibold text-fg">{unit.unitCode}</span>
                <span className="text-table text-fg-muted">{unit.unitType.name}</span>
                {unit.isActive ? null : <Badge>Inactive</Badge>}
              </span>
              <span className="mt-0.5 block text-meta text-fg-subtle">
                {showLocation ? `${unit.building.name} · ${unit.floor.name} · ` : ""}
                {areaText(unit.areas.saleableArea)} saleable
                {unit.bedrooms !== null ? ` · ${unit.bedrooms} bed` : ""}
              </span>
            </Link>
            <RowMenu unit={unit} href={href(unit)} index={index} count={list.items.length} actions={actions} />
          </li>
        ))}
      </ul>

      {list.total > list.pageSize ? (
        <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-table text-fg-muted">
            <span className="tabular-nums">
              {first}–{last}
            </span>{" "}
            of <span className="tabular-nums">{list.total}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={list.page <= 1 || loading} onClick={() => onPage(list.page - 1)}>
              <ChevronLeft aria-hidden="true" />
              Previous
            </Button>
            <span className="text-table tabular-nums text-fg-subtle">
              Page {list.page} of {pages}
            </span>
            <Button variant="secondary" size="sm" disabled={list.page >= pages || loading} onClick={() => onPage(list.page + 1)}>
              Next
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
