import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";

import { CatalogEntry, SpecimenGroup } from "./frame";
import { InvoiceTable } from "./live";

const LEDGER = [
  ["01 Oct 2026", "Opening balance", "", "€412,900"],
  ["03 Oct 2026", "Alba Concrete — INV-2041", "−€128,450", "€284,450"],
  ["07 Oct 2026", "Client payment, stage 4", "+€350,000", "€634,450"],
  ["09 Oct 2026", "Tirana Glazing — INV-2043", "−€9,870", "€624,580"],
  ["12 Oct 2026", "Payroll, first half", "−€86,200", "€538,380"],
  ["14 Oct 2026", "Vlora Electrical — deposit", "−€12,000", "€526,380"],
  ["18 Oct 2026", "Plant hire, tower crane", "−€18,640", "€507,740"],
  ["21 Oct 2026", "Client payment, variation 6", "+€42,500", "€550,240"],
] as const;

export function TableEntry() {
  return (
    <CatalogEntry
      id="tables"
      title="Table"
      source="components/ui/table.tsx"
      summary="A semantic table for records read against each other. Rows are divided by one subtle line, numbers are right-aligned in tabular numerals, and a selected row stays selected under the pointer."
      notes={{
        props: "Table: label (the scroll region's name), flush, stack. TableRow: selected, interactive. TableHeaderCell: numeric, sort (ascending, descending, none). TableCell: numeric.",
        role: "table, with a named scroll region around it. Not a grid: there is no cell-to-cell arrow navigation.",
        keyboard: "Tab moves through the links, checkboxes and sort buttons in reading order. Space ticks a checkbox; Enter follows a link. The scroll region takes focus while there is something to scroll sideways.",
        events: "None of its own. Selection is the checkbox's onChange and sorting is the header button's onClick, both the caller's.",
        precedence: "Selected wins over hover and focus-within. A sorted header announces its order with aria-sort.",
        nesting: "A cell holds text, one primary link, a badge or a checkbox. A row is never the only way to open a record.",
        responsive: "A row is at least 44px, 36px in compact density and 48px under touch, and grows when a cell wraps. A wide table scrolls sideways inside its own region; with stack, each row is a card on a phone.",
        data: "The caller holds the rows, the selection and the sort order. The table only draws them.",
        notApplicable: "Pressed and disabled rows. An archived row stays legible and says why it is restricted.",
        avoid: "Boxed cells, a double-click to act, or a card list in place of comparable rows.",
      }}
    >
      <SpecimenGroup title="Selection, sort and numeric columns — live" hint="One row starts selected: move the pointer over it. Amount is sorted; the button flips the order. The long supplier name wraps and the row grows." className="block">
        <Card className="overflow-hidden">
          <InvoiceTable />
        </Card>
      </SpecimenGroup>

      <SpecimenGroup title="Sticky header in a bounded scroller" hint="Scroll the list: the header keeps a solid ground in version 2, so no row shows through it." className="block">
        <Card className="overflow-hidden">
          <div role="region" aria-label="Site account ledger" tabIndex={0} className="max-h-56 overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" data-testid="catalog-sticky">
            <table className="w-full border-collapse text-table">
              <TableHead>
                <tr>
                  <TableHeaderCell scope="col" sort="ascending">Date</TableHeaderCell>
                  <TableHeaderCell scope="col">Entry</TableHeaderCell>
                  <TableHeaderCell scope="col" numeric>Movement</TableHeaderCell>
                  <TableHeaderCell scope="col" numeric>Balance</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {LEDGER.map(([date, entry, movement, balance]) => (
                  <TableRow key={date}>
                    <TableCell className="whitespace-nowrap">{date}</TableCell>
                    <TableCell>{entry}</TableCell>
                    <TableCell numeric className="whitespace-nowrap">{movement}</TableCell>
                    <TableCell numeric className="whitespace-nowrap">{balance}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        </Card>
      </SpecimenGroup>

      <SpecimenGroup title="Loading" hint="The columns keep their widths while the rows are on their way." className="block">
        <Card className="overflow-hidden" aria-busy="true">
          <Table label="Invoices, loading">
            <TableHead>
              <tr>
                <TableHeaderCell scope="col" className="w-32">Invoice</TableHeaderCell>
                <TableHeaderCell scope="col">Supplier</TableHeaderCell>
                <TableHeaderCell scope="col" className="w-32">Status</TableHeaderCell>
                <TableHeaderCell scope="col" numeric className="w-40">Amount</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {[0, 1, 2].map((row) => (
                <TableRow key={row}>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-48 max-w-full" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell numeric><Skeleton className="ml-auto h-4 w-24" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </SpecimenGroup>

      <SpecimenGroup title="Empty" hint="An empty list says what belongs here and how records reach it." className="block">
        <EmptyState title="No invoices yet" description="Supplier invoices appear here once procurement records one against a purchase order." />
      </SpecimenGroup>
    </CatalogEntry>
  );
}
